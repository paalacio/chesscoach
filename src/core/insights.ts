// Insights: results by opening and colour, accuracy per phase over time, the most
// common mistake themes (Claude's concept tags from game reviews), and "openings to
// fix next". Pure functions over the stored game summaries.

import type { ReviewSummary } from "./review";
import type { Color, Phase } from "./types";

/** What insights need from a game (a GameSummary from the backend has all of it). */
export interface InsightGame {
  id: number;
  /** Unix seconds. */
  endTime: number | null;
  myColor: Color;
  myResult: "win" | "loss" | "draw";
  /** Chess.com's opening name (used when the review has none). */
  opening: string | null;
  eco: string | null;
  reviewSummary: ReviewSummary | null;
}

const PHASES: Phase[] = ["opening", "middlegame", "endgame"];

/** "Sicilian Defense: Najdorf Variation" -> "Sicilian Defense"; Chess.com names keep their first words. */
export function openingFamily(name: string | null): string | null {
  if (!name) return null;
  const n = name.trim();
  if (n.includes(":")) return n.split(":")[0].trim();
  // Chess.com writes "Sicilian Defense Open Classical Variation" without a colon.
  const m = n.match(/^(.*?\b(?:Opening|Defense|Defence|Gambit|Game|Attack|System))\b/);
  return (m ? m[1] : n.split(" ").slice(0, 2).join(" ")).trim();
}

const nameOf = (g: InsightGame) => g.reviewSummary?.openingName ?? g.opening;

/**
 * A key that matches the same family however it's written: Chess.com says "Ruy Lopez
 * Opening" and "Kings Indian Defense", the opening list "Ruy Lopez" and "King's Indian Defense".
 */
export function familyKey(family: string): string {
  return family
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/defence/g, "defense")
    .replace(/\s+opening$/, "")
    .trim();
}
const points = (g: InsightGame) => (g.myResult === "win" ? 1 : g.myResult === "draw" ? 0.5 : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const accOf = (g: InsightGame, phase: Phase | "overall") =>
  phase === "overall" ? (g.reviewSummary?.accuracy ?? null) : (g.reviewSummary?.phases?.[phase] ?? null);

export interface Totals {
  games: number;
  /** % score (win = 1, draw = 0.5). */
  score: number | null;
  accuracy: Record<Phase | "overall", number | null>;
  /** Mistakes and blunders per reviewed game. */
  mistakesPerGame: number | null;
}

export function totals(games: InsightGame[]): Totals {
  const reviewed = games.filter((g) => g.reviewSummary);
  const accuracy = {} as Totals["accuracy"];
  for (const p of [...PHASES, "overall"] as const) {
    accuracy[p] = mean(games.map((g) => accOf(g, p)).filter((x): x is number => x != null));
  }
  return {
    games: games.length,
    score: games.length ? (100 * games.reduce((a, g) => a + points(g), 0)) / games.length : null,
    accuracy,
    mistakesPerGame: mean(reviewed.map((g) => (g.reviewSummary?.mistakes ?? 0) + (g.reviewSummary?.blunders ?? 0))),
  };
}

export interface OpeningRow {
  color: Color;
  family: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  /** Average overall accuracy, and in the opening phase (null without reviews). */
  accuracy: number | null;
  openingAccuracy: number | null;
}

/** Results per opening family and colour, most played first. */
export function resultsByOpening(games: InsightGame[]): OpeningRow[] {
  const groups = new Map<string, InsightGame[]>();
  // The name shown for a family: the opening list's spelling when a game has it.
  const labels = new Map<string, string>();
  for (const g of games) {
    const family = openingFamily(nameOf(g)) ?? "?";
    const key = `${g.myColor}|${familyKey(family)}`;
    groups.set(key, [...(groups.get(key) ?? []), g]);
    if (!labels.has(key) || g.reviewSummary?.openingName) labels.set(key, family);
  }
  return [...groups.entries()]
    .map(([key, gs]) => {
      const color = key.split("|")[0] as Color;
      const family = labels.get(key) ?? "?";
      const wins = gs.filter((g) => g.myResult === "win").length;
      const draws = gs.filter((g) => g.myResult === "draw").length;
      return {
        color,
        family,
        games: gs.length,
        wins,
        draws,
        losses: gs.length - wins - draws,
        score: (100 * (wins + draws / 2)) / gs.length,
        accuracy: mean(gs.map((g) => accOf(g, "overall")).filter((x): x is number => x != null)),
        openingAccuracy: mean(gs.map((g) => accOf(g, "opening")).filter((x): x is number => x != null)),
      };
    })
    .sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));
}

export interface TrendPoint {
  /** Unix seconds of the last game in the window. */
  time: number | null;
  /** Rolling average accuracy per phase (null if no game in the window has it). */
  opening: number | null;
  middlegame: number | null;
  endgame: number | null;
}

/**
 * Accuracy per phase over time: a rolling average over the last few reviewed games
 * (3 to 20, depending on how many there are), one point per game, oldest first.
 */
export function accuracyTrend(games: InsightGame[]): { window: number; points: TrendPoint[] } {
  const reviewed = games.filter((g) => g.reviewSummary?.phases).sort((a, b) => (a.endTime ?? 0) - (b.endTime ?? 0));
  const window = Math.max(3, Math.min(20, Math.round(reviewed.length / 8)));
  const points = reviewed.map((g, i) => {
    const slice = reviewed.slice(Math.max(0, i - window + 1), i + 1);
    const avg = (p: Phase) => mean(slice.map((x) => accOf(x, p)).filter((v): v is number => v != null));
    return { time: g.endTime, opening: avg("opening"), middlegame: avg("middlegame"), endgame: avg("endgame") };
  });
  return { window, points };
}

/** Claude's concept tags, most frequent first. */
export function topConcepts(counts: { tag: string; count: number }[], max = 8): { tag: string; count: number }[] {
  return [...counts].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, max);
}

/** A reason an opening is on the "to fix" list (translated by the UI). */
export type FixReason =
  | { kind: "lowScore"; score: number; games: number }
  | { kind: "lowOpeningAccuracy"; accuracy: number; average: number }
  | { kind: "mistakes"; perGame: number };

export interface FixItem {
  row: OpeningRow;
  reasons: FixReason[];
  /** How urgent it is (higher first). */
  weight: number;
}

/**
 * Openings to work on: played at least `minGames` times, and scoring under 50% or
 * with clearly lower accuracy in the opening than usual. Weighted by how often they
 * come up, so a frequent problem comes before a rare one.
 */
export function openingsToFix(games: InsightGame[], max = 4, minGames = 3): FixItem[] {
  const all = totals(games);
  const avgOpening = all.accuracy.opening;
  const out: FixItem[] = [];
  for (const row of resultsByOpening(games)) {
    if (row.games < minGames || row.family === "?") continue;
    const reasons: FixReason[] = [];
    let weight = 0;
    if (row.score < 50) {
      reasons.push({ kind: "lowScore", score: row.score, games: row.games });
      weight += ((50 - row.score) / 50) * row.games;
    }
    if (row.openingAccuracy != null && avgOpening != null && row.openingAccuracy < avgOpening - 3) {
      reasons.push({ kind: "lowOpeningAccuracy", accuracy: row.openingAccuracy, average: avgOpening });
      weight += ((avgOpening - row.openingAccuracy) / 20) * row.games;
    }
    const gs = games.filter((g) => g.myColor === row.color && familyKey(openingFamily(nameOf(g)) ?? "?") === familyKey(row.family) && g.reviewSummary);
    const perGame = mean(gs.map((g) => (g.reviewSummary?.mistakes ?? 0) + (g.reviewSummary?.blunders ?? 0)));
    if (perGame != null && all.mistakesPerGame != null && perGame > all.mistakesPerGame + 0.5) {
      reasons.push({ kind: "mistakes", perGame });
      weight += (perGame - all.mistakesPerGame) * 0.3 * row.games;
    }
    if (reasons.length) out.push({ row, reasons, weight });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, max);
}
