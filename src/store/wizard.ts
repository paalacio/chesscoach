// The repertoire wizard: what you face in your games, a few questions about your
// style, Claude's 2-3 options per slot (with explorer numbers at your level), and
// then building the repertoires you chose.

import { create } from "zustand";
import { backend, type BackendError, type ExplorerResult, toBackendError } from "../backend";
import { playUci, START_FEN } from "../core/chess";
import {
  buildProposalPrompt,
  checkProposal,
  type FirstMove,
  type GamesFact,
  type Proposal,
  repertoireName,
  type Slot,
  slotsFor,
  type StyleAnswers,
} from "../core/repertoire-proposal";
import type { Color } from "../core/types";
import { currentLang, tNow } from "../i18n";
import { useExplorer } from "./explorer";
import { useRepertoire } from "./repertoire";

export interface ProposalState {
  status: "idle" | "asking" | "done" | "error";
  proposal: Proposal | null;
  error: BackendError | null;
  cached: boolean;
}

/** Explorer numbers for an option: games that reached its last position, and your score there. */
export interface OptionStats {
  games: number;
  score: number;
  /** "lichess" (your level) or "masters". */
  source: "lichess" | "masters";
}

/** A fact about your games, with what the UI needs to translate it. */
export interface WizardFact extends GamesFact {
  kind: "whiteFirst" | "blackFaces" | "blackVs" | "whiteAfter";
  /** The first move it's about (for "blackVs" / "whiteAfter"). */
  move: string | null;
}

interface WizardState {
  step: 0 | 1 | 2 | 3;
  sides: Record<Color, boolean>;
  firstMoves: FirstMove[];
  answers: StyleAnswers;
  facts: Record<Color, WizardFact[]> | null;
  proposals: Partial<Record<Color, ProposalState>>;
  /** slot id -> index of the chosen option */
  choices: Record<string, number>;
  /** `${slot}:${index}` -> numbers (null = not available) */
  stats: Record<string, OptionStats | null | "loading">;
  building: boolean;

  setStep(step: WizardState["step"]): void;
  setSide(color: Color, on: boolean): void;
  toggleFirstMove(m: FirstMove): void;
  setAnswers(a: Partial<StyleAnswers>): void;
  loadFacts(): Promise<void>;
  ask(color: Color, force?: boolean): Promise<void>;
  choose(slot: string, index: number): void;
  buildChosen(): Promise<void>;
}

const idle: ProposalState = { status: "idle", proposal: null, error: null, cached: false };
/** White's first moves, in the order they're shown. */
const FIRST_MOVES: FirstMove[] = ["e4", "d4"];

/** A short stable hash, so different answers get a different cache entry. */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

const scoreFor = (color: Color, w: number, d: number, b: number) => {
  const total = w + d + b;
  return total ? (100 * ((color === "white" ? w : b) + d / 2)) / total : 0;
};

/** Facts from your own games (the "My games" explorer, built from your Chess.com games). */
async function gamesFacts(): Promise<Record<Color, WizardFact[]>> {
  const mine = async (fen: string, color: Color): Promise<ExplorerResult | null> =>
    (await backend.explorerQuery("mine", fen, color).catch(() => null))?.result ?? null;
  const top = (fen: string, r: ExplorerResult, n = 3) =>
    r.moves.slice(0, n).map((m) => {
      const black = fen.split(" ")[1] === "b";
      return `${black ? "1..." : "1."}${m.san} (${m.white + m.draws + m.black})`;
    });
  const fact = (kind: WizardFact["kind"], move: string | null, label: string, color: Color, fen: string, r: ExplorerResult | null): WizardFact | null =>
    r && r.white + r.draws + r.black > 0
      ? { kind, move, label, games: r.white + r.draws + r.black, score: scoreFor(color, r.white, r.draws, r.black), top: top(fen, r) }
      : null;

  const out: Record<Color, WizardFact[]> = { white: [], black: [] };
  // As White: your first moves, then what Black answers to the main ones.
  const wStart = await mine(START_FEN, "white");
  const f1 = fact("whiteFirst", null, "As White, your first move", "white", START_FEN, wStart);
  if (f1) out.white.push(f1);
  for (const m of wStart?.moves.slice(0, 2) ?? []) {
    const after = playUci(START_FEN, m.uci);
    if (!after) continue;
    const f = fact("whiteAfter", m.san, `As White after 1.${m.san}, what Black plays`, "white", after.fen, await mine(after.fen, "white"));
    if (f) out.white.push(f);
  }
  // As Black: what White starts with, then your answers to the main ones.
  const bStart = await mine(START_FEN, "black");
  const f2 = fact("blackFaces", null, "As Black, what White plays first", "black", START_FEN, bStart);
  if (f2) out.black.push(f2);
  for (const m of bStart?.moves.slice(0, 2) ?? []) {
    const after = playUci(START_FEN, m.uci);
    if (!after) continue;
    const f = fact("blackVs", m.san, `As Black against 1.${m.san}, your answer`, "black", after.fen, await mine(after.fen, "black"));
    if (f) out.black.push(f);
  }
  return out;
}

export const useWizard = create<WizardState>((set, get) => ({
  step: 0,
  sides: { white: true, black: true },
  firstMoves: ["e4"],
  answers: { style: "balanced", theory: "some", attacking: "either", openings: "" },
  facts: null,
  proposals: {},
  choices: {},
  stats: {},
  building: false,

  setStep: (step) => set({ step }),
  setSide: (color, on) => set((s) => ({ sides: { ...s.sides, [color]: on } })),
  toggleFirstMove(m) {
    const now = get().firstMoves;
    const next = FIRST_MOVES.filter((x) => (x === m ? !now.includes(m) : now.includes(x)));
    if (next.length) set({ firstMoves: next, proposals: { ...get().proposals, white: idle } });
  },
  setAnswers: (a) => set((s) => ({ answers: { ...s.answers, ...a } })),

  async loadFacts() {
    const facts = await gamesFacts();
    // Start with the first moves you actually play as White (those in at least 20% of your games).
    const first = facts.white.find((f) => f.kind === "whiteFirst");
    const played = (first?.top ?? [])
      .map((t) => t.match(/^1\.(e4|d4) \((\d+)\)$/))
      .filter((m): m is RegExpMatchArray => !!m && Number(m[2]) >= (first?.games ?? 0) * 0.2)
      .map((m) => m[1] as FirstMove);
    set({ facts, firstMoves: played.length ? FIRST_MOVES.filter((m) => played.includes(m)) : get().firstMoves });
  },

  async ask(color, force = false) {
    const s = get();
    const slots = slotsFor(color, s.firstMoves);
    const facts = s.facts?.[color] ?? [];
    const prompt = buildProposalPrompt(color, slots, s.answers, facts, currentLang());
    set((st) => ({ proposals: { ...st.proposals, [color]: { ...idle, status: "asking" } } }));
    try {
      const reply = await backend.claudeAsk({
        kind: "repertoireProposal",
        fen: `repertoire:${color}`,
        movePlayed: shortHash(prompt),
        prompt,
        force,
      });
      const proposal = checkProposal(reply.data, slots);
      set((st) => ({ proposals: { ...st.proposals, [color]: { status: "done", proposal, error: null, cached: reply.cached } } }));
      await loadStats(color, proposal.slots);
    } catch (e) {
      set((st) => ({ proposals: { ...st.proposals, [color]: { ...idle, status: "error", error: toBackendError(e) } } }));
    }
  },

  choose: (slot, index) => set((s) => ({ choices: { ...s.choices, [slot]: index } })),

  async buildChosen() {
    const s = get();
    const rep = useRepertoire.getState();
    set({ building: true });
    // One repertoire for Black, one for each first move as White.
    const groups: { color: Color; first: FirstMove | null; slots: Proposal["slots"] }[] = [];
    if (s.sides.black && s.proposals.black?.proposal) groups.push({ color: "black", first: null, slots: s.proposals.black.proposal.slots });
    if (s.sides.white && s.proposals.white?.proposal) {
      for (const first of s.firstMoves) {
        const slots = s.proposals.white.proposal.slots.filter((x) => x.slot.root[0] === first);
        if (slots.length) groups.push({ color: "white", first, slots });
      }
    }
    try {
      const todo: { id: number; seeds: string[][] }[] = [];
      for (const g of groups) {
        const chosen = g.slots
          .map((x) => ({ slot: x.slot, option: x.options[s.choices[x.slot.id] ?? 0] }))
          .filter((x) => x.option);
        if (!chosen.length) continue;
        const name = repertoireName(g.color, g.first, tNow as (k: string) => string);
        const lines = chosen.map((c) => ({ slot: c.slot.id, name: c.option.name, moves: c.option.moves }));
        // Rebuild an existing repertoire of the same name, or make a new one.
        const existing = rep.list.find((r) => r.name === name && r.color === g.color);
        const id = existing ? existing.id : await rep.create(name, g.color, { lines });
        if (existing) {
          await backend.repertoireUpdate(id, null, { lines });
          await backend.repertoireSaveMoves(id, []);
        }
        todo.push({ id, seeds: chosen.map((c) => c.option.ucis) });
      }
      await useRepertoire.getState().reload();
      useRepertoire.getState().openWizard(false);
      if (todo[0]) useRepertoire.getState().select(todo[0].id);
      set({ building: false, step: 0 });
      for (const t of todo) await useRepertoire.getState().runBuild(t.id, t.seeds);
    } catch (e) {
      set({ building: false });
      throw e;
    }
  },
}));

/** Explorer numbers for each option, one request at a time. */
async function loadStats(color: Color, slots: { slot: Slot; options: Proposal["slots"][number]["options"] }[]) {
  const token = useExplorer.getState().tokenSaved !== false;
  for (const { slot, options } of slots) {
    for (const [i, opt] of options.entries()) {
      const key = `${slot.id}:${i}`;
      useWizard.setState((s) => ({ stats: { ...s.stats, [key]: "loading" } }));
      // The position before the option's last move, and that move.
      let fen = START_FEN;
      for (const u of opt.ucis.slice(0, -1)) fen = playUci(fen, u)?.fen ?? fen;
      const last = playUci(fen, opt.ucis[opt.ucis.length - 1]);
      let stats: OptionStats | null = null;
      for (const source of token ? (["lichess", "masters"] as const) : (["masters"] as const)) {
        const r = (await backend.explorerQuery(source, fen).catch(() => null))?.result;
        const m = r?.moves.find((x) => (playUci(fen, x.uci)?.uci ?? x.uci) === last?.uci);
        if (m) {
          stats = { games: m.white + m.draws + m.black, score: scoreFor(color, m.white, m.draws, m.black), source };
          break;
        }
      }
      useWizard.setState((s) => ({ stats: { ...s.stats, [key]: stats } }));
    }
  }
}
