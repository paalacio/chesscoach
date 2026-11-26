// State of the opening explorer: which source is shown, its data for the
// current position, engine evaluations of the explorer's moves, and Claude's
// "Explain this opening".

import { create } from "zustand";
import { backend, type BackendError, type ExplorerReply, type ExplorerSource, toBackendError } from "../backend";
import { buildOpeningPrompt, checkOpeningOverview, type ExplorerSection, type OpeningOverview } from "../core/explorer";
import { pathTo } from "../core/game-tree";
import { openingOfLine } from "../core/openings";
import type { Color, EngineLine } from "../core/types";
import type { Checked } from "../core/validate";
import { currentLang } from "../i18n";
import { courseKey } from "../core/course";
import { EXPLAIN_DEPTH, useAnalysis } from "./analysis";
import { courseContext } from "./course-notes";
import { useApp } from "./app";

/** Depth for evaluating the explorer's moves (quick: they're many). */
export const EXPLORER_EVAL_DEPTH = 14;

interface OverviewState {
  status: "idle" | "asking" | "done" | "error";
  result: Checked<OpeningOverview> | null;
  cached: boolean;
  model: string;
  error: BackendError | null;
}

interface ExplorerState {
  source: ExplorerSource;
  mineColor: Color;
  tokenSaved: boolean | null;
  /** key = source|color|fen */
  replies: Record<string, ExplorerReply>;
  loading: string | null;
  /** fen -> uci -> engine line (from a search restricted to the explorer's moves) */
  evals: Record<string, Record<string, EngineLine>>;
  overview: Record<string, OverviewState>;

  init(): Promise<void>;
  setSource(s: ExplorerSource): void;
  setMineColor(c: Color): void;
  load(fen: string): Promise<void>;
  refreshToken(): Promise<void>;
  explainOpening(force?: boolean): Promise<void>;
}

/** Lichess filters from Settings, part of the key so a filter change asks again. */
function filtersKey(): string {
  const s = useApp.getState().settings;
  return s ? `${s.explorerRatings.join(",")}/${s.explorerSpeeds.join(",")}` : "";
}

export const replyKey = (source: ExplorerSource, color: Color, fen: string) =>
  `${source}|${source === "mine" ? color : source === "lichess" ? filtersKey() : "-"}|${fen.split(" ").slice(0, 4).join(" ")}`;

const idleOverview: OverviewState = { status: "idle", result: null, cached: false, model: "", error: null };
export const overviewOf = (s: ExplorerState, fen: string) => s.overview[fen.split(" ").slice(0, 4).join(" ")] ?? idleOverview;

let loadSeq = 0;

export const useExplorer = create<ExplorerState>((set, get) => ({
  source: "masters",
  mineColor: "white",
  tokenSaved: null,
  replies: {},
  loading: null,
  evals: {},
  overview: {},

  async init() {
    const saved = await backend.lichessTokenStatus().catch(() => false);
    // With a token, start on games at the player's level; without, on masters.
    set({ tokenSaved: saved, source: saved ? "lichess" : "masters" });
  },

  setSource: (source) => set({ source }),
  setMineColor: (mineColor) => set({ mineColor }),

  async refreshToken() {
    // Forget Lichess answers so the next view asks again with (or without) the token.
    const replies = Object.fromEntries(Object.entries(get().replies).filter(([k]) => !k.startsWith("lichess|")));
    set({ tokenSaved: await backend.lichessTokenStatus().catch(() => false), replies });
  },

  async load(fen) {
    const { source, mineColor } = get();
    const key = replyKey(source, mineColor, fen);
    const seq = ++loadSeq;
    // Ask (again) unless we already have data for this exact view.
    if (!get().replies[key]?.result) {
      set({ loading: key });
      try {
        const reply = await backend.explorerQuery(source, fen, mineColor);
        set((s) => ({ replies: { ...s.replies, [key]: reply } }));
      } catch (e) {
        const err = toBackendError(e);
        set((s) => ({ replies: { ...s.replies, [key]: { result: null, cached: false, stale: false, errorKind: err.kind, errorDetail: err.message } } }));
      } finally {
        if (seq === loadSeq) set({ loading: null });
      }
    }
    // Engine evaluation of the moves shown (only if still on this position).
    const reply = get().replies[key];
    const moves = reply?.result?.moves.slice(0, 8).map((m) => m.uci) ?? [];
    const known = get().evals[fen] ?? {};
    const missing = moves.filter((u) => !known[u]);
    if (missing.length && seq === loadSeq) {
      const lines = await useAnalysis.getState().evaluateMoves(fen, moves, EXPLORER_EVAL_DEPTH);
      set((s) => ({ evals: { ...s.evals, [fen]: { ...(s.evals[fen] ?? {}), ...lines } } }));
    }
  },

  async explainOpening(force = false) {
    const a = useAnalysis.getState();
    const node = a.tree.nodes[a.current];
    const epd = node.fen.split(" ").slice(0, 4).join(" ");
    const cur = get().overview[epd];
    if (cur?.status === "asking" || (cur?.status === "done" && !force)) return;
    set((s) => ({ overview: { ...s.overview, [epd]: { ...idleOverview, status: "asking" } } }));
    try {
      const history = pathTo(a.tree, a.current).map((n) => ({ fen: n.fen, san: n.san }));
      // Stockfish first, so Claude gets deep engine lines (as for the other explanations).
      const lines = await a.evaluatePosition(node.fen, EXPLAIN_DEPTH);
      // Explorer numbers we already have for this position, from every source.
      const sections: ExplorerSection[] = [];
      const titles: Record<ExplorerSource, string> = {
        masters: "Masters games (Lichess)",
        lichess: "Lichess games at the player's level",
        mine: "The player's own games",
      };
      for (const src of ["masters", "lichess", "mine"] as ExplorerSource[]) {
        for (const color of (src === "mine" ? ["white", "black"] : ["white"]) as Color[]) {
          const r = get().replies[replyKey(src, color, node.fen)]?.result;
          if (r && r.moves.length) sections.push({ title: src === "mine" ? `${titles.mine} as ${color}` : titles[src], data: r });
        }
      }
      const opening = openingOfLine(history.map((h) => h.fen)).opening;
      const course = courseContext(node.fen);
      const { prompt, allowed } = buildOpeningPrompt({ fen: node.fen, lines: lines.length ? lines : [], history, course }, sections, opening, currentLang());
      const reply = await backend.claudeAsk({ kind: "openingOverview", fen: node.fen, movePlayed: null, prompt, force, variant: course ? courseKey(course) : null });
      set((s) => ({
        overview: {
          ...s.overview,
          [epd]: { status: "done", result: checkOpeningOverview(reply.data, allowed), cached: reply.cached, model: reply.model, error: null },
        },
      }));
      useAnalysis.setState({ callsToday: reply.callsToday });
    } catch (e) {
      const error = toBackendError(e);
      set((s) => ({ overview: { ...s.overview, [epd]: error.kind === "cancelled" ? idleOverview : { ...idleOverview, status: "error", error } } }));
    }
  },
}));
