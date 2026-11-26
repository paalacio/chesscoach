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
const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

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

  const accuracy = {} as Record<Color, PhaseAccuracy>;
  const counts = {} as Record<Color, Record<Judgement, number>>;
  for (const color of ["white", "black"] as Color[]) {
    const mine = reviewed.filter((m) => m.color === color);
    const byPhase = (p: Phase) => mean(mine.filter((m) => m.phase === p).map((m) => m.accuracy));
    accuracy[color] = {
      opening: byPhase("opening"),
      middlegame: byPhase("middlegame"),
      endgame: byPhase("endgame"),
      overall: mean(mine.map((m) => m.accuracy)),
    };
    counts[color] = { inaccuracy: 0, mistake: 0, blunder: 0 };
    for (const m of mine) if (m.judgement) counts[color][m.judgement]++;
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
}

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
