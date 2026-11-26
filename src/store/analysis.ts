// State of the analysis board: the move tree, the engine and Claude's explanations.
//
// Engine flow: whenever the current position changes and the engine is on, we
// ask the backend to analyse it ("live" analysis, runs until stopped). Explaining
// a position first makes sure there is a deep-enough evaluation (a one-off
// fixed-depth search), then builds the context packet and asks Claude.

import { create } from "zustand";
import { backend, type BackendError, toBackendError } from "../backend";
import { currentLang } from "../i18n";
import { legalSans, moveLabel, playUci, START_FEN, turnOf } from "../core/chess";
import { buildPacket, buildPrompt, type MoveContext, type RequestKind } from "../core/context-packet";
import { courseKey } from "../core/course";
import { courseContext } from "./course-notes";
import { linesDepth, mergeInfo } from "../core/engine-lines";
import * as T from "../core/game-tree";
import type { Color, EngineEvent, EngineLine } from "../core/types";
import {
  type BestMoves,
  type Checked,
  checkBestMoves,
  checkMoveExplanation,
  checkPositionPlan,
  type MoveExplanation,
  type PositionPlan,
} from "../core/validate";

/** Depth of the one-off search used before explaining. */
export const EXPLAIN_DEPTH = 18;
/** Lines Stockfish looks at when comparing the best moves. */
export const COMPARE_LINES = 4;

export type Explanation =
  | { kind: "moveExplanation"; result: Checked<MoveExplanation>; cached: boolean; model: string; label: string }
  | { kind: "positionPlan"; result: Checked<PositionPlan>; cached: boolean; model: string; label: string }
  | { kind: "bestMoves"; result: Checked<BestMoves>; cached: boolean; model: string; label: string };

export interface ExplainJob {
  key: string;
  kind: RequestKind;
  nodeId: string;
  status: "evaluating" | "asking" | "error";
  error?: BackendError;
}

interface AnalysisState {
  tree: T.GameTree;
  current: string;
  orientation: Color;
  multipv: number;

  engineOn: boolean;
  engineName: string | null;
  engineError: string | null;
  /** Lines for `linesFen` (the current position, or the last one analysed). */
  lines: EngineLine[];
  linesFen: string;
  /** Best lines seen per FEN (kept while you move around). */
  evalCache: Record<string, EngineLine[]>;

  /** Previewing an engine line: which line and how many of its moves. */
  preview: { line: number; plies: number } | null;

  explanations: Record<string, Explanation>;
  job: ExplainJob | null;
  callsToday: number | null;

  init(): Promise<void>;
  goto(id: string): void;
  next(): void;
  prev(): void;
  first(): void;
  last(): void;
  playMove(uci: string): boolean;
  flip(): void;
  setEngine(on: boolean): void;
  load(tree: T.GameTree): void;
  newGame(): void;
  promote(id: string): void;
  remove(id: string): void;
  setPreview(p: AnalysisState["preview"]): void;
  playPreview(): void;
  explain(kind?: RequestKind, force?: boolean): Promise<void>;
  cancelExplain(): void;
  /** Deep-enough engine lines for a position (cached, or a one-off search). */
  evaluatePosition(fen: string, depth: number): Promise<EngineLine[]>;
  /** One search restricted to these moves; returns each move's line (for the explorer). */
  evaluateMoves(fen: string, ucis: string[], depth: number): Promise<Record<string, EngineLine>>;
}

export const explanationKey = (kind: RequestKind, nodeId: string) => `${kind}:${nodeId}`;

// ---- engine bookkeeping that doesn't need to be React state ----
let nextAnalysisId = 1;
let liveId = 0;
let liveTimer: ReturnType<typeof setTimeout> | null = null;
/** One-off searches waiting for their `bestMove`: id -> collected lines + resolver. */
/** `restricted`: a searchmoves search, whose lines aren't the position's real best lines. */
const oneShots = new Map<number, { fen: string; lines: EngineLine[]; multipv: number; restricted?: boolean; done: (lines: EngineLine[]) => void }>();
/**
 * One-off searches run one after another: the engine does one search at a time,
 * and starting a new one would stop the previous one before it finishes.
 */
let oneShotQueue: Promise<unknown> = Promise.resolve();
function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = oneShotQueue.then(job, job);
  oneShotQueue = run.catch(() => {});
  return run;
}
/** Info events are buffered and applied once per animation frame (they can arrive very fast). */
let pending: Extract<EngineEvent, { type: "info" }>[] = [];
let frame: number | null = null;

export const useAnalysis = create<AnalysisState>((set, get) => {
  const node = () => get().tree.nodes[get().current];

  /** Starts (or restarts) live analysis of the current position, debounced. */
  function requestAnalysis() {
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      const s = get();
      if (!s.engineOn || s.job?.status === "evaluating") return;
      const fen = s.tree.nodes[s.current].fen;
      liveId = nextAnalysisId++;
      set({ linesFen: fen, lines: s.evalCache[fen] ?? [] });
      backend
        .engineAnalyze({ analysisId: liveId, fen, multipv: s.multipv })
        .then(() => set({ engineError: null }))
        .catch((e) => set({ engineError: toBackendError(e).message, engineOn: false }));
    }, 90);
  }

  /**
   * A fixed-depth search; resolves with its final lines. Uses the cache if it's
   * deep enough and has enough lines (`minLines`, capped by the legal moves).
   */
  function evaluate(fen: string, depth: number, minLines = get().multipv): Promise<EngineLine[]> {
    return queued(() => evaluateNow(fen, depth, minLines));
  }

  function evaluateNow(fen: string, depth: number, minLines: number): Promise<EngineLine[]> {
    const cached = get().evalCache[fen];
    const wanted = Math.min(minLines, legalSans(fen).length);
    if (cached && cached.length >= wanted && linesDepth(cached) >= depth) return Promise.resolve(cached);
    const id = nextAnalysisId++;
    liveId = 0; // live output is no longer wanted
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(oneShots.get(id)?.lines ?? []), 30_000);
      function finish(lines: EngineLine[]) {
        clearTimeout(timeout);
        oneShots.delete(id);
        resolve(lines);
      }
      oneShots.set(id, { fen, lines: [], multipv: Math.max(minLines, get().multipv), done: finish });
      backend.engineAnalyze({ analysisId: id, fen, multipv: Math.max(minLines, get().multipv), depth }).catch((e) => {
        clearTimeout(timeout);
        oneShots.delete(id);
        reject(toBackendError(e));
      });
    });
  }

  function storeInCache(fen: string, lines: EngineLine[]) {
    const old = get().evalCache[fen];
    if (lines.length === 0) return;
    if (!old || linesDepth(lines) >= linesDepth(old)) {
      set((s) => ({ evalCache: { ...s.evalCache, [fen]: lines } }));
    }
  }

  function flush() {
    frame = null;
    const events = pending;
    pending = [];
    const s = get();
    let lines = s.lines;
    let changed = false;
    for (const ev of events) {
      const shot = oneShots.get(ev.analysisId);
      if (shot) {
        shot.lines = mergeInfo(shot.lines, ev.fen, ev.info, shot.multipv);
      } else if (ev.analysisId === liveId && ev.fen === s.linesFen) {
        lines = mergeInfo(lines, ev.fen, ev.info, s.multipv);
        changed = true;
      }
    }
    if (changed) {
      set({ lines });
      storeInCache(s.linesFen, lines);
    }
  }

  function onEngineEvent(ev: EngineEvent) {
    if (ev.type === "info") {
      pending.push(ev);
      if (frame === null) frame = requestAnimationFrame(flush);
    } else if (ev.type === "bestMove") {
      flush(); // apply any lines still buffered first
      const shot = oneShots.get(ev.analysisId);
      if (shot) {
        if (!shot.restricted) storeInCache(shot.fen, shot.lines);
        shot.done(shot.lines);
      }
    } else {
      set({ engineError: ev.message, engineOn: false });
    }
  }

  function moveTo(id: string) {
    if (!get().tree.nodes[id] || id === get().current) return;
    set({ current: id, preview: null });
    requestAnalysis();
  }

  return {
    tree: T.newTree(START_FEN),
    current: T.ROOT,
    orientation: "white",
    multipv: 3,
    engineOn: true,
    engineName: null,
    engineError: null,
    lines: [],
    linesFen: START_FEN,
    evalCache: {},
    preview: null,
    explanations: {},
    job: null,
    callsToday: null,

    async init() {
      await backend.onEngineEvent(onEngineEvent);
      backend.claudeCallsToday().then((n) => set({ callsToday: n })).catch(() => {});
      try {
        const st = await backend.engineStart();
        set({ engineName: st.name, engineError: null });
        requestAnalysis();
      } catch (e) {
        set({ engineError: toBackendError(e).message, engineOn: false });
      }
    },

    goto: moveTo,
    next: () => moveTo(T.nextId(get().tree, get().current)),
    prev: () => moveTo(T.prevId(get().tree, get().current)),
    first: () => moveTo(T.ROOT),
    last: () => moveTo(T.lastId(get().tree, get().current)),

    playMove(uci) {
      const added = T.addMove(get().tree, get().current, uci);
      if (!added) return false;
      set({ tree: added.tree });
      moveTo(added.id);
      return true;
    },

    flip: () => set((s) => ({ orientation: s.orientation === "white" ? "black" : "white" })),

    setEngine(on) {
      set({ engineOn: on, engineError: on ? null : get().engineError });
      if (on) requestAnalysis();
      else {
        liveId = 0;
        backend.engineStop().catch(() => {});
      }
    },

    /** Loads a new tree and shows the end of its main line (where an imported line ends). */
    load(tree) {
      set({ tree, current: T.lastId(tree, T.ROOT), preview: null, explanations: {}, job: null });
      requestAnalysis();
    },
    newGame() {
      get().load(T.newTree(START_FEN));
    },
    promote: (id) => set((s) => ({ tree: T.promote(s.tree, id) })),
    remove(id) {
      const s = get();
      // If the current position is inside the removed branch, step out of it first.
      const inside = s.current === id || s.current.startsWith(`${id} `);
      const parent = s.tree.nodes[id]?.parent ?? T.ROOT;
      set({ tree: T.deleteNode(s.tree, id) });
      if (inside) moveTo(parent);
    },

    setPreview: (preview) => set({ preview }),
    playPreview() {
      const s = get();
      if (!s.preview) return;
      const line = s.lines[s.preview.line];
      if (!line) return;
      let tree = s.tree;
      let id = s.current;
      for (const uci of line.pvUci.slice(0, s.preview.plies)) {
        const added = T.addMove(tree, id, uci);
        if (!added) break;
        tree = added.tree;
        id = added.id;
      }
      set({ tree, preview: null });
      moveTo(id);
    },

    async explain(kindArg, force = false) {
      const s = get();
      const n = node();
      const kind: RequestKind = kindArg ?? (n.uci ? "moveExplanation" : "positionPlan");
      if (kind === "moveExplanation" && (!n.uci || n.parent === null)) return;
      const key = explanationKey(kind, n.id);
      if (s.job && s.job.status !== "error") return; // one at a time
      if (s.explanations[key] && !force) return;

      set({ job: { key, kind, nodeId: n.id, status: "evaluating" } });
      try {
        // 1. Make sure we have deep-enough engine lines (before and after the move).
        const lines = await evaluate(n.fen, EXPLAIN_DEPTH, kind === "bestMoves" ? COMPARE_LINES : get().multipv);
        let move: MoveContext | null = null;
        if (kind === "moveExplanation") {
          const parent = s.tree.nodes[n.parent as string];
          const linesBefore = await evaluate(parent.fen, EXPLAIN_DEPTH);
          move = { san: n.san as string, uci: n.uci as string, color: turnOf(parent.fen), fenBefore: parent.fen, linesBefore };
        }

        // 2. Build the context packet and the prompt.
        const history = T.pathTo(s.tree, n.id).map((x) => ({ fen: x.fen, san: x.san }));
        // Notes from an imported course about this position (and the move), if any.
        const course = courseContext(n.fen, move ? { fenBefore: move.fenBefore, uci: move.uci } : undefined);
        const packet = buildPacket({ fen: n.fen, lines, history, move, course });
        const prompt = buildPrompt(kind, packet, move, currentLang());
        set({ job: { key, kind, nodeId: n.id, status: "asking" } });
        requestAnalysis(); // let live analysis resume while Claude thinks

        // 3. Ask Claude (cached by the backend), then check the moves it mentions.
        const reply = await backend.claudeAsk({
          kind,
          fen: move ? move.fenBefore : n.fen,
          movePlayed: move?.uci ?? null,
          prompt,
          force,
          variant: course ? courseKey(course) : null,
        });
        const label = move ? moveLabel(move.fenBefore, move.san) : "this position";
        const common = { cached: reply.cached, model: reply.model, label };
        const explanation: Explanation =
          kind === "moveExplanation"
            ? { kind, result: checkMoveExplanation(reply.data, packet.allowed), ...common }
            : kind === "bestMoves"
              ? { kind, result: checkBestMoves(reply.data, packet.allowed, packet.candidates), ...common }
              : { kind: "positionPlan", result: checkPositionPlan(reply.data, packet.allowed), ...common };
        set((st) => ({ explanations: { ...st.explanations, [key]: explanation }, job: null, callsToday: reply.callsToday }));
      } catch (e) {
        const error = toBackendError(e);
        set({ job: error.kind === "cancelled" ? null : { key, kind, nodeId: n.id, status: "error", error } });
        requestAnalysis();
      }
    },

    cancelExplain() {
      backend.claudeCancel().catch(() => {});
      set({ job: null });
      requestAnalysis();
    },

    async evaluatePosition(fen, depth) {
      if (!get().engineOn) return get().evalCache[fen] ?? [];
      try {
        const lines = await evaluate(fen, depth);
        requestAnalysis();
        return lines;
      } catch {
        return get().evalCache[fen] ?? [];
      }
    },

    async evaluateMoves(fen, ucis, depth) {
      if (ucis.length === 0 || !get().engineOn) return {};
      const lines = await queued(
        () =>
          new Promise<EngineLine[]>((resolve) => {
        const id = nextAnalysisId++;
        liveId = 0;
        const timeout = setTimeout(() => finish(oneShots.get(id)?.lines ?? []), 20_000);
        function finish(l: EngineLine[]) {
          clearTimeout(timeout);
          oneShots.delete(id);
          resolve(l);
        }
        oneShots.set(id, { fen, lines: [], multipv: ucis.length, restricted: true, done: finish });
        backend.engineAnalyze({ analysisId: id, fen, multipv: ucis.length, depth, searchmoves: ucis }).catch(() => finish([]));
          }),
      );
      requestAnalysis();
      return Object.fromEntries(lines.filter((l) => l.pvUci[0]).map((l) => [l.pvUci[0], l]));
    },
  };
});

/** Whether a promotion is needed for a board move from `orig` to `dest`. */
export function needsPromotion(fen: string, orig: string, dest: string): boolean {
  const piece = fen.split(" ")[0];
  const rows = piece.split("/");
  const file = orig.charCodeAt(0) - 97;
  const rank = Number(orig[1]);
  let col = 0;
  for (const ch of rows[8 - rank]) {
    if (/\d/.test(ch)) col += Number(ch);
    else {
      if (col === file) return (ch === "P" && dest[1] === "8") || (ch === "p" && dest[1] === "1");
      col++;
    }
  }
  return false;
}

/** For tests and the mock: is this UCI move legal here? */
export const isLegalUci = (fen: string, uci: string) => playUci(fen, uci) !== null;
