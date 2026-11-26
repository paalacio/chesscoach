// Game phase detection (opening / middlegame / endgame).
//
// Ported from Lichess's "Divider" (scalachess core/src/main/scala/Divider.scala,
// MIT licence, read Nov 2026). In short:
// - the middlegame starts at the first position where
//     (a) there are 10 or fewer pieces other than kings and pawns, or
//     (b) either side's back rank has fewer than 4 of its own pieces left
//         (pieces have been developed), or
//     (c) the "mixedness" score is above 150 (White and Black pieces are
//         tangled up together in the middle of the board);
// - the endgame starts at the first position (after the middlegame started)
//   with 6 or fewer pieces other than kings and pawns.

import type { Board } from "chessops/board";
import { SquareSet } from "chessops/squareSet";
import { positionFromFen } from "./chess";
import type { Phase } from "./types";

/** Pieces that are not kings or pawns, both sides together. */
export function majorsAndMinors(board: Board): number {
  return board.occupied.diff(board.king).diff(board.pawn).size();
}

/** Fewer than 4 of a side's own pieces on its back rank means it has developed. */
export function backrankSparse(board: Board): boolean {
  return (
    board.white.intersect(SquareSet.fromRank(0)).size() < 4 ||
    board.black.intersect(SquareSet.fromRank(7)).size() < 4
  );
}

/**
 * Lichess's score for one 2x2 block of squares, given how many White and Black
 * pieces are in it and its rank `y` (1-7, counted from White's side).
 */
function regionScore(y: number, white: number, black: number): number {
  switch (white) {
    case 0:
      switch (black) {
        case 1: return 1 + y;
        case 2: return y < 6 ? 2 + (6 - y) : 0;
        case 3: return y < 7 ? 3 + (7 - y) : 0;
        case 4: return y < 7 ? 3 + (7 - y) : 0;
        default: return 0;
      }
    case 1:
      switch (black) {
        case 0: return 1 + (8 - y);
        case 1: return 5 + Math.abs(4 - y);
        case 2: return 4 + (7 - y);
        case 3: return 5 + (7 - y);
        default: return 0;
      }
    case 2:
      switch (black) {
        case 0: return y > 2 ? 2 + (y - 2) : 0;
        case 1: return 4 + (y - 1);
        case 2: return 7;
        default: return 0;
      }
    case 3:
      switch (black) {
        case 0: return y > 1 ? 3 + (y - 1) : 0;
        case 1: return 5 + (y - 1);
        default: return 0;
      }
    case 4:
      return black === 0 && y > 1 ? 3 + (y - 1) : 0; // a group of 4 on the home rank scores 0
    default:
      return 0;
  }
}

/** Sum of the region scores over all 49 overlapping 2x2 blocks of the board. */
export function mixedness(board: Board): number {
  let total = 0;
  for (let y = 0; y <= 6; y++) {
    for (let x = 0; x <= 6; x++) {
      // Squares are numbered a1 = 0, b1 = 1, ..., h8 = 63.
      const squares = [x + 8 * y, x + 1 + 8 * y, x + 8 * (y + 1), x + 1 + 8 * (y + 1)];
      const white = squares.filter((s) => board.white.has(s)).length;
      const black = squares.filter((s) => board.black.has(s)).length;
      total += regionScore(y + 1, white, black);
    }
  }
  return total;
}

export function isMiddlegameBoard(board: Board): boolean {
  return majorsAndMinors(board) <= 10 || backrankSparse(board) || mixedness(board) > 150;
}

export function isEndgameBoard(board: Board): boolean {
  return majorsAndMinors(board) <= 6;
}

/** Phase of a single position (when the game history isn't known). */
export function positionPhase(fen: string): Phase {
  const board = positionFromFen(fen).board;
  if (isEndgameBoard(board)) return "endgame";
  if (isMiddlegameBoard(board)) return "middlegame";
  return "opening";
}

/**
 * Phases of a whole game, from the FEN of every position in order (index = ply
 * offset from the first position). Returns the index where the middlegame and
 * the endgame start, like Lichess's Division.
 */
export function divideGame(fens: string[]): { middlegame: number | null; endgame: number | null } {
  const boards = fens.map((f) => positionFromFen(f).board);
  const mid = boards.findIndex(isMiddlegameBoard);
  const end = mid >= 0 ? boards.findIndex(isEndgameBoard) : -1;
  const endgame = end >= 0 ? end : null;
  // Lichess drops the middlegame marker if the endgame starts at or before it.
  const middlegame = mid >= 0 && (endgame === null || mid < endgame) ? mid : null;
  return { middlegame, endgame };
}

/** Phase at index `i` of a game divided with `divideGame`. */
export function phaseAt(i: number, division: { middlegame: number | null; endgame: number | null }): Phase {
  if (division.endgame !== null && i >= division.endgame) return "endgame";
  if (division.middlegame !== null && i >= division.middlegame) return "middlegame";
  return "opening";
}

/** Phase for the current position of a line, using the whole line so far. */
export function phaseOfLine(fens: string[]): Phase {
  if (fens.length === 0) return "opening";
  return phaseAt(fens.length - 1, divideGame(fens));
}
