// Small helpers around chessops (the chess rules library).

import { castlingSide, Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, makeSanAndPlay, parseSan } from "chessops/san";
import { kingCastlesTo, makeUci, parseUci } from "chessops/util";
import type { Color } from "./types";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Parses a FEN into a legal position, or throws an Error with a readable message. */
export function positionFromFen(fen: string): Chess {
  const setup = parseFen(fen.trim());
  if (setup.isErr) throw new Error(`That FEN can't be read (${setup.error.message}).`);
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) throw new Error(`That position isn't legal (${pos.error.message}).`);
  return pos.value;
}

export function isValidFen(fen: string): boolean {
  try {
    positionFromFen(fen);
    return true;
  } catch {
    return false;
  }
}

export function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}

/** FEN without the move counters, so the same position always gives the same key. */
export function epdOf(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export function turnOf(fen: string): Color {
  return fen.trim().split(/\s+/)[1] === "b" ? "black" : "white";
}

/** Full move number from the FEN. */
export function moveNumberOf(fen: string): number {
  return Number(fen.trim().split(/\s+/)[5] ?? 1) || 1;
}

/**
 * Plays a UCI move. Returns the new FEN, the move in SAN and the move in
 * standard UCI, or null if illegal.
 *
 * Castling can be written two ways: king two squares ("e1g1", what Stockfish
 * uses) or king onto rook ("e1h1", what the board sends). We always return the
 * first form, so the same move always gets the same id in the move tree.
 */
export function playUci(fen: string, uci: string): { fen: string; san: string; uci: string } | null {
  const pos = positionFromFen(fen);
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) return null;
  const side = castlingSide(pos, move);
  const standard = side && "from" in move ? { ...move, to: kingCastlesTo(pos.turn, side) } : move;
  const san = makeSanAndPlay(pos, move);
  return { fen: fenOf(pos), san, uci: makeUci(standard) };
}

/** Converts a sequence of UCI moves into SAN, stopping at the first illegal one. */
export function uciLineToSan(fen: string, uciMoves: string[], max = Infinity): string[] {
  const pos = positionFromFen(fen);
  const out: string[] = [];
  for (const uci of uciMoves.slice(0, max)) {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) break;
    out.push(makeSanAndPlay(pos, move));
  }
  return out;
}

/** All legal moves of a position in SAN. */
export function legalSans(fen: string): string[] {
  const pos = positionFromFen(fen);
  const out: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from);
      const promotes = piece?.role === "pawn" && (to >> 3 === 7 || to >> 3 === 0);
      for (const promotion of promotes ? (["queen", "rook", "bishop", "knight"] as const) : [undefined]) {
        out.push(makeSan(pos, { from, to, promotion }));
      }
    }
  }
  return out;
}

/** Parses a SAN move in a position; returns its UCI or null. */
export function sanToUci(fen: string, san: string): string | null {
  const move = parseSan(positionFromFen(fen), san);
  return move ? makeUci(move) : null;
}

/**
 * "6.Re1 b5 7.Bb3" for White to move, "6...b5 7.Bb3 O-O" for Black to move.
 * `fen` is the position before the first move.
 */
export function formatMoves(fen: string, sans: string[]): string {
  let num = moveNumberOf(fen);
  let white = turnOf(fen) === "white";
  const parts: string[] = [];
  sans.forEach((san, i) => {
    if (white) parts.push(`${num}.${san}`);
    else parts.push(i === 0 ? `${num}...${san}` : san);
    if (!white) num++;
    white = !white;
  });
  return parts.join(" ");
}

/** "12.Nf3" or "12...Nf6" for the move played from `fenBefore`. */
export function moveLabel(fenBefore: string, san: string): string {
  return formatMoves(fenBefore, [san]);
}
