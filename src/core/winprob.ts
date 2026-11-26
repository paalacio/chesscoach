// Win probability and move classification, following Lichess.
//
// Sources (read Nov 2026):
// - scalachess core/src/main/scala/eval.scala: winningChances and WinPercent
// - lila modules/tree/src/main/Advice.scala: inaccuracy/mistake/blunder thresholds
// - lila modules/analyse/src/main/AccuracyPercent.scala: accuracy per move

import type { Color, Judgement, Score } from "./types";

/** Centipawn scores are capped at ±1000 before converting (Lichess "ceiling"). Mates count as ±1000. */
export const CP_CEILING = 1000;

/** Fitted by Lichess on real games (https://github.com/lichess-org/lila/pull/11148). */
const MULTIPLIER = -0.00368208;

/** Score as centipawns with Lichess's ceiling; mate in N counts as ±1000. */
export function scoreToCp(score: Score): number {
  // "mate 0" means the side to move is already checkmated.
  if (score.kind === "mate") return score.value > 0 ? CP_CEILING : -CP_CEILING;
  return Math.max(-CP_CEILING, Math.min(CP_CEILING, score.value));
}

/** Winning chances on Lichess's [-1, +1] scale. */
export function winningChances(cp: number): number {
  const capped = Math.max(-CP_CEILING, Math.min(CP_CEILING, cp));
  const wc = 2 / (1 + Math.exp(MULTIPLIER * capped)) - 1;
  return Math.max(-1, Math.min(1, wc));
}

/** Win chance in percent (0-100) for the side whose point of view the score is from. */
export function winPercent(score: Score): number {
  return 50 + 50 * winningChances(scoreToCp(score));
}

/** Engines report scores for the side to move; this flips them to White's point of view. */
export function toWhitePov(score: Score, turn: Color): Score {
  if (turn === "white") return score;
  return { kind: score.kind, value: -score.value };
}

/** Win% for `color`, given White's win%. */
export function winFor(color: Color, winWhite: number): number {
  return color === "white" ? winWhite : 100 - winWhite;
}

/** "+0.35", "−1.20", "#3", "#−2" (White's point of view). Uses a real minus sign. */
export function formatScore(scoreWhite: Score): string {
  const minus = "−";
  if (scoreWhite.kind === "mate") {
    return scoreWhite.value < 0 ? `#${minus}${-scoreWhite.value}` : `#${scoreWhite.value}`;
  }
  const pawns = scoreWhite.value / 100;
  if (Math.abs(pawns) < 0.005) return "0.00";
  return pawns > 0 ? `+${pawns.toFixed(2)}` : `${minus}${Math.abs(pawns).toFixed(2)}`;
}

/**
 * Lichess-style judgement of a move from the mover's win% before and after it.
 * The thresholds are 0.1 / 0.2 / 0.3 on the [-1, 1] winning-chances scale,
 * which is 5 / 10 / 15 points of win% (because win% = 50 + 50 × chances).
 *
 * Note: Lichess judges moves into or out of a forced mate with separate rules
 * (MateAdvice). We treat mates as ±1000 cp here, which is close enough for
 * explanations; Phase 2's game review can refine this.
 */
export function classifyMove(winBeforeMover: number, winAfterMover: number): Judgement | null {
  const delta = (winBeforeMover - winAfterMover) / 50; // drop in winning chances
  if (delta >= 0.3) return "blunder";
  if (delta >= 0.2) return "mistake";
  if (delta >= 0.1) return "inaccuracy";
  return null;
}

/** Lichess accuracy (0-100) of one move, from the mover's win% before and after. */
export function moveAccuracy(winBeforeMover: number, winAfterMover: number): number {
  if (winAfterMover >= winBeforeMover) return 100;
  const winDiff = winBeforeMover - winAfterMover;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) - 3.166924740191411;
  return Math.max(0, Math.min(100, raw + 1)); // +1: Lichess's "uncertainty bonus"
}

/** Plain-English description of White's win chance, for the context packet. */
export function describeWin(winWhite: number): string {
  if (winWhite >= 90) return "White is winning";
  if (winWhite >= 70) return "White is clearly better";
  if (winWhite >= 58) return "White is slightly better";
  if (winWhite > 42) return "about equal";
  if (winWhite > 30) return "Black is slightly better";
  if (winWhite > 10) return "Black is clearly better";
  return "Black is winning";
}
