// Game review: turns the engine's evaluation of every position (computed in the
// background by the Rust worker, src-tauri/src/review.rs) into what the review
// screen shows: move judgements, accuracy per phase, key moments, where the game
// left the opening, and training cards for the user's mistakes.

import { turnOf, uciLineToSan } from "./chess";
import { mainlineFrom, ROOT, treeFromPgn } from "./game-tree";
import { type Opening, lookupOpening } from "./openings";
import { divideGame, phaseAt } from "./phase";
import type { Color, Judgement, Phase, Score } from "./types";
import { classifyMove, moveAccuracy, winFor, winPercent } from "./winprob";

/** One position's evaluation, as stored by the Rust worker (White's point of view). */
export interface PositionEval {
  score: Score | null;
  best: string | null;
  pv: string[];
  depth: number;
}

export interface GameAnalysis {
  version: number;
  engine: string;
  depth: number;
  /** evals[0] = start position, evals[k] = after k moves. */
  evals: PositionEval[];
}

export interface GameMove {
  /** 1 = White's first move (or the first move after a custom start). */
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
}

export interface MoveReview extends GameMove {
  /** Index into the moves array. */
  index: number;
  color: Color;
  /** White's win chance before and after the move (0-100). */
  winBefore: number;
  winAfter: number;
  /** The mover's win chance before and after. */
  moverBefore: number;
  moverAfter: number;
  judgement: Judgement | null;
  accuracy: number;
  /** Phase of the position the move was played in. */
  phase: Phase;
  bestUci: string | null;
  bestSan: string | null;
  /** Engine's line from the position before the move, in SAN. */
  bestLine: string[];
  isBest: boolean;
}

export type PhaseAccuracy = Record<Phase | "overall", number | null>;

export interface GameReview {
  moves: MoveReview[];
  /** Index of the first position of the middlegame / endgame (in positions, 0 = start). */
  division: { middlegame: number | null; endgame: number | null };
  accuracy: Record<Color, PhaseAccuracy>;
  counts: Record<Color, Record<Judgement, number>>;
  /** Indices into `moves` of the biggest swings, in game order. */
  keyMoments: number[];
  opening: Opening | null;
  /** The first move played after the last named opening position. */
  leftBook: { index: number; byMe: boolean } | null;
  /** White's win chance for each position (for the graph). */
  winCurve: number[];
}

/** Reads the main line of a PGN into moves with their positions. */
export function movesFromPgn(pgn: string): { startFen: string; moves: GameMove[] } {
  const tree = treeFromPgn(pgn);
  const line = mainlineFrom(tree, ROOT);
  const moves: GameMove[] = [];
  for (let i = 1; i < line.length; i++) {
    moves.push({
      ply: i,
      san: line[i].san as string,
      uci: line[i].uci as string,
      fenBefore: line[i - 1].fen,
      fenAfter: line[i].fen,
    });
  }
  return { startFen: line[0].fen, moves };
}

/** A drop of at least this many win-% points makes a move a candidate key moment (just under "inaccuracy"). */
const KEY_MOMENT_MIN_DROP = 7.5;
const MAX_KEY_MOMENTS = 5;

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function standardDeviation(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

/**
 * Lichess's game accuracy (lila AccuracyPercent.gameAccuracy, read Nov 2026):
 * for each side, the average of
 *  - a mean of the per-move accuracies weighted by how volatile the game was
 *    around each move (standard deviation of win% in a sliding window), and
 *  - their harmonic mean (which punishes a few very bad moves strongly).
 * `wins` is White's win% for each position; the first move is White's if `firstIsWhite`.
 */
export function gameAccuracy(wins: number[], firstIsWhite: boolean): Record<Color, number | null> {
  const n = wins.length;
  const windowSize = clamp(Math.floor((n - 1) / 10), 2, 8);
  const windows: number[][] = [];
  for (let i = 0; i < Math.min(windowSize, n) - 2; i++) windows.push(wins.slice(0, windowSize));
  if (n < windowSize) windows.push(wins.slice());
  for (let i = 0; i + windowSize <= n; i++) windows.push(wins.slice(i, i + windowSize));
  const weights = windows.map((w) => clamp(standardDeviation(w), 0.5, 12));

  const per: Record<Color, { acc: number; w: number }[]> = { white: [], black: [] };
  for (let i = 0; i + 1 < n && i < weights.length; i++) {
    const color: Color = (i % 2 === 0) === firstIsWhite ? "white" : "black";
    const before = color === "white" ? wins[i] : 100 - wins[i];
    const after = color === "white" ? wins[i + 1] : 100 - wins[i + 1];
    per[color].push({ acc: moveAccuracy(before, after), w: weights[i] });
  }
  const result = (xs: { acc: number; w: number }[]) => {
    if (xs.length === 0) return null;
    const weighted = xs.reduce((a, x) => a + x.acc * x.w, 0) / xs.reduce((a, x) => a + x.w, 0);
    // 1/0 is Infinity, so a 0% move pulls the harmonic mean to 0, as in Lichess.
    const harmonic = xs.length / xs.reduce((a, x) => a + 1 / x.acc, 0);
    return round1((weighted + harmonic) / 2);
  };
  return { white: result(per.white), black: result(per.black) };
}

export function reviewGame(startFen: string, moves: GameMove[], analysis: GameAnalysis, myColor: Color): GameReview {
  const evals = analysis.evals;
  if (evals.length < moves.length + 1) {
    throw new Error(`The analysis has ${evals.length} positions but the game has ${moves.length + 1}.`);
  }
  // A missing score counts as equal (shouldn't happen with Stockfish).
  const winCurve = evals.slice(0, moves.length + 1).map((e) => (e.score ? winPercent(e.score) : 50));
  const fens = [startFen, ...moves.map((m) => m.fenAfter)];
  const division = divideGame(fens);

  const reviewed: MoveReview[] = moves.map((m, i) => {
    const color = turnOf(m.fenBefore);
    const moverBefore = winFor(color, winCurve[i]);
    const moverAfter = winFor(color, winCurve[i + 1]);
    const bestUci = evals[i].best;
    const isBest = bestUci === m.uci;
    const line = evals[i].pv.length ? evals[i].pv : bestUci ? [bestUci] : [];
    const bestLine = line.length ? uciLineToSan(m.fenBefore, line.slice(0, 6)) : [];
    return {
      ...m,
      index: i,
      color,
      winBefore: winCurve[i],
      winAfter: winCurve[i + 1],
      moverBefore,
      moverAfter,
      // The engine's own move is never a mistake (it can look like one when the
      // evaluation shifts between depths).
      judgement: isBest ? null : classifyMove(moverBefore, moverAfter),
      accuracy: moveAccuracy(moverBefore, moverAfter),
      phase: phaseAt(i, division),
      bestUci,
      bestSan: bestLine[0] ?? null,
      bestLine,
      isBest,
    };
  });

  // Accuracy like Lichess: for the whole game, and for the positions of each phase.
  const firstIsWhite = turnOf(startFen) === "white";
  const overall = gameAccuracy(winCurve, firstIsWhite);
  const perPhase = {} as Record<Phase, Record<Color, number | null>>;
  for (const phase of ["opening", "middlegame", "endgame"] as Phase[]) {
    // Lichess's slice: positions in the phase, plus the one just before it starts.
    const idx = winCurve.map((_, i) => i).filter((i) => phaseAt(i, division) === phase || phaseAt(i + 1, division) === phase);
    const slice = idx.map((i) => winCurve[i]);
    perPhase[phase] =
      slice.length >= 2 ? gameAccuracy(slice, turnOf(fens[idx[0]]) === "white") : { white: null, black: null };
  }
  const accuracy = {} as Record<Color, PhaseAccuracy>;
  const counts = {} as Record<Color, Record<Judgement, number>>;
  for (const color of ["white", "black"] as Color[]) {
    accuracy[color] = {
      opening: perPhase.opening[color],
      middlegame: perPhase.middlegame[color],
      endgame: perPhase.endgame[color],
      overall: overall[color],
    };
    counts[color] = { inaccuracy: 0, mistake: 0, blunder: 0 };
    for (const m of reviewed) if (m.color === color && m.judgement) counts[color][m.judgement]++;
  }

  // Key moments: the biggest drops in the mover's win chance, shown in game order.
  const keyMoments = reviewed
    .filter((m) => m.moverBefore - m.moverAfter >= KEY_MOMENT_MIN_DROP && !m.isBest)
    .sort((a, b) => b.moverBefore - b.moverAfter - (a.moverBefore - a.moverAfter))
    .slice(0, MAX_KEY_MOMENTS)
    .map((m) => m.index)
    .sort((a, b) => a - b);

  // Opening: the last position along the game that has a name.
  let opening: Opening | null = null;
  let lastNamed = -1;
  fens.forEach((fen, i) => {
    const o = lookupOpening(fen);
    if (o) {
      opening = o;
      lastNamed = i;
    }
  });
  const leftIndex = lastNamed + 1 <= moves.length - 1 ? Math.max(0, lastNamed) : null;
  const leftBook =
    leftIndex === null ? null : { index: leftIndex, byMe: reviewed[leftIndex].color === myColor };

  return { moves: reviewed, division, accuracy, counts, keyMoments, opening, leftBook, winCurve };
}

/** What the games list shows for a reviewed game (saved by the backend). */
export interface ReviewSummary {
  accuracy: number | null;
  opponentAccuracy: number | null;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  openingEco: string | null;
  openingName: string | null;
  /** Your accuracy per phase (added in version 2, for Insights). */
  phases?: Record<Phase, number | null>;
  /** 2 = has `phases`. Older summaries are recomputed from the stored analysis. */
  version?: number;
}

export const SUMMARY_VERSION = 2;

export function summarize(review: GameReview, myColor: Color): ReviewSummary {
  const opp: Color = myColor === "white" ? "black" : "white";
  const c = review.counts[myColor];
  return {
    accuracy: review.accuracy[myColor].overall,
    opponentAccuracy: review.accuracy[opp].overall,
    inaccuracies: c.inaccuracy,
    mistakes: c.mistake,
    blunders: c.blunder,
    openingEco: review.opening?.eco ?? null,
    openingName: review.opening?.name ?? null,
    phases: {
      opening: review.accuracy[myColor].opening,
      middlegame: review.accuracy[myColor].middlegame,
      endgame: review.accuracy[myColor].endgame,
    },
    version: SUMMARY_VERSION,
  };
}

/** A "find the better move" card (stored by the backend; trained in Phase 4). */
export interface TrainingCard {
  ply: number;
  fen: string;
  playedUci: string;
  playedSan: string;
  bestUci: string;
  bestSan: string;
  judgement: Judgement;
  winBefore: number;
  winAfter: number;
}

/** Every mistake or blunder the user made becomes a card. */
export function trainingCards(review: GameReview, myColor: Color): TrainingCard[] {
  return review.moves
    .filter((m) => m.color === myColor && (m.judgement === "mistake" || m.judgement === "blunder") && m.bestUci && m.bestSan)
    .map((m) => ({
      ply: m.ply,
      fen: m.fenBefore,
      playedUci: m.uci,
      playedSan: m.san,
      bestUci: m.bestUci as string,
      bestSan: m.bestSan as string,
      judgement: m.judgement as Judgement,
      winBefore: round1(m.moverBefore),
      winAfter: round1(m.moverAfter),
    }));
}

/** "?!", "?", "??" */
export function judgementGlyph(j: Judgement | null): string {
  return j === "blunder" ? "??" : j === "mistake" ? "?" : j === "inaccuracy" ? "?!" : "";
}
