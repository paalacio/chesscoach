// State of the Games and Review pages: the imported games, syncing with
// Chess.com, the background analysis queue, and the review of the open game.
//
// When the Rust worker finishes analysing a game, we compute its review here
// (src/core/review.ts) and save a small summary for the list plus training
// cards for the user's mistakes.

import { create } from "zustand";
import { deviationOf } from "../core/repertoire";
import { useRepertoire } from "./repertoire";
import {
  backend,
  type BackendError,
  type GameDetail,
  type GameSummary,
  type SyncProgress,
  type SyncReport,
  toBackendError,
  type WorkerStatus,
} from "../backend";
import { buildGameReviewPrompt, type CheckedGameReview, checkGameReview, type GameReviewPacket } from "../core/game-review-packet";
import { type GameMove, type GameReview, movesFromPgn, reviewGame, summarize, trainingCards } from "../core/review";
import type { Color } from "../core/types";
import { currentLang } from "../i18n";

export type ColorFilter = "all" | "white" | "black";
export type ResultFilter = "all" | "win" | "loss" | "draw";

interface OpenGame {
  detail: GameDetail;
  startFen: string;
  moves: GameMove[];
  review: GameReview | null;
  /** Position shown: 0 = start, k = after k moves. */
  ply: number;
  orientation: Color;
}

interface ClaudeReview {
  status: "idle" | "asking" | "done" | "error";
  result: CheckedGameReview | null;
  cached: boolean;
  model: string;
  error: BackendError | null;
}

interface GamesState {
  games: GameSummary[];
  loaded: boolean;
  filter: { color: ColorFilter; result: ResultFilter; query: string };

  syncing: boolean;
  syncProgress: SyncProgress | null;
  syncReport: SyncReport | null;
  /** After a sync: how many of the new games left a repertoire (null = nothing to say). */
  repertoireNews: { left: number; games: number } | null;
  dismissRepertoireNews(): void;
  syncError: BackendError | null;

  worker: WorkerStatus | null;

  open: OpenGame | null;
  openError: string | null;
  claude: ClaudeReview;

  init(): Promise<void>;
  reload(): Promise<void>;
  setFilter(f: Partial<GamesState["filter"]>): void;
  sync(): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  openGame(id: number): Promise<void>;
  closeGame(): void;
  goto(ply: number): void;
  step(delta: number): void;
  flip(): void;
  reanalyze(): Promise<void>;
  askClaude(force?: boolean): Promise<void>;
  cancelClaude(): void;
}

const idleClaude: ClaudeReview = { status: "idle", result: null, cached: false, model: "", error: null };

/** Computes the review of a game and stores summary + cards (once per analysis). */
async function reviewAndSave(detail: GameDetail): Promise<{ startFen: string; moves: GameMove[]; review: GameReview | null }> {
  const { startFen, moves } = movesFromPgn(detail.pgn);
  if (!detail.analysis) return { startFen, moves, review: null };
  const review = reviewGame(startFen, moves, detail.analysis, detail.myColor);
  if (!detail.reviewSummary) {
    await backend.gameSaveReview(detail.id, summarize(review, detail.myColor), trainingCards(review, detail.myColor));
  }
  return { startFen, moves, review };
}

let initialized = false;
/** Latest packet sent to Claude, needed to check its answer. */
let lastPacket: GameReviewPacket | null = null;

export const useGames = create<GamesState>((set, get) => ({
  games: [],
  loaded: false,
  filter: { color: "all", result: "all", query: "" },
  syncing: false,
  syncProgress: null,
  syncReport: null,
  repertoireNews: null,
  dismissRepertoireNews: () => set({ repertoireNews: null }),
  syncError: null,
  worker: null,
  open: null,
  openError: null,
  claude: idleClaude,

  async init() {
    if (initialized) return;
    initialized = true;
    await backend.onSyncProgress((p) => set({ syncProgress: p }));
    await backend.onReviewEvent(async (ev) => {
      if (ev.type === "status") {
        set({ worker: ev.status });
      } else if (ev.type === "progress") {
        set((s) => ({
          worker: { paused: s.worker?.paused ?? false, currentGame: ev.gameId, ply: ev.ply, plies: ev.plies, pending: ev.pending },
        }));
      } else if (ev.type === "gameDone") {
        set((s) => ({ worker: s.worker ? { ...s.worker, currentGame: null, pending: ev.pending } : s.worker }));
        try {
          const detail = await backend.gameGet(ev.gameId);
          const reviewed = await reviewAndSave(detail);
          const open = get().open;
          if (open?.detail.id === ev.gameId) {
            set({ open: { ...open, detail, ...reviewed, ply: open.ply } });
          }
        } catch (e) {
          console.warn("review failed", e);
        }
        get().reload();
      } else if (ev.type === "gameError") {
        get().reload();
      }
    });
    backend.reviewStatus().then((w) => set({ worker: w })).catch(() => {});
    await get().reload();
  },

  async reload() {
    try {
      set({ games: await backend.gamesList(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),

  async sync() {
    if (get().syncing) return;
    set({ syncing: true, syncProgress: null, syncError: null });
    try {
      const report = await backend.gamesSync();
      set({ syncReport: report });
      await get().reload();
      // Where did the new games leave your repertoires?
      const rep = useRepertoire.getState();
      if (report.newGames > 0 && rep.list.length > 0) {
        const newest = await backend.recentGameMoves(Math.min(report.newGames, 50), 40);
        const reps = Object.values(rep.reps);
        const left = newest.map((g) => deviationOf(reps, g)).filter((d) => d && d.kind !== "end").length;
        if (left > 0) set({ repertoireNews: { left, games: newest.length } });
        void rep.loadDeviations(); // for the Repertoire page's list
      }
    } catch (e) {
      set({ syncError: toBackendError(e) });
    } finally {
      set({ syncing: false, syncProgress: null });
    }
  },

  async setPaused(paused) {
    await backend.reviewSetPaused(paused);
    set((s) => ({ worker: { ...(s.worker ?? { currentGame: null, ply: 0, plies: 0, pending: 0 }), paused } }));
  },

  async openGame(id) {
    set({ openError: null, claude: idleClaude });
    try {
      const detail = await backend.gameGet(id);
      const reviewed = await reviewAndSave(detail);
      set({ open: { detail, ...reviewed, ply: reviewed.moves.length, orientation: detail.myColor } });
      // Not analysed yet: put it at the front of the queue.
      if (!detail.analysis && detail.analysisStatus !== "running") await backend.reviewPrioritize(id);
      if (reviewed.review && !detail.reviewSummary) get().reload();
    } catch (e) {
      set({ openError: toBackendError(e).message });
    }
  },

  closeGame: () => set({ open: null, claude: idleClaude }),

  goto(ply) {
    const open = get().open;
    if (!open) return;
    set({ open: { ...open, ply: Math.max(0, Math.min(open.moves.length, ply)) } });
  },
  step(delta) {
    const open = get().open;
    if (open) get().goto(open.ply + delta);
  },
  flip() {
    const open = get().open;
    if (open) set({ open: { ...open, orientation: open.orientation === "white" ? "black" : "white" } });
  },

  async reanalyze() {
    const open = get().open;
    if (!open) return;
    await backend.reviewReanalyze(open.detail.id);
    set({ open: { ...open, review: null, detail: { ...open.detail, analysis: null, analysisStatus: "pending", reviewSummary: null } }, claude: idleClaude });
    get().reload();
  },

  async askClaude(force = false) {
    const open = get().open;
    if (!open?.review || get().claude.status === "asking") return;
    const d = open.detail;
    lastPacket = buildGameReviewPrompt(
      {
        white: d.white,
        black: d.black,
        whiteElo: d.whiteElo,
        blackElo: d.blackElo,
        result: d.result,
        myColor: d.myColor,
        termination: d.termination,
        timeControl: d.timeControl,
        timeClass: d.timeClass,
      },
      open.review,
      currentLang(),
    );
    set({ claude: { ...idleClaude, status: "asking" } });
    try {
      const reply = await backend.claudeAsk({
        kind: "gameReview",
        fen: `game:${d.url}`,
        movePlayed: null,
        prompt: lastPacket.prompt,
        force,
      });
      set({
        claude: { status: "done", result: checkGameReview(reply.data, lastPacket), cached: reply.cached, model: reply.model, error: null },
      });
    } catch (e) {
      const error = toBackendError(e);
      set({ claude: error.kind === "cancelled" ? idleClaude : { ...idleClaude, status: "error", error } });
    }
  },

  cancelClaude() {
    backend.claudeCancel().catch(() => {});
    set({ claude: idleClaude });
  },
}));

/** Games matching the current filters. */
export function filteredGames(games: GameSummary[], f: GamesState["filter"]): GameSummary[] {
  const q = f.query.trim().toLowerCase();
  return games.filter((g) => {
    if (f.color !== "all" && g.myColor !== f.color) return false;
    if (f.result !== "all" && g.myResult !== f.result) return false;
    if (!q) return true;
    const opponent = g.myColor === "white" ? g.black : g.white;
    const opening = `${g.reviewSummary?.openingName ?? ""} ${g.opening ?? ""} ${g.eco ?? ""}`;
    return opponent.toLowerCase().includes(q) || opening.toLowerCase().includes(q);
  });
}
