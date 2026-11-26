// Simple facts about a position, computed by code (so Claude doesn't have to guess):
// material, castling, pieces that are attacked and not defended, passed pawns, open files.

import type { Position } from "chessops/chess";
import { SquareSet } from "chessops/squareSet";
import type { Role } from "chessops/types";
import { makeSquare, opposite, squareFile, squareRank } from "chessops/util";
import { positionFromFen } from "./chess";
import type { Color } from "./types";

export const PIECE_VALUE: Record<Role, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
const ROLE_NAME: Record<Role, string> = {
  pawn: "pawn",
  knight: "knight",
  bishop: "bishop",
  rook: "rook",
  queen: "queen",
  king: "king",
};
const FILES = "abcdefgh";

export interface SideFacts {
  material: number;
  pieces: Record<Role, number>;
  castling: string;
  /** e.g. ["knight on c6"]: attacked by the opponent, defended by nobody. */
  undefended: string[];
  passedPawns: string[];
}

export interface PositionFacts {
  white: SideFacts;
  black: SideFacts;
  /** White material minus Black material, in pawns. */
  materialBalance: number;
  openFiles: string[];
  /** Files with only Black pawns (open for White's rooks) and vice versa. */
  halfOpenFor: { white: string[]; black: string[] };
  inCheck: boolean;
}

function countPieces(pos: Position, color: Color): Record<Role, number> {
  const roles: Role[] = ["pawn", "knight", "bishop", "rook", "queen", "king"];
  return Object.fromEntries(roles.map((r) => [r, pos.board.pieces(color, r).size()])) as Record<Role, number>;
}

function materialOf(pieces: Record<Role, number>): number {
  return (Object.keys(pieces) as Role[]).reduce((sum, r) => sum + pieces[r] * PIECE_VALUE[r], 0);
}

function castlingStatus(pos: Position, color: Color): string {
  const king = pos.board.kingOf(color);
  const homeRank = color === "white" ? 0 : 7;
  if (king !== undefined && squareRank(king) === homeRank) {
    const file = squareFile(king);
    const rook = (f: number) => pos.board.get(homeRank * 8 + f);
    const isOwnRook = (f: number) => rook(f)?.role === "rook" && rook(f)?.color === color;
    if (file === 6 && isOwnRook(5)) return "castled kingside";
    if (file === 2 && isOwnRook(3)) return "castled queenside";
  }
  const rights = pos.castles.castlingRights.intersect(SquareSet.fromRank(homeRank));
  const kingside = rights.has(homeRank * 8 + 7);
  const queenside = rights.has(homeRank * 8 + 0);
  if (kingside && queenside) return "not castled yet (can castle on both sides)";
  if (kingside) return "not castled yet (can still castle kingside)";
  if (queenside) return "not castled yet (can still castle queenside)";
  return "has not castled and can no longer castle";
}

function undefendedPieces(pos: Position, color: Color): string[] {
  const out: string[] = [];
  const enemy = opposite(color);
  for (const sq of pos.board[color]) {
    const piece = pos.board.get(sq);
    if (!piece || piece.role === "king") continue;
    // kingAttackers(square, attackerColor, occupied) returns all pieces of a color that attack a square.
    const attackers = pos.kingAttackers(sq, enemy, pos.board.occupied);
    if (attackers.isEmpty()) continue;
    const defenders = pos.kingAttackers(sq, color, pos.board.occupied);
    if (defenders.isEmpty()) out.push(`${ROLE_NAME[piece.role]} on ${makeSquare(sq)}`);
  }
  return out;
}

function passedPawns(pos: Position, color: Color): string[] {
  const out: string[] = [];
  const enemyPawns = pos.board.pieces(opposite(color), "pawn");
  for (const sq of pos.board.pieces(color, "pawn")) {
    const file = squareFile(sq);
    const rank = squareRank(sq);
    let blocked = false;
    for (const e of enemyPawns) {
      const ahead = color === "white" ? squareRank(e) > rank : squareRank(e) < rank;
      if (ahead && Math.abs(squareFile(e) - file) <= 1) {
        blocked = true;
        break;
      }
    }
    if (!blocked) out.push(makeSquare(sq));
  }
  return out;
}

export function positionFacts(fen: string): PositionFacts {
  const pos = positionFromFen(fen);
  const side = (color: Color): SideFacts => {
    const pieces = countPieces(pos, color);
    return {
      material: materialOf(pieces),
      pieces,
      castling: castlingStatus(pos, color),
      undefended: undefendedPieces(pos, color),
      passedPawns: passedPawns(pos, color),
    };
  };
  const white = side("white");
  const black = side("black");

  const openFiles: string[] = [];
  const halfOpenFor = { white: [] as string[], black: [] as string[] };
  for (let f = 0; f < 8; f++) {
    const fileSet = SquareSet.fromFile(f);
    const wp = pos.board.pieces("white", "pawn").intersects(fileSet);
    const bp = pos.board.pieces("black", "pawn").intersects(fileSet);
    if (!wp && !bp) openFiles.push(FILES[f]);
    else if (!wp) halfOpenFor.white.push(FILES[f]);
    else if (!bp) halfOpenFor.black.push(FILES[f]);
  }

  return {
    white,
    black,
    materialBalance: white.material - black.material,
    openFiles,
    halfOpenFor,
    inCheck: pos.isCheck(),
  };
}

/** The facts as text lines for the context packet. */
export function factsToText(f: PositionFacts): string[] {
  const bal = f.materialBalance;
  const balance = bal === 0 ? "material is equal" : `${bal > 0 ? "White" : "Black"} is up ${Math.abs(bal)} pawn${Math.abs(bal) === 1 ? "" : "s"} of material`;
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  const pieceSummary = (s: SideFacts) =>
    `Q${s.pieces.queen} R${s.pieces.rook} B${s.pieces.bishop} N${s.pieces.knight} P${s.pieces.pawn}`;
  return [
    `Material: White ${f.white.material} (${pieceSummary(f.white)}), Black ${f.black.material} (${pieceSummary(f.black)}): ${balance}.`,
    `Castling: White ${f.white.castling}; Black ${f.black.castling}.`,
    `Attacked and undefended: White: ${list(f.white.undefended)}. Black: ${list(f.black.undefended)}.`,
    `Passed pawns: White: ${list(f.white.passedPawns)}. Black: ${list(f.black.passedPawns)}.`,
    `Open files: ${list(f.openFiles)}. Half-open for White: ${list(f.halfOpenFor.white)}. Half-open for Black: ${list(f.halfOpenFor.black)}.`,
    ...(f.inCheck ? ["The side to move is in check."] : []),
  ];
}
