// The "context packet": everything Claude gets to explain a position, built by code.
// Stockfish calculates, Claude explains. So the packet carries the engine's lines,
// win chances and computed facts, and the prompt tells Claude to only mention
// moves that appear here.

import { formatMoves, legalSans, moveLabel, moveNumberOf, turnOf } from "./chess";
import { pointsBehindBest, type Verdict, verdictOf } from "./engine-lines";
import { factsToText, positionFacts } from "./facts";
import { openingOfLine } from "./openings";
import { phaseOfLine } from "./phase";
import type { Color, EngineLine, Phase } from "./types";
import { classifyMove, describeWin, winFor } from "./winprob";

export type RequestKind = "hello" | "moveExplanation" | "positionPlan" | "gameReview" | "bestMoves" | "openingOverview";

export const RATING_BAND = "800-1200 (Chess.com rapid)";

/** A move that was just played and should be explained. */
export interface MoveContext {
  san: string;
  uci: string;
  /** Who played it. */
  color: Color;
  fenBefore: string;
  /** Engine lines for the position before the move (what could have been played). */
  linesBefore: EngineLine[];
}

export interface PacketInput {
  /** Current position. For a move explanation, the position after the move. */
  fen: string;
  /** Engine lines for the current position. */
  lines: EngineLine[];
  /** The line from the start: FEN of every position (root first) and the SAN that led to it. */
  history: { fen: string; san: string | null }[];
  move?: MoveContext | null;
}

/** Moves Claude may mention, as sets of SAN strings. */
export interface AllowedMoves {
  legalNow: Set<string>;
  legalBefore: Set<string>;
  /** First move of each engine line. */
  engineFirstNow: Set<string>;
  engineFirstBefore: Set<string>;
  /** Everything above plus every move inside the engine lines and the game so far. */
  anywhere: Set<string>;
}

/** One of the engine's top moves, as offered to Claude for comparison. */
export interface Candidate {
  san: string;
  verdict: Verdict;
  /** Win-% points behind the best move, for the side to move. */
  behind: number;
  /** The engine's line starting with this move, in SAN. */
  line: string[];
}

export interface Packet {
  text: string;
  allowed: AllowedMoves;
  phase: Phase;
  /** The good moves (best, as good, playable; at most 4), for the "compare" request. */
  candidates: Candidate[];
}

/**
 * The moves worth comparing: the best one and every line that is as good or
 * still playable (at most 4). If only the best qualifies, the next line is added
 * so Claude can say why the best move is clearly better.
 */
export function candidatesOf(fen: string, lines: EngineLine[]): Candidate[] {
  const turn = turnOf(fen);
  const all = lines
    .filter((l) => l.pvSan.length > 0)
    .map((l, i) => ({ san: l.pvSan[0], verdict: verdictOf(lines, i, turn), behind: Math.round(pointsBehindBest(lines, l, turn) * 10) / 10, line: l.pvSan.slice(0, 8) }));
  const good = all.filter((c) => c.verdict !== "worse").slice(0, 4);
  return good.length < 2 && all.length >= 2 ? all.slice(0, 2) : good;
}

/** Removes check/mate marks and annotations so "Nf3+" and "Nf3!" compare equal to "Nf3". */
export function normalizeSan(san: string): string {
  return san
    .trim()
    .replace(/^\d+\.+\s*/, "")
    .replace(/[+#!?]+$/g, "")
    .replace(/^0-0-0$/, "O-O-O")
    .replace(/^0-0$/, "O-O");
}

/** "no real change", "a drop of 7 points", ... */
function dropText(before: number, after: number): string {
  const drop = Math.round(before - after);
  if (drop <= 1) return drop < -1 ? `an improvement of ${-drop} points` : "no real change";
  return `a drop of ${drop} points`;
}

function lineText(fen: string, line: EngineLine, index: number, maxMoves = 10): string {
  const moves = formatMoves(fen, line.pvSan.slice(0, maxMoves));
  return `${index + 1}. ${moves}  (White's win chance ${Math.round(line.winWhite)}%: ${describeWin(line.winWhite)}; depth ${line.depth})`;
}

export function buildPacket(input: PacketInput): Packet {
  const { fen, lines, history, move } = input;
  const turn = turnOf(fen);
  const fens = history.map((h) => h.fen);
  const phase = phaseOfLine(fens);
  const opening = openingOfLine(fens);

  // Last ~10 moves in SAN, with move numbers.
  const played = history.filter((h) => h.san !== null);
  const recent = played.slice(-10);
  const firstRecentIndex = history.indexOf(recent[0]);
  const recentText =
    recent.length === 0
      ? "none (this is the starting position of the line)"
      : formatMoves(history[firstRecentIndex - 1].fen, recent.map((h) => h.san as string));

  const legalNow = legalSans(fen).map(normalizeSan);
  const legalBefore = move ? legalSans(move.fenBefore).map(normalizeSan) : [];
  const allPv = [...lines, ...(move?.linesBefore ?? [])].flatMap((l) => l.pvSan.map(normalizeSan));
  const allowed: AllowedMoves = {
    legalNow: new Set(legalNow),
    legalBefore: new Set(legalBefore),
    engineFirstNow: new Set(lines.map((l) => l.pvSan[0]).filter(Boolean).map(normalizeSan)),
    engineFirstBefore: new Set((move?.linesBefore ?? []).map((l) => l.pvSan[0]).filter(Boolean).map(normalizeSan)),
    anywhere: new Set([...legalNow, ...legalBefore, ...allPv, ...played.map((h) => normalizeSan(h.san as string))]),
  };

  let openingText = "unknown (not in the opening list)";
  if (opening.opening) {
    openingText = `${opening.opening.eco} ${opening.opening.name}`;
    const i = opening.lastBookIndex;
    if (opening.inBook) openingText += " (still in book)";
    else if (i !== null && i > 0 && history[i].san) {
      openingText += ` (left the named book line after ${moveLabel(history[i - 1].fen, history[i].san as string)})`;
    }
  }

  const out: string[] = [];
  out.push("POSITION");
  out.push(`FEN: ${fen}`);
  out.push(`Side to move: ${turn === "white" ? "White" : "Black"}`);
  out.push(`Move number: ${moveNumberOf(fen)}`);
  out.push(`Game phase: ${phase}`);
  out.push(`Moves played so far (last 10): ${recentText}`);
  out.push(`Opening: ${openingText}`);
  out.push("Repertoire: not set up yet");
  out.push("Explorer stats: not available");

  if (move) {
    const before = move.linesBefore[0];
    const after = lines[0];
    out.push("");
    out.push("MOVE TO EXPLAIN");
    out.push(`Played: ${moveLabel(move.fenBefore, move.san)} by ${move.color === "white" ? "White" : "Black"}`);
    if (before && after) {
      const wb = winFor(move.color, before.winWhite);
      const wa = winFor(move.color, after.winWhite);
      const judgement = classifyMove(wb, wa);
      out.push(
        `${move.color === "white" ? "White" : "Black"}'s win chance: ${Math.round(wb)}% before the move, ${Math.round(wa)}% after it (${dropText(wb, wa)}).`,
      );
      out.push(`Judgement by win-chance drop (Lichess thresholds): ${judgement ?? "fine (no significant drop)"}`);
      const best = before.pvSan[0];
      if (best && normalizeSan(best) !== normalizeSan(move.san)) out.push(`The engine's best move instead was: ${best}`);
      else if (best) out.push("This was the engine's best move.");
    }
    out.push("");
    out.push("ENGINE LINES BEFORE THE MOVE (from the position before it was played)");
    move.linesBefore.forEach((l, i) => out.push(lineText(move.fenBefore, l, i)));
  }

  out.push("");
  out.push(move ? "ENGINE LINES NOW (after the move)" : "ENGINE LINES (Stockfish, best first)");
  if (lines.length === 0) out.push("(no engine lines: the game is over)");
  lines.forEach((l, i) => out.push(lineText(fen, l, i)));

  out.push("");
  out.push("POSITION FACTS (computed by code, trust these)");
  out.push(...factsToText(positionFacts(fen)));

  out.push("");
  out.push(`LEGAL MOVES NOW: ${legalNow.join(", ") || "none"}`);
  out.push("");
  out.push(`PLAYER: rated about ${RATING_BAND}`);

  const candidates = candidatesOf(fen, lines);
  return { text: out.join("\n"), allowed, phase, candidates };
}

const VERDICT_TEXT: Record<Verdict, string> = {
  best: "the engine's best move",
  asGood: "about as good as the best (the engine can't really tell them apart)",
  playable: "a reasonable alternative, a little worse",
  worse: "clearly worse",
};

/** The CANDIDATE MOVES section for the "compare" request. */
export function candidatesText(fen: string, candidates: Candidate[]): string {
  return candidates
    .map((c, i) => {
      const behind = c.verdict === "best" ? "" : ` ${c.behind} win-% points behind the best;`;
      return `${i + 1}. ${moveLabel(fen, c.san)}:${behind} ${VERDICT_TEXT[c.verdict]}. Engine line: ${formatMoves(fen, c.line)}`;
    })
    .join("\n");
}

/** The line telling Claude which language to write in (moves stay in English SAN). */
export function languageInstruction(language: "en" | "pt"): string {
  return language === "pt"
    ? "Write every text field in Brazilian Portuguese (português do Brasil). Keep chess moves in standard English SAN exactly as written in this packet (e.g. Nf3, O-O). Concept tags stay in English, from the list in your instructions."
    : "Write in English.";
}

/** The full user message for a request kind. */
export function buildPrompt(kind: RequestKind, packet: Packet, move?: MoveContext | null, language: "en" | "pt" = "en"): string {
  const side = turnOf(packet.text.match(/^FEN: (.+)$/m)?.[1] ?? "") === "white" ? "White" : "Black";
  const fen = packet.text.match(/^FEN: (.+)$/m)?.[1] ?? "";
  if (kind === "bestMoves") {
    return [
      `Compare the engine's top moves in this position for the side to move (${side}), for a player rated about ${RATING_BAND}.`,
      "summary: 1-2 sentences on how these moves compare: are they really equal, and what kind of game does each lead to?",
      "moves: one entry per CANDIDATE MOVE below, in the same order, with the SAN exactly as written (without the move number). idea: what the move wants to do, in plain words. plan: what to aim for in the next few moves after it, following its engine line. style: one of solid, active, sharp, positional, simplifying, attacking, defensive.",
      "recommendation: which candidate you'd suggest to this player here, and why (for example: easier to play, fits the typical plans of this opening).",
      "Only mention moves that appear in this packet. Use the game phase to choose what to focus on.",
      languageInstruction(language),
      "",
      "CANDIDATE MOVES (verdicts computed by code from the engine's evaluation; trust them)",
      candidatesText(fen, packet.candidates),
      "",
      packet.text,
    ].join("\n");
  }
  const header =
    kind === "moveExplanation" && move
      ? [
          `Explain the move ${moveLabel(move.fenBefore, move.san)} that ${move.color === "white" ? "White" : "Black"} just played, for a player rated about ${RATING_BAND}.`,
          "Say whether it was a good move and why, in plain words.",
          "If the engine clearly preferred another move (the judgement is inaccuracy, mistake or blunder), set better_move to the engine's best move from the position before the move and explain why it is better. Otherwise set better_move to null.",
          `plan_next: what ${move.color === "white" ? "White" : "Black"} should aim for in the next few moves.`,
        ]
      : [
          `Explain this position for the side to move, for a player rated about ${RATING_BAND}.`,
          "Who stands better and why, what matters most in this phase, a short plan for the next few moves, and what the opponent wants.",
          "candidate_moves: only the first moves of the ENGINE LINES, best first.",
        ];
  return [
    ...header,
    "Only mention moves that appear in this packet. Use the game phase to choose what to focus on.",
    languageInstruction(language),
    "",
    packet.text,
  ].join("\n");
}
