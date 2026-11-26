// The repertoire wizard's Claude request: 2-3 candidate openings per "slot"
// (e.g. "Black against 1.e4"), chosen for the player's answers and games.
//
// Claude writes the main line of each option from its own opening knowledge;
// every move is then checked here (illegal or off-slot lines are dropped), and
// the app later asks the explorer and Stockfish about them.

import { formatMoves, playUci, START_FEN, turnOf } from "./chess";
import { languageInstruction, RATING_BAND } from "./context-packet";
import { sanLineToUcis } from "./repertoire";
import type { Color } from "./types";

export type FirstMove = "e4" | "d4";

export interface Slot {
  id: string;
  color: Color;
  /** Moves (SAN, from the start) every line of this slot begins with. */
  root: string[];
  /** For "other" slots: first moves that belong to other slots. */
  notFirst?: string[];
  /** What the slot is, for Claude (English). */
  describe: string;
}

export const BLACK_SLOTS: Slot[] = [
  { id: "black_e4", color: "black", root: ["e4"], describe: "Black against 1.e4" },
  { id: "black_d4", color: "black", root: ["d4"], describe: "Black against 1.d4" },
  {
    id: "black_other",
    color: "black",
    root: [],
    notFirst: ["e4", "d4"],
    describe: "Black against 1.c4, 1.Nf3 and other first moves (ideally one setup that works against most of them; the line starts with White's most common of these, 1.c4 or 1.Nf3)",
  },
];

export const WHITE_SLOTS: Record<FirstMove, Slot[]> = {
  e4: [
    { id: "white_e4_e5", color: "white", root: ["e4", "e5"], describe: "White after 1.e4 e5" },
    { id: "white_e4_c5", color: "white", root: ["e4", "c5"], describe: "White against the Sicilian (1.e4 c5)" },
    { id: "white_e4_e6", color: "white", root: ["e4", "e6"], describe: "White against the French (1.e4 e6)" },
    { id: "white_e4_c6", color: "white", root: ["e4", "c6"], describe: "White against the Caro-Kann (1.e4 c6)" },
  ],
  d4: [
    { id: "white_d4_d5", color: "white", root: ["d4", "d5"], describe: "White after 1.d4 d5" },
    { id: "white_d4_nf6", color: "white", root: ["d4", "Nf6"], describe: "White after 1.d4 Nf6 (against the Indian defences)" },
  ],
};

export function slotsFor(color: Color, firstMoves: FirstMove[]): Slot[] {
  return color === "black" ? BLACK_SLOTS : firstMoves.flatMap((m) => WHITE_SLOTS[m]);
}

export function slotById(id: string): Slot | null {
  return [...BLACK_SLOTS, ...WHITE_SLOTS.e4, ...WHITE_SLOTS.d4].find((s) => s.id === id) ?? null;
}

// ---------- what the player told us ----------

export type Style = "solid" | "balanced" | "sharp";
export type TheoryAppetite = "little" | "some" | "lots";
export type Attacking = "attack" | "either" | "maneuver";

export interface StyleAnswers {
  style: Style;
  theory: TheoryAppetite;
  attacking: Attacking;
  /** Free text: openings the player already plays or wants to keep. */
  openings: string;
}

/** A summary of the player's games for one situation, e.g. "as Black against 1.e4". */
export interface GamesFact {
  label: string;
  games: number;
  /** % score for the player (win = 1, draw = 0.5). */
  score: number;
  /** The player's (or the opponent's) most common moves there, "1...c5 (12)". */
  top: string[];
}

// ---------- the prompt ----------

export function buildProposalPrompt(
  color: Color,
  slots: Slot[],
  answers: StyleAnswers,
  facts: GamesFact[],
  language: "en" | "pt",
): string {
  const styleText = { solid: "solid, safe positions", balanced: "a mix of solid and sharp", sharp: "sharp, tactical positions" }[answers.style];
  const theoryText = {
    little: "as little theory as possible (systems and simple plans)",
    some: "a moderate amount of theory",
    lots: "happy to learn a lot of theory",
  }[answers.theory];
  const attackText = {
    attack: "likes attacking the king",
    either: "no strong preference between attack and defence",
    maneuver: "prefers slow manoeuvring and endgames",
  }[answers.attacking];
  const side = color === "white" ? "White" : "Black";
  const lines = [
    `Suggest an opening repertoire as ${side} for a club player rated about ${RATING_BAND}.`,
    "This request is different from the usual ones: there is no engine packet. Write well-known main lines from opening theory in each option's moves field, from the starting position, in SAN with move numbers, 4-8 moves long, starting with the slot's moves and ending with the player's own move. The app checks every move and asks Stockfish about the lines later.",
    "For each SLOT give 2 or 3 genuinely different options that are sound and popular at club level, and compare them honestly: pros, cons, how much theory they need, typical plans for the player, and one sentence on why each fits (or doesn't) this player.",
    "If the player names openings they play or want to keep, and one of them is this side's choice in a slot, all options in that slot must be lines of that opening (different variations or move orders), with the most suitable first. An opening belongs to the side that chooses it: the Ruy Lopez and the Queen's Gambit are White's choices, the Sicilian and the King's Indian are Black's.",
    "In the text fields, describe ideas in words; only mention moves that are in the option's line.",
    languageInstruction(language),
    "",
    "PLAYER",
    `- Prefers ${styleText}; ${theoryText}; ${attackText}.`,
    `- Openings they play or want to keep: ${answers.openings.trim() || "(none given)"}`,
    "",
    "THEIR GAMES",
    ...(facts.length
      ? facts.map((f) => `- ${f.label}: ${f.games} games, scored ${Math.round(f.score)}%${f.top.length ? `; most common: ${f.top.join(", ")}` : ""}`)
      : ["- (no games imported yet)"]),
    "",
    "SLOTS",
    ...slots.map((s) => `- ${s.id}: ${s.describe}.${s.root.length ? ` Lines start with: ${formatMoves(START_FEN, s.root)}` : ""}`),
  ];
  return lines.join("\n");
}

// ---------- checking the answer ----------

export interface ProposalOption {
  name: string;
  /** The line as SAN with move numbers (rewritten from the checked moves). */
  moves: string;
  /** The same line in UCI, checked to be legal. */
  ucis: string[];
  style: Style;
  theory: "low" | "medium" | "high";
  pros: string[];
  cons: string[];
  plans: string[];
  whyForYou: string;
}

export interface Proposal {
  summary: string;
  slots: { slot: Slot; options: ProposalOption[] }[];
  /** Options dropped because their moves weren't legal or didn't fit the slot. */
  dropped: number;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);

/**
 * Checks an option's line: legal from the start, starts with the slot's moves (or,
 * for "other" slots, doesn't start with another slot's first move), and ends with
 * the player's move (a trailing opponent move is dropped). Null if it doesn't fit.
 */
export function checkLine(slot: Slot, line: string): { ucis: string[]; sans: string[] } | null {
  const ucis = sanLineToUcis(line);
  if (!ucis || ucis.length === 0) return null;
  const sans: string[] = [];
  let fen = START_FEN;
  for (const u of ucis) {
    const p = playUci(fen, u);
    if (!p) return null;
    sans.push(p.san.replace(/[+#]$/, ""));
    fen = p.fen;
  }
  if (slot.root.some((san, i) => sans[i] !== san)) return null;
  if (slot.notFirst?.includes(sans[0])) return null;
  // End with the player's own move: after it, it's the opponent's turn.
  if (turnOf(fen) === slot.color) {
    ucis.pop();
    sans.pop();
  }
  // The line now ends with the player's move, so being longer than the slot's own
  // moves means it contains at least one move of the player's.
  if (ucis.length <= slot.root.length) return null;
  return { ucis, sans };
}

export function checkProposal(raw: unknown, slots: Slot[]): Proposal {
  const o = (raw ?? {}) as Record<string, unknown>;
  let dropped = 0;
  const answered = Array.isArray(o.slots) ? (o.slots as Record<string, unknown>[]) : [];
  const out: Proposal["slots"] = [];
  for (const slot of slots) {
    const entry = answered.find((a) => str(a.slot) === slot.id);
    const options: ProposalOption[] = [];
    for (const opt of Array.isArray(entry?.options) ? (entry.options as Record<string, unknown>[]) : []) {
      const checked = checkLine(slot, str(opt.moves));
      if (!checked) {
        dropped++;
        continue;
      }
      // Two options with the same line are one option.
      if (options.some((x) => x.ucis.join(" ") === checked.ucis.join(" "))) continue;
      const style = str(opt.style);
      const theory = str(opt.theory);
      options.push({
        name: str(opt.name) || formatMoves(START_FEN, checked.sans),
        moves: formatMoves(START_FEN, checked.sans),
        ucis: checked.ucis,
        style: style === "solid" || style === "sharp" ? style : "balanced",
        theory: theory === "low" || theory === "high" ? theory : "medium",
        pros: list(opt.pros, 3),
        cons: list(opt.cons, 3),
        plans: list(opt.plans, 3),
        whyForYou: str(opt.why_for_you),
      });
    }
    out.push({ slot, options: options.slice(0, 3) });
  }
  return { summary: str(o.summary), slots: out, dropped };
}

/** Name for a repertoire built from chosen options, e.g. "White · 1.e4". */
export function repertoireName(color: Color, firstMove: FirstMove | null, t: (key: string) => string): string {
  const side = t(color === "white" ? "color.white" : "color.black");
  return firstMove ? `${side} · 1.${firstMove}` : side;
}
