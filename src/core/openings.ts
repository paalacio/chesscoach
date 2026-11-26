// Opening names from the bundled CC0 dataset lichess-org/chess-openings
// (built into src/data/openings.json by scripts/build-openings.mjs).

import data from "../data/openings.json";
import { epdOf } from "./chess";

export interface Opening {
  eco: string;
  name: string;
}

const table = data as unknown as Record<string, [string, string]>;

export function lookupOpening(fen: string): Opening | null {
  const hit = table[epdOf(fen)];
  return hit ? { eco: hit[0], name: hit[1] } : null;
}

export interface OpeningInfo {
  /** The most specific named opening reached along the line. */
  opening: Opening | null;
  /** True if the current position itself is a named "book" position. */
  inBook: boolean;
  /** Index (into `fens`) of the last named position, i.e. where the line left book. */
  lastBookIndex: number | null;
}

/**
 * Looks at the positions of a line (root first) and finds the opening.
 * "In book" here means "the position has a name in the opening list". That list
 * only names well-known positions, so it's a rough signal; the opening explorer
 * (a later phase) gives a better one.
 */
export function openingOfLine(fens: string[]): OpeningInfo {
  let opening: Opening | null = null;
  let lastBookIndex: number | null = null;
  fens.forEach((fen, i) => {
    const o = lookupOpening(fen);
    if (o) {
      opening = o;
      lastBookIndex = i;
    }
  });
  return { opening, inBook: lastBookIndex !== null && lastBookIndex === fens.length - 1, lastBookIndex };
}
