// Turning raw engine `info` lines into display-ready candidate lines.

import { turnOf, uciLineToSan } from "./chess";
import type { EngineLine, InfoLine } from "./types";
import { toWhitePov, winPercent } from "./winprob";

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
