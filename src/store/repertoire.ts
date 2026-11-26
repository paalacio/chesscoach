// Repertoires: loading, editing and saving them, building them automatically
// (with the opening explorer and Stockfish), PGN files, and the report of where
// your games left them. The chess logic is in src/core/repertoire*.ts.

import { create } from "zustand";
import { backend, type ExplorerResult, type RepertoireInfo, toBackendError } from "../backend";
import { playUci, START_FEN, turnOf } from "../core/chess";
import { pathTo as treePath } from "../core/game-tree";
import {
  addLine,
  addReply,
  type Deviation,
  deviationOf,
  nodeAt,
  type Repertoire,
  type RepertoireMeta,
  type RepMove,
  removeMove,
  repertoireFromPgn,
  repertoireToPgn,
  setMyMove,
} from "../core/repertoire";
import { type BuildOracle, type BuildProgress, buildRepertoire, type MoveStats } from "../core/repertoire-build";
import type { Color } from "../core/types";
import { tNow } from "../i18n";
import { useAnalysis } from "./analysis";
import { useApp } from "./app";
import { useExplorer } from "./explorer";
import { useToast } from "./toast";
import { askWhy, cachedWhy } from "./why";

/** Engine depth for choosing your moves while building (quick: there are many). */
export const BUILD_DEPTH = 14;
/** Most positions one build asks the explorer about (about 5 minutes with Lichess). */
export const BUILD_BUDGET = 600;

interface BuildState {
  repId: number;
  name: string;
  progress: BuildProgress;
  signal: { cancelled: boolean };
  /** Lichess asked us to slow down: waiting a minute before going on. */
  waiting: boolean;
}

/** Lichess can't be reached: the build stops (what was built so far is kept). */
class ExplorerOffline extends Error {}

/** Waits `ms`, or less if the build is cancelled. */
async function pause(ms: number, signal: { cancelled: boolean }) {
  const end = Date.now() + ms;
  while (Date.now() < end && !signal.cancelled) await new Promise((r) => setTimeout(r, 500));
}

type WhyState = { status: "asking" } | { status: "done"; text: string } | { status: "error"; message: string };

interface RepertoireState {
  ready: boolean;
  list: RepertoireInfo[];
  reps: Record<number, Repertoire>;
  selected: number | null;
  wizardOpen: boolean;
  build: BuildState | null;
  /** Where recent games left the repertoires (null = not looked yet). */
  deviations: Deviation[] | null;
  /** Claude's "why" for your move, per "repId|epd" (while asking / on error). */
  why: Record<string, WhyState>;

  init(): Promise<void>;
  reload(): Promise<void>;
  select(id: number | null): void;
  openWizard(open: boolean): void;
  create(name: string, color: Color, meta: RepertoireMeta): Promise<number>;
  rename(id: number, name: string): Promise<void>;
  remove(id: number): Promise<void>;
  /** Replaces a repertoire's moves (and saves them). */
  setMoves(id: number, moves: RepMove[]): Promise<void>;
  useMyMove(fen: string, uci: string): Promise<void>;
  addOpponentMove(fen: string, uci: string): Promise<void>;
  removeMoveAt(epd: string, uci: string): Promise<void>;
  /** Adds the moves on the analysis board (from the start) to the selected repertoire. */
  addBoardLine(): Promise<void>;
  setNote(epd: string, note: string): Promise<void>;
  /** Builds (or extends) a repertoire automatically. */
  runBuild(id: number, seeds: string[][], from?: { fen: string; ply: number; reach: number }): Promise<void>;
  cancelBuild(): void;
  exportPgn(id: number): Promise<void>;
  importPgn(id: number): Promise<void>;
  loadDeviations(): Promise<void>;
  askWhy(fen: string, force?: boolean): Promise<void>;
}

const toRepertoire = (d: Awaited<ReturnType<typeof backend.repertoireGet>>): Repertoire => ({
  id: d.info.id,
  name: d.info.name,
  color: d.info.color,
  moves: d.moves,
  notes: Object.fromEntries(d.notes.map((n) => [n.epd, n])),
  meta: d.info.meta ?? {},
});

const toast = (m: string) => useToast.getState().show(m);
const epdOf = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

/** Explorer numbers for the builder; castling written the standard way (e1g1). */
function statsOf(fen: string, r: ExplorerResult | null | undefined): MoveStats | null {
  if (!r) return null;
  return {
    total: r.white + r.draws + r.black,
    moves: r.moves.map((m) => ({ uci: playUci(fen, m.uci)?.uci ?? m.uci, san: m.san, games: m.white + m.draws + m.black })),
  };
}

/**
 * The builder's link to the real explorer and engine:
 * - opponent replies come from Lichess games at your level (with a token), else from masters;
 * - theory moves come from masters (or your level, when masters have few games);
 * - Stockfish checks the candidates at a quick depth.
 */
function liveOracle(signal: { cancelled: boolean }, onWait: (waiting: boolean) => void): BuildOracle {
  const ask = async (source: "masters" | "lichess", fen: string): Promise<ExplorerResult | null> => {
    for (;;) {
      const reply = await backend.explorerQuery(source, fen).catch(() => null);
      if (reply?.result) return reply.result; // a fresh answer, or an old cached one
      if (reply?.errorKind === "lichessRateLimited" && !signal.cancelled) {
        // Lichess asked us to slow down: wait a minute, then ask again.
        onWait(true);
        await pause(61_000, signal);
        onWait(false);
        if (signal.cancelled) return null;
        continue;
      }
      // Without a network, going on would build lines with missing replies: stop instead.
      if (!reply || reply.errorKind === "lichessNetwork") throw new ExplorerOffline();
      return null; // no token, a refused token, or no data: use the other source
    }
  };
  return {
    async opponentMoves(fen) {
      if (useExplorer.getState().tokenSaved !== false) {
        const level = await ask("lichess", fen);
        if (level) return statsOf(fen, level);
      }
      return statsOf(fen, await ask("masters", fen));
    },
    async theoryMoves(fen) {
      const masters = await ask("masters", fen);
      if (masters && masters.white + masters.draws + masters.black >= 20) return statsOf(fen, masters);
      if (useExplorer.getState().tokenSaved === false) return statsOf(fen, masters);
      return statsOf(fen, (await ask("lichess", fen)) ?? masters);
    },
    async evaluate(fen, candidates) {
      const a = useAnalysis.getState();
      const lines = await a.evaluatePosition(fen, BUILD_DEPTH);
      const best = lines[0];
      if (!best?.pvUci[0]) return { best: null, moves: {} };
      const forMover = (winWhite: number) => (turnOf(fen) === "white" ? winWhite : 100 - winWhite);
      const evals = candidates.length ? await a.evaluateMoves(fen, candidates, BUILD_DEPTH) : {};
      const moves: Record<string, number> = {};
      for (const u of candidates) {
        const line = evals[u] ?? lines.find((l) => l.pvUci[0] === u);
        if (line) moves[u] = forMover(line.winWhite);
      }
      return { best: { uci: best.pvUci[0], win: forMover(best.winWhite) }, moves };
    },
  };
}

// Saves happen one after another, in order.
let saving: Promise<unknown> = Promise.resolve();
const queueSave = (job: () => Promise<unknown>) => {
  saving = saving.then(job, job).catch(() => {});
  return saving;
};

export const useRepertoire = create<RepertoireState>((set, get) => {
  const current = (): Repertoire | null => {
    const id = get().selected;
    return id != null ? (get().reps[id] ?? null) : null;
  };

  return {
    ready: false,
    list: [],
    reps: {},
    selected: null,
    wizardOpen: false,
    build: null,
    deviations: null,
    why: {},

    async init() {
      await get().reload();
      set({ ready: true });
    },

    async reload() {
      try {
        const list = await backend.repertoireList();
        const reps: Record<number, Repertoire> = {};
        for (const info of list) reps[info.id] = toRepertoire(await backend.repertoireGet(info.id));
        const selected = get().selected != null && reps[get().selected as number] ? get().selected : (list[0]?.id ?? null);
        set({ list, reps, selected });
      } catch (e) {
        toast(toBackendError(e).message);
      }
    },

    select(id) {
      set({ selected: id });
      const rep = id != null ? get().reps[id] : null;
      if (rep) useAnalysis.setState({ orientation: rep.color });
    },

    openWizard(open) {
      set({ wizardOpen: open });
    },

    async create(name, color, meta) {
      const id = await backend.repertoireCreate(name, color, meta);
      await get().reload();
      return id;
    },

    async rename(id, name) {
      await backend.repertoireUpdate(id, name, null);
      await get().reload();
    },

    async remove(id) {
      await backend.repertoireDelete(id);
      if (get().selected === id) set({ selected: null });
      await get().reload();
    },

    async setMoves(id, moves) {
      const rep = get().reps[id];
      if (!rep) return;
      set((s) => ({ reps: { ...s.reps, [id]: { ...rep, moves } } }));
      await queueSave(() => backend.repertoireSaveMoves(id, moves));
    },

    async useMyMove(fen, uci) {
      const rep = current();
      if (rep) await get().setMoves(rep.id, setMyMove(rep, fen, uci, "user"));
    },

    async addOpponentMove(fen, uci) {
      const rep = current();
      if (rep) await get().setMoves(rep.id, addReply(rep, fen, uci, null, "user"));
    },

    async removeMoveAt(epd, uci) {
      const rep = current();
      if (rep) await get().setMoves(rep.id, removeMove(rep, epd, uci));
    },

    async addBoardLine() {
      const rep = current();
      if (!rep) return;
      const a = useAnalysis.getState();
      const path = treePath(a.tree, a.current);
      if (path[0]?.fen !== START_FEN) {
        toast(tNow("rep.addLineNeedsStart"));
        return;
      }
      const ucis = path.slice(1).map((n) => n.uci as string);
      const r = addLine(rep, START_FEN, ucis, "user", true);
      await get().setMoves(rep.id, r.moves);
      toast(r.added ? tNow("rep.lineAdded", { count: r.added }) : tNow("rep.lineAlreadyThere"));
    },

    async setNote(epd, note) {
      const rep = current();
      if (!rep) return;
      const old = rep.notes[epd];
      if ((old?.note ?? "") === note) return;
      const notes = { ...rep.notes, [epd]: { epd, note, why: old?.why ?? null } };
      set((s) => ({ reps: { ...s.reps, [rep.id]: { ...rep, notes } } }));
      await backend.repertoireSetNote(rep.id, epd, note, null).catch((e) => toast(toBackendError(e).message));
    },

    async runBuild(id, seeds, from) {
      const rep = get().reps[id];
      if (!rep || get().build) return;
      const settings = useApp.getState().settings;
      const signal = { cancelled: false };
      let lastSave = Date.now();
      set({ build: { repId: id, name: rep.name, progress: { done: 0, waiting: 0, moves: rep.moves.length }, signal, waiting: false } });
      // The engine is needed to choose moves outside known theory.
      if (!useAnalysis.getState().engineOn) useAnalysis.getState().setEngine(true);
      try {
        const onWait = (waiting: boolean) => set((s) => (s.build ? { build: { ...s.build, waiting } } : {}));
        const result = await buildRepertoire(rep, seeds, liveOracle(signal, onWait), {
          minShare: settings?.repMinShare ?? 5,
          minReach: settings?.repMinReach ?? 1,
          maxPlies: (settings?.repDepth ?? 12) * 2,
          maxPositions: BUILD_BUDGET,
          signal,
          from,
          onProgress: (progress) => set((s) => (s.build ? { build: { ...s.build, progress } } : {})),
          onCheckpoint: (moves) => {
            // Show the new moves at once; save them at most every few seconds.
            set((s) => ({ reps: { ...s.reps, [id]: { ...s.reps[id], moves } } }));
            if (Date.now() - lastSave > 4000) {
              lastSave = Date.now();
              void queueSave(() => backend.repertoireSaveMoves(id, moves));
            }
          },
        });
        await get().setMoves(id, result.moves);
        const meta: RepertoireMeta = { ...(get().reps[id]?.meta ?? {}), builtAt: Date.now(), incomplete: result.incomplete };
        await backend.repertoireUpdate(id, null, meta);
        set((s) => ({ reps: { ...s.reps, [id]: { ...s.reps[id], meta } } }));
        toast(result.incomplete ? tNow("rep.buildStopped") : tNow("rep.buildDone"));
      } catch (e) {
        // Keep what was built so far, marked as unfinished ("Continue building" goes on).
        const moves = get().reps[id]?.moves;
        if (moves) await get().setMoves(id, moves);
        const meta: RepertoireMeta = { ...(get().reps[id]?.meta ?? {}), incomplete: true };
        await backend.repertoireUpdate(id, null, meta).catch(() => {});
        set((s) => ({ reps: { ...s.reps, [id]: { ...s.reps[id], meta } } }));
        toast(e instanceof ExplorerOffline ? tNow("rep.buildOffline") : toBackendError(e).message);
      } finally {
        set({ build: null });
        const list = await backend.repertoireList().catch(() => get().list);
        set({ list });
      }
    },

    cancelBuild() {
      const b = get().build;
      if (b) b.signal.cancelled = true;
    },

    async exportPgn(id) {
      const rep = get().reps[id];
      if (!rep) return;
      try {
        const name = await backend.fileSaveText(`${rep.name.replace(/[^\p{L}\p{N} .·_-]/gu, "")}.pgn`, "PGN", "pgn", repertoireToPgn(rep));
        if (name) toast(tNow("data.saved", { name }));
      } catch (e) {
        toast(toBackendError(e).message);
      }
    },

    async importPgn(id) {
      const rep = get().reps[id];
      if (!rep) return;
      try {
        const file = await backend.fileOpenText("PGN", ["pgn"]);
        if (!file) return;
        const r = repertoireFromPgn(rep, file.contents);
        if (r.color && r.color !== rep.color) {
          toast(tNow("rep.importWrongColor"));
          return;
        }
        await get().setMoves(id, r.moves);
        for (const n of r.notes) await backend.repertoireSetNote(id, n.epd, n.note, null);
        await get().reload();
        toast(tNow("rep.imported", { count: r.added, conflicts: r.conflicts }));
      } catch (e) {
        toast(toBackendError(e).message);
      }
    },

    async loadDeviations() {
      try {
        const games = await backend.recentGameMoves(50, 40);
        const reps = Object.values(get().reps);
        const deviations = games.map((g) => deviationOf(reps, g)).filter((d): d is Deviation => d !== null);
        set({ deviations });
      } catch (e) {
        toast(toBackendError(e).message);
        set({ deviations: [] });
      }
    },

    async askWhy(fen, force = false) {
      const rep = current();
      const mine = rep ? nodeAt(rep, fen)?.mine : null;
      if (!rep || !mine) return;
      const key = `${rep.id}|${epdOf(fen)}`;
      set((s) => ({ why: { ...s.why, [key]: { status: "asking" } } }));
      try {
        const answer = (!force && (await cachedWhy(fen, mine.uci))) || (await askWhy(fen, mine.uci));
        await backend.repertoireSetNote(rep.id, epdOf(fen), null, answer.summary);
        const old = rep.notes[epdOf(fen)];
        const notes = { ...rep.notes, [epdOf(fen)]: { epd: epdOf(fen), note: old?.note ?? "", why: answer.summary } };
        set((s) => ({ reps: { ...s.reps, [rep.id]: { ...s.reps[rep.id], notes } }, why: { ...s.why, [key]: { status: "done", text: answer.summary } } }));
      } catch (e) {
        set((s) => ({ why: { ...s.why, [key]: { status: "error", message: toBackendError(e).message } } }));
      }
    },
  };
});

/** The Repertoire page shows the board (not the wizard): there's a repertoire and the wizard is closed. */
export function useRepertoireBoard(): boolean {
  return useRepertoire((s) => s.ready && s.list.length > 0 && !s.wizardOpen);
}
