// Builds a repertoire automatically from a few chosen lines (the "seeds").
//
// Starting from the seeds, it walks the positions most likely to come up first:
// - where it's your turn and you have no move yet, it picks the move strong players
//   choose most often (from the masters explorer), if Stockfish thinks it's about as
//   good as its own best move; otherwise Stockfish's move;
// - where it's the opponent's turn, it adds every reply that at least `minShare` % of
//   players at your level choose, as long as the whole line still comes up in at least
//   `minReach` % of your games.
// It stops at `maxPlies` half-moves, or after asking about `maxPositions` positions.
//
// The explorer and the engine come in through `BuildOracle`, so this file has no
// network or engine code (and tests can use a fake).

import { AS_GOOD_POINTS } from "./engine-lines";
import { epdOf, playUci, START_FEN, turnOf } from "./chess";
import { addLine, addReply, type Repertoire, type RepMove, setMyMove } from "./repertoire";

export interface MoveStat {
  uci: string;
  san: string;
  /** Games in which this move was played. */
  games: number;
}

export interface MoveStats {
  /** Games that reached the position. */
  total: number;
  /** Most played first. */
  moves: MoveStat[];
}

export interface BuildOracle {
  /** What opponents at your level play here (null if it can't be found out). */
  opponentMoves(fen: string): Promise<MoveStats | null>;
  /** What strong players play here (null if it can't be found out). */
  theoryMoves(fen: string): Promise<MoveStats | null>;
  /**
   * Stockfish: its best move here and how good some candidate moves are, as win
   * chances (0-100) for the side to move. `best` is null if there's no engine.
   */
  evaluate(fen: string, candidates: string[]): Promise<{ best: { uci: string; win: number } | null; moves: Record<string, number> }>;
}

export interface BuildOptions {
  /** % of games at your level a reply needs, to be included. */
  minShare: number;
  /** % of your games the whole line must come up in. */
  minReach: number;
  /** Stop lines after this many half-moves. */
  maxPlies: number;
  /** Ask about at most this many positions (the explorer is asked once per position). */
  maxPositions: number;
  /** Set `cancelled` to true to stop early (what was built so far is kept). */
  signal?: { cancelled: boolean };
  onProgress?: (p: BuildProgress) => void;
  /** Called after every position with the moves so far (to show them, and save them now and then). */
  onCheckpoint?: (moves: RepMove[]) => void;
  /** Only fill in what follows this position (default: the whole repertoire, from the start). */
  from?: { fen: string; ply: number; reach: number };
}

export interface BuildProgress {
  /** Positions looked at. */
  done: number;
  /** Positions still waiting. */
  waiting: number;
  /** Moves in the repertoire so far. */
  moves: number;
}

export interface BuildResult {
  moves: RepMove[];
  /** Stopped before finishing (budget reached or cancelled). */
  incomplete: boolean;
  /** Seed lines that disagreed with a move already in the repertoire. */
  conflicts: number;
}

/** Reads seed lines into the repertoire. */
export function seedRepertoire(rep: Repertoire, seeds: string[][]): { moves: RepMove[]; conflicts: number } {
  let moves = rep.moves;
  let conflicts = 0;
  for (const line of seeds) {
    const r = addLine({ ...rep, moves }, START_FEN, line, "claude");
    moves = r.moves;
    conflicts += r.conflicts;
  }
  return { moves, conflicts };
}

/** Theory moves worth checking: at most 3, each played in at least 2% of the games (and 5 games). */
function theoryCandidates(stats: MoveStats | null): MoveStat[] {
  if (!stats || stats.total === 0) return [];
  return stats.moves.filter((m) => m.games >= Math.max(5, stats.total * 0.02)).slice(0, 3);
}

/**
 * Chooses your move: the most played theory move that's about as good as the
 * engine's best, else the engine's best. Null if nothing is known and there's no engine.
 */
export async function chooseMyMove(fen: string, oracle: BuildOracle): Promise<{ uci: string; source: "theory" | "engine" } | null> {
  const candidates = theoryCandidates(await oracle.theoryMoves(fen));
  const { best, moves } = await oracle.evaluate(
    fen,
    candidates.map((c) => c.uci),
  );
  if (!best) return candidates[0] ? { uci: candidates[0].uci, source: "theory" } : null;
  const good = candidates.find((c) => moves[c.uci] != null && moves[c.uci] >= best.win - AS_GOOD_POINTS);
  return good ? { uci: good.uci, source: "theory" } : { uci: best.uci, source: "engine" };
}

export async function buildRepertoire(rep: Repertoire, seeds: string[][], oracle: BuildOracle, opts: BuildOptions): Promise<BuildResult> {
  const seeded = seedRepertoire(rep, seeds);
  let moves = seeded.moves;
  const current = () => ({ ...rep, moves });

  // Positions most likely to come up first (a simple sorted list is fine at this size).
  const queue: { fen: string; ply: number; reach: number }[] = [opts.from ?? { fen: START_FEN, ply: 0, reach: 1 }];
  const seen = new Set<string>();
  let asked = 0;
  let done = 0;
  let incomplete = false;

  const report = () => opts.onProgress?.({ done, waiting: queue.length, moves: moves.length });

  while (queue.length) {
    if (opts.signal?.cancelled || asked >= opts.maxPositions) {
      incomplete = true;
      break;
    }
    queue.sort((a, b) => b.reach - a.reach || a.ply - b.ply);
    const { fen, ply, reach } = queue.shift() as (typeof queue)[number];
    const epd = epdOf(fen);
    if (seen.has(epd)) continue;
    seen.add(epd);
    done++;

    if (turnOf(fen) === rep.color) {
      // Your turn: keep the move you have, or choose one.
      let mine = moves.find((m) => m.mine && m.epd === epd);
      if (!mine) {
        asked++;
        const choice = await chooseMyMove(fen, oracle);
        if (choice) {
          moves = setMyMove(current(), fen, choice.uci, choice.source);
          mine = moves.find((m) => m.mine && m.epd === epd);
        }
      }
      const next = mine && playUci(fen, mine.uci);
      if (next) queue.push({ fen: next.fen, ply: ply + 1, reach });
    } else {
      // The opponent's turn: lines end here once they're deep enough.
      if (ply >= opts.maxPlies) continue;
      asked++;
      const stats = await oracle.opponentMoves(fen);
      if (stats && stats.total > 0) {
        for (const m of stats.moves) {
          const share = (100 * m.games) / stats.total;
          const known = moves.some((x) => !x.mine && x.epd === epd && x.uci === m.uci);
          const wanted = share >= opts.minShare && reach * share >= opts.minReach;
          // Moves already in the repertoire (from the seeds) get their share filled in.
          if (known || wanted) moves = addReply(current(), fen, m.uci, Math.round(share * 10) / 10, known ? "claude" : "explorer");
        }
      }
      for (const r of moves.filter((x) => !x.mine && x.epd === epd)) {
        const next = playUci(fen, r.uci);
        if (next) queue.push({ fen: next.fen, ply: ply + 1, reach: (reach * (r.share ?? opts.minShare)) / 100 });
      }
    }
    report();
    opts.onCheckpoint?.(moves);
  }
  report();
  return { moves, incomplete, conflicts: seeded.conflicts };
}
