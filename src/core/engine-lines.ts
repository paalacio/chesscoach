// Turning raw engine `info` lines into display-ready candidate lines.

import { turnOf, uciLineToSan } from "./chess";
import type { Color, EngineLine, InfoLine } from "./types";
import { toWhitePov, winFor, winPercent } from "./winprob";

/** How many moves of each line we convert to SAN and show. */
export const PV_DISPLAY_MOVES = 14;

export function infoToLine(fen: string, info: InfoLine): EngineLine {
  const scoreWhite = toWhitePov(info.score, turnOf(fen));
  return {
    multipv: info.multipv,
    depth: info.depth,
    scoreWhite,
    winWhite: winPercent(scoreWhite),
    pvUci: info.pv,
    pvSan: uciLineToSan(fen, info.pv, PV_DISPLAY_MOVES),
    nodes: info.nodes,
    nps: info.nps,
  };
}

/**
 * Merges a new info line into the current set of lines (one per MultiPV slot).
 * Lines whose score is only a bound (lowerbound/upperbound) are skipped: they're
 * provisional and make the display flicker.
 */
export function mergeInfo(lines: EngineLine[], fen: string, info: InfoLine, multipv: number): EngineLine[] {
  if (info.bound || info.pv.length === 0 || info.multipv > multipv) return lines;
  const line = infoToLine(fen, info);
  const next = lines.filter((l) => l.multipv !== info.multipv && l.multipv <= multipv);
  next.push(line);
  return next.sort((a, b) => a.multipv - b.multipv);
}

/** The deepest depth all shown lines have reached (what the UI shows as "depth"). */
export function linesDepth(lines: EngineLine[]): number {
  return lines.length === 0 ? 0 : Math.min(...lines.map((l) => l.depth));
}

/**
 * A move counts as "about as good" as the best one when the side to move loses
 * at most this many win-% points by playing it instead. That's roughly how much
 * Stockfish's own evaluation moves around between depths, so the engine can't
 * really tell these moves apart.
 */
export const AS_GOOD_POINTS = 3;
/** Up to this many points worse: still a reasonable, "playable" alternative. */
export const PLAYABLE_POINTS = 8;

export type Verdict = "best" | "asGood" | "playable" | "worse";

/** How much worse (in win-% points, for the side to move) a line is than the best one. */
export function pointsBehindBest(lines: EngineLine[], line: EngineLine, turn: Color): number {
  if (lines.length === 0) return 0;
  return Math.max(0, winFor(turn, lines[0].winWhite) - winFor(turn, line.winWhite));
}

export function verdictOf(lines: EngineLine[], index: number, turn: Color): Verdict {
  if (index === 0) return "best";
  const behind = pointsBehindBest(lines, lines[index], turn);
  if (behind <= AS_GOOD_POINTS) return "asGood";
  if (behind <= PLAYABLE_POINTS) return "playable";
  return "worse";
}

/** The best line plus every line about as good as it (for the board arrows). */
export function goodLines(lines: EngineLine[], turn: Color): EngineLine[] {
  return lines.filter((_, i) => verdictOf(lines, i, turn) === "best" || verdictOf(lines, i, turn) === "asGood");
}
