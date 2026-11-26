// The context packet for "Review this game with Claude": one call per game that
// returns a summary, 3 lessons and a comment on each key moment.
// As everywhere: Stockfish calculates (key moments, better moves), Claude explains.

import { formatMoves, legalSans, moveLabel } from "./chess";
import { languageInstruction, normalizeSan, RATING_BAND } from "./context-packet";
import { factsToText, positionFacts } from "./facts";
import { type GameReview, judgementGlyph } from "./review";
import type { Color, Phase } from "./types";
import { type MoveWarning, sanTokensIn } from "./validate";

export interface GameInfo {
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  result: string;
  myColor: Color;
  termination: string | null;
  timeControl: string | null;
  timeClass: string | null;
}

export interface GameReviewPacket {
  prompt: string;
  /** Key moment id -> index into review.moves. */
  momentIndex: Map<number, number>;
  /** Engine's better move (normalized SAN) per key moment id. */
  momentBest: Map<number, string>;
  /** Every move Claude may mention (normalized SAN). */
  allowed: Set<string>;
}

const side = (c: Color) => (c === "white" ? "White" : "Black");

/** "10+0" -> "10 min", "180+2" -> "3+2" */
function timeControlText(tc: string | null): string {
  if (!tc) return "unknown";
  const [base, inc] = tc.split("+").map(Number);
  if (!Number.isFinite(base)) return tc;
  const min = base >= 60 ? `${Math.round(base / 60)} min` : `${base} s`;
  return inc ? `${min} + ${inc} s per move` : min;
}

function phaseStart(index: number | null, review: GameReview): string {
  if (index === null) return "never";
  const m = review.moves[Math.min(index, review.moves.length - 1)];
  return m ? `move ${Math.ceil(m.ply / 2)}` : "never";
}

/** `language` is the app language; Claude writes its text in it. */
export function buildGameReviewPrompt(info: GameInfo, review: GameReview, language: "en" | "pt" = "en"): GameReviewPacket {
  const me = info.myColor;
  const opp: Color = me === "white" ? "black" : "white";
  const who = (c: Color) => (c === me ? "you" : "your opponent");
  const acc = (c: Color) => {
    const a = review.accuracy[c];
    const f = (p: Phase | "overall") => (a[p] === null ? "-" : String(Math.round(a[p] as number)));
    return `opening ${f("opening")}, middlegame ${f("middlegame")}, endgame ${f("endgame")}, overall ${f("overall")}`;
  };
  const cnt = (c: Color) => {
    const k = review.counts[c];
    return `inaccuracies ${k.inaccuracy}, mistakes ${k.mistake}, blunders ${k.blunder}`;
  };

  // Compact move list: "1.e4 (52) e5 (51) 2.Nf3 (53) ..." with ?!/?/?? marks.
  const moveParts: string[] = [];
  review.moves.forEach((m, i) => {
    const label = formatMoves(m.fenBefore, [m.san]);
    const text = m.color === "white" || i === 0 ? label : m.san;
    moveParts.push(`${text}${judgementGlyph(m.judgement)} (${Math.round(m.winAfter)})`);
  });

  const allowed = new Set<string>(review.moves.map((m) => normalizeSan(m.san)));
  const momentIndex = new Map<number, number>();
  const momentBest = new Map<number, string>();
  const momentText: string[] = [];
  review.keyMoments.forEach((idx, k) => {
    const id = k + 1;
    const m = review.moves[idx];
    momentIndex.set(id, idx);
    if (m.bestSan) momentBest.set(id, normalizeSan(m.bestSan));
    for (const san of m.bestLine) allowed.add(normalizeSan(san));
    for (const san of legalSans(m.fenBefore)) allowed.add(normalizeSan(san));
    const label = moveLabel(m.fenBefore, m.san);
    const lines = [
      `[${id}] ${label}${judgementGlyph(m.judgement)} by ${who(m.color)} (${m.phase}). ${side(m.color)}'s win chance ${Math.round(m.moverBefore)}% -> ${Math.round(m.moverAfter)}%.`,
    ];
    if (m.bestSan && m.bestLine.length) {
      lines.push(`    Engine's move instead: ${moveLabel(m.fenBefore, m.bestSan)} (line: ${formatMoves(m.fenBefore, m.bestLine)})`);
    }
    lines.push(`    Position before the move (FEN): ${m.fenBefore}`);
    lines.push(...factsToText(positionFacts(m.fenBefore)).map((l) => `    ${l}`));
    momentText.push(lines.join("\n"));
  });

  const elo = (n: number | null) => (n ? ` (${n})` : "");
  const left = review.leftBook ? review.moves[review.leftBook.index] : null;
  const openingLine = review.opening
    ? `${review.opening.eco} ${review.opening.name}${left ? `; left the named opening line with ${moveLabel(left.fenBefore, left.san)}, played by ${who(left.color)}` : ""}`
    : "not in the opening list";

  const languageLine = languageInstruction(language);

  const prompt = [
    `Write a short review of this game for the player, who had the ${side(me)} pieces and is rated about ${RATING_BAND}.`,
    "summary: 2-3 sentences: how the game went and what decided it.",
    "lessons: exactly 3 lessons from THIS game, most important first, each with the game phase it belongs to. Use simple principles for the phase: opening = development, center, king safety; middlegame = plans, pawn breaks, tactics, piece activity; endgame = king activity, passed pawns, technique.",
    "key_moments: one entry per KEY MOMENT below, with the same id, in the same order. better_move: the engine's move given for that moment (SAN exactly as written) when the move played was a mistake; otherwise null.",
    'Only mention moves that appear in this packet. Call the player "you" and the other side "your opponent".',
    languageLine,
    "",
    "GAME",
    `White: ${info.white}${elo(info.whiteElo)}. Black: ${info.black}${elo(info.blackElo)}. The player is ${side(me)}.`,
    `Result: ${info.result}${info.termination ? ` (${info.termination})` : ""}. Time control: ${timeControlText(info.timeControl)}${info.timeClass ? ` (${info.timeClass})` : ""}.`,
    `Opening: ${openingLine}.`,
    `Game phases: middlegame from ${phaseStart(review.division.middlegame, review)}, endgame from ${phaseStart(review.division.endgame, review)}.`,
    `Accuracy (0-100, Lichess method): you: ${acc(me)}. Your opponent: ${acc(opp)}.`,
    `Mistakes: you: ${cnt(me)}. Your opponent: ${cnt(opp)}.`,
    "",
    "MOVES (White's win chance in % after each move; ?! inaccuracy, ? mistake, ?? blunder)",
    moveParts.join(" "),
    "",
    "KEY MOMENTS",
    ...(momentText.length ? momentText : ["(none: no big swings in this game)"]),
  ].join("\n");

  return { prompt, momentIndex, momentBest, allowed };
}

export interface GameReviewAnswer {
  summary: string;
  lessons: { title: string; explanation: string; phase: Phase; concept: string }[];
  keyMoments: { id: number; index: number; comment: string; betterMove: string | null }[];
  concepts: string[];
}

export interface CheckedGameReview {
  data: GameReviewAnswer;
  warnings: MoveWarning[];
  flagged: string[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const PHASES: Phase[] = ["opening", "middlegame", "endgame"];

/** Checks Claude's game review: unknown key moments and invented better moves are dropped, unknown moves in text flagged. */
export function checkGameReview(raw: unknown, packet: GameReviewPacket): CheckedGameReview {
  const r = (raw ?? {}) as Record<string, unknown>;
  const warnings: MoveWarning[] = [];
  const lessons = (Array.isArray(r.lessons) ? r.lessons : []).slice(0, 3).map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    const phase = PHASES.includes(o.phase as Phase) ? (o.phase as Phase) : "middlegame";
    return { title: str(o.title), explanation: str(o.explanation), phase, concept: str(o.concept) };
  });
  const keyMoments: GameReviewAnswer["keyMoments"] = [];
  for (const k of Array.isArray(r.key_moments) ? r.key_moments : []) {
    const o = (k ?? {}) as Record<string, unknown>;
    const id = Number(o.id);
    const index = packet.momentIndex.get(id);
    if (index === undefined) continue; // a moment we didn't ask about
    let betterMove = str(o.better_move) || null;
    if (betterMove && normalizeSan(betterMove) !== packet.momentBest.get(id)) {
      warnings.push({ code: "momentMoveDropped", san: betterMove });
      betterMove = null;
    }
    keyMoments.push({ id, index, comment: str(o.comment), betterMove });
  }
  const data: GameReviewAnswer = {
    summary: str(r.summary),
    lessons,
    keyMoments,
    concepts: (Array.isArray(r.concepts) ? r.concepts : []).map(str).filter(Boolean).slice(0, 8),
  };
  const texts = [data.summary, ...lessons.flatMap((l) => [l.title, l.explanation]), ...keyMoments.map((k) => k.comment)];
  const flagged = new Set<string>();
  for (const t of texts) {
    for (const san of sanTokensIn(t)) if (!packet.allowed.has(san) && !san.startsWith("O-O")) flagged.add(san);
  }
  return { data, warnings, flagged: [...flagged] };
}
