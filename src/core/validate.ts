// Checking Claude's answers. Claude must never invent moves, so every move it
// names is checked against the legal moves and the engine lines:
// - structured move fields (better_move, candidate_moves) are dropped if invalid;
// - moves mentioned inside sentences are flagged so the UI can mark them.

import { type AllowedMoves, normalizeSan } from "./context-packet";

export interface MoveExplanation {
  summary: string;
  ideas: string[];
  better_move: { san: string; why: string } | null;
  plan_next: string;
  concepts: string[];
}

export interface PositionPlan {
  summary: string;
  phase_focus: string;
  plan: string[];
  opponent_ideas: string[];
  candidate_moves: { san: string; idea: string }[];
  concepts: string[];
}

/** A move Claude named that was removed (the UI turns the code into a sentence). */
export interface MoveWarning {
  code: "betterMoveDropped" | "candidateDropped" | "momentMoveDropped";
  san: string;
}

export interface Checked<T> {
  data: T;
  /** Moves that were dropped because they aren't legal or not the engine's. */
  warnings: MoveWarning[];
  /** Moves mentioned in the text that aren't legal or in the engine lines (normalized SAN). */
  flagged: string[];
}

/**
 * Finds things that look like chess moves in text: piece moves (Nf3, Bxe5),
 * pawn captures (exd5), promotions (e8=Q) and castling (O-O).
 * Bare squares like "e4" are skipped: in prose they usually mean the square.
 */
const SAN_IN_TEXT =
  /(?<![A-Za-z0-9])(O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][18]=[QRBN])[+#]?(?![A-Za-z0-9])/g;

/** "the Nf6", "your Bb5", "Black's Nc6": a piece being named, not a move. */
const PIECE_REFERENCE = /(?:\bthe|\byour|\btheir|\bhis|\bher|\bits|\bmy|\bwhite's|\bblack's|\bwhite|\bblack)\s+$/i;

export function sanTokensIn(text: string): string[] {
  return [...text.matchAll(SAN_IN_TEXT)]
    .filter((m) => !PIECE_REFERENCE.test(text.slice(Math.max(0, (m.index ?? 0) - 12), m.index)))
    .map((m) => normalizeSan(m[1]));
}

/**
 * Moves in the text that are neither legal nor in the engine lines.
 * Castling is not flagged in sentences: "castle with O-O" is a plan, not a
 * calculated move, and is usually meant for a few moves later.
 */
function unknownMoves(texts: string[], allowed: Set<string>): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const san of sanTokensIn(t)) {
      if (!allowed.has(san) && !san.startsWith("O-O")) out.add(san);
    }
  }
  return [...out];
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : [];

export function checkMoveExplanation(raw: unknown, allowed: AllowedMoves): Checked<MoveExplanation> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const warnings: MoveWarning[] = [];
  let better: MoveExplanation["better_move"] = null;
  const bm = r.better_move as Record<string, unknown> | null | undefined;
  if (bm && str(bm.san)) {
    const san = normalizeSan(str(bm.san));
    if (allowed.legalBefore.has(san) && allowed.engineFirstBefore.has(san)) {
      better = { san: str(bm.san), why: str(bm.why) };
    } else {
      warnings.push({ code: "betterMoveDropped", san: str(bm.san) });
    }
  }
  const data: MoveExplanation = {
    summary: str(r.summary),
    ideas: strList(r.ideas, 3),
    better_move: better,
    plan_next: str(r.plan_next),
    concepts: strList(r.concepts, 8),
  };
  const flagged = unknownMoves(
    [data.summary, ...data.ideas, data.plan_next, better?.why ?? ""],
    allowed.anywhere,
  );
  return { data, warnings, flagged };
}

export function checkPositionPlan(raw: unknown, allowed: AllowedMoves): Checked<PositionPlan> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const warnings: MoveWarning[] = [];
  const candidates: PositionPlan["candidate_moves"] = [];
  const list = Array.isArray(r.candidate_moves) ? r.candidate_moves : [];
  for (const c of list.slice(0, 3)) {
    const cand = (c ?? {}) as Record<string, unknown>;
    const san = normalizeSan(str(cand.san));
    if (san && allowed.legalNow.has(san) && allowed.engineFirstNow.has(san)) {
      candidates.push({ san: str(cand.san), idea: str(cand.idea) });
    } else if (san) {
      warnings.push({ code: "candidateDropped", san: str(cand.san) });
    }
  }
  const data: PositionPlan = {
    summary: str(r.summary),
    phase_focus: str(r.phase_focus),
    plan: strList(r.plan, 3),
    opponent_ideas: strList(r.opponent_ideas, 2),
    candidate_moves: candidates,
    concepts: strList(r.concepts, 8),
  };
  const flagged = unknownMoves(
    [data.summary, data.phase_focus, ...data.plan, ...data.opponent_ideas, ...candidates.map((c) => c.idea)],
    allowed.anywhere,
  );
  return { data, warnings, flagged };
}
