// Opening explorer helpers and the "Explain this opening" packet for Claude.

import { formatMoves, moveLabel, turnOf } from "./chess";
import { type AllowedMoves, buildPacket, languageInstruction, type MoveContext, normalizeSan, RATING_BAND } from "./context-packet";
import { type Opening, lookupOpening } from "./openings";
import type { Color, EngineLine } from "./types";
import { type Checked, type MoveWarning, sanTokensIn } from "./validate";
import { playUci } from "./chess";

/** Same shapes as the backend's explorer answer. */
export interface ExplorerMoveData {
  uci: string;
  san: string;
  averageRating: number | null;
  white: number;
  draws: number;
  black: number;
  opening: { eco: string; name: string } | null;
}
export interface ExplorerData {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMoveData[];
  opening: { eco: string; name: string } | null;
}

export interface ExplorerRow {
  uci: string;
  san: string;
  games: number;
  /** Share of all games in this position, 0-100. */
  share: number;
  whitePct: number;
  drawPct: number;
  blackPct: number;
  averageRating: number | null;
  /** Opening name after this move: from Lichess, else from the bundled list. */
  opening: Opening | null;
}

const pct = (n: number, total: number) => (total > 0 ? (100 * n) / total : 0);

export function explorerRows(fen: string, data: ExplorerData): ExplorerRow[] {
  const total = data.moves.reduce((a, m) => a + m.white + m.draws + m.black, 0);
  return data.moves.map((m) => {
    const games = m.white + m.draws + m.black;
    const after = playUci(fen, m.uci);
    return {
      uci: m.uci,
      san: m.san,
      games,
      share: pct(games, total),
      whitePct: pct(m.white, games),
      drawPct: pct(m.draws, games),
      blackPct: pct(m.black, games),
      averageRating: m.averageRating,
      opening: m.opening ?? (after ? lookupOpening(after.fen) : null),
    };
  });
}

/** Score for a side in percent (wins + half the draws). */
export function scoreFor(color: Color, row: Pick<ExplorerRow, "whitePct" | "drawPct" | "blackPct">): number {
  return (color === "white" ? row.whitePct : row.blackPct) + row.drawPct / 2;
}

/** "12.3k", "4.5M" */
export function compactCount(n: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

// ---------- "Explain this opening" ----------

export interface ExplorerSection {
  title: string;
  data: ExplorerData;
}

function sectionText(fen: string, s: ExplorerSection): string {
  const rows = explorerRows(fen, s.data).slice(0, 6);
  if (rows.length === 0) return `${s.title}: no games.`;
  const turn = turnOf(fen);
  const lines = rows.map(
    (r) =>
      `  ${moveLabel(fen, r.san)}: ${Math.round(r.share)}% of games, score for ${turn === "white" ? "White" : "Black"} ${Math.round(scoreFor(turn, r))}% (White wins ${Math.round(r.whitePct)}%, draws ${Math.round(r.drawPct)}%, Black wins ${Math.round(r.blackPct)}%)`,
  );
  return [`${s.title} (${s.data.white + s.data.draws + s.data.black} games):`, ...lines].join("\n");
}

export interface OpeningPrompt {
  prompt: string;
  allowed: AllowedMoves;
}

export function buildOpeningPrompt(
  input: { fen: string; lines: EngineLine[]; history: { fen: string; san: string | null }[]; move?: MoveContext | null },
  explorer: ExplorerSection[],
  opening: Opening | null,
  language: "en" | "pt",
): OpeningPrompt {
  const packet = buildPacket(input);
  // Explorer moves may be mentioned too.
  for (const s of explorer) for (const m of s.data.moves) packet.allowed.anywhere.add(normalizeSan(m.san));
  const played = input.history.filter((h) => h.san).map((h) => h.san as string);
  const movesText = played.length ? formatMoves(input.history[0].fen, played) : "(starting position)";
  const name = opening ? `${opening.eco} ${opening.name}` : "this opening position";
  const prompt = [
    `Explain the opening ${name} to a player rated about ${RATING_BAND}. Moves so far: ${movesText}.`,
    "summary: what this opening is about and why players choose it. pawn_structure: the typical pawn structure and what each side aims for because of it.",
    "plans_white / plans_black: up to 3 short typical plans each. middlegame: how to play the middlegame that usually comes out of it.",
    "traps: up to 3 common traps or tactical tricks at club level in this line; common_mistakes: up to 3 mistakes players at this level often make here.",
    "Use the explorer numbers to say what is popular and what scores well at the player's level. Describe plans and traps in words; only write concrete moves that appear in this packet.",
    languageInstruction(language),
    "",
    "OPENING EXPLORER",
    ...(explorer.length ? explorer.map((s) => sectionText(input.fen, s)) : ["(no explorer data available)"]),
    "",
    packet.text,
  ].join("\n");
  return { prompt, allowed: packet.allowed };
}

export interface OpeningOverview {
  summary: string;
  pawnStructure: string;
  plansWhite: string[];
  plansBlack: string[];
  traps: { name: string; description: string }[];
  commonMistakes: string[];
  middlegame: string;
  concepts: string[];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);

export function checkOpeningOverview(raw: unknown, allowed: AllowedMoves): Checked<OpeningOverview> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const traps = (Array.isArray(r.traps) ? r.traps : []).slice(0, 3).map((t) => {
    const o = (t ?? {}) as Record<string, unknown>;
    return { name: str(o.name), description: str(o.description) };
  });
  const data: OpeningOverview = {
    summary: str(r.summary),
    pawnStructure: str(r.pawn_structure),
    plansWhite: list(r.plans_white, 3),
    plansBlack: list(r.plans_black, 3),
    traps: traps.filter((t) => t.name || t.description),
    commonMistakes: list(r.common_mistakes, 3),
    middlegame: str(r.middlegame),
    concepts: list(r.concepts, 8),
  };
  const texts = [
    data.summary,
    data.pawnStructure,
    ...data.plansWhite,
    ...data.plansBlack,
    ...data.traps.flatMap((t) => [t.name, t.description]),
    ...data.commonMistakes,
    data.middlegame,
  ];
  const flagged = new Set<string>();
  for (const t of texts) for (const san of sanTokensIn(t)) if (!allowed.anywhere.has(san) && !san.startsWith("O-O")) flagged.add(san);
  const warnings: MoveWarning[] = [];
  return { data, warnings, flagged: [...flagged] };
}
