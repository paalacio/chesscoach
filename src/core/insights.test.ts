import { describe, expect, it } from "vitest";
import { accuracyTrend, type InsightGame, openingFamily, openingsToFix, resultsByOpening, topConcepts, totals } from "./insights";

let id = 0;
function game(color: "white" | "black", result: "win" | "loss" | "draw", opening: string, acc: [number, number, number] | null, mistakes = 0): InsightGame {
  id++;
  return {
    id,
    endTime: 1_000_000 + id * 3600,
    myColor: color,
    myResult: result,
    opening: null,
    eco: null,
    reviewSummary: acc
      ? {
          accuracy: (acc[0] + acc[1] + acc[2]) / 3,
          opponentAccuracy: 80,
          inaccuracies: 0,
          mistakes,
          blunders: 0,
          openingEco: null,
          openingName: opening,
          phases: { opening: acc[0], middlegame: acc[1], endgame: acc[2] },
          version: 2,
        }
      : null,
  };
}

const games: InsightGame[] = [
  game("black", "loss", "Sicilian Defense: Najdorf Variation", [70, 60, 65], 3),
  game("black", "loss", "Sicilian Defense: Dragon Variation", [72, 64, 60], 2),
  game("black", "draw", "Sicilian Defense: Najdorf Variation", [68, 70, 75], 2),
  game("black", "win", "King's Indian Defense: Normal Variation", [90, 80, 85], 0),
  game("white", "win", "Ruy Lopez: Closed", [92, 85, 80], 0),
  game("white", "win", "Ruy Lopez: Berlin Defense", [88, 82, 90], 1),
  game("white", "loss", "Queen's Gambit Declined", [85, 70, 72], 1),
];

describe("insights", () => {
  it("groups openings by family, also for Chess.com's names", () => {
    expect(openingFamily("Sicilian Defense: Najdorf Variation")).toBe("Sicilian Defense");
    expect(openingFamily("Sicilian Defense Open Classical Variation")).toBe("Sicilian Defense");
    expect(openingFamily("Ruy Lopez Opening Morphy Defense")).toBe("Ruy Lopez Opening");
    expect(openingFamily(null)).toBeNull();
  });

  it("puts Chess.com's and the opening list's spellings of a family together", () => {
    const chesscom = { ...game("white", "loss", "x", null), opening: "Ruy Lopez Opening Morphy Defense Closed Variation" };
    const rows = resultsByOpening([...games, chesscom]).filter((r) => r.color === "white");
    expect(rows.find((r) => r.family === "Ruy Lopez")?.games).toBe(3);
    expect(rows.some((r) => r.family === "Ruy Lopez Opening")).toBe(false);
  });

  it("adds up results by opening and colour", () => {
    const rows = resultsByOpening(games);
    const sicilian = rows.find((r) => r.family === "Sicilian Defense" && r.color === "black");
    expect(sicilian).toMatchObject({ games: 3, wins: 0, draws: 1, losses: 2 });
    expect(sicilian?.score).toBeCloseTo(16.7, 1);
    expect(sicilian?.openingAccuracy).toBeCloseTo(70, 5);
    expect(rows[0].family).toBe("Sicilian Defense"); // most played first
    expect(totals(games)).toMatchObject({ games: 7 });
    expect(totals(games).score).toBeCloseTo(50, 5);
  });

  it("puts the openings that go worst (and come up most) on the list to fix", () => {
    const fix = openingsToFix(games, 4, 3);
    expect(fix.map((f) => f.row.family)).toEqual(["Sicilian Defense"]);
    expect(fix[0].reasons.map((r) => r.kind)).toEqual(["lowScore", "lowOpeningAccuracy", "mistakes"]);
  });

  it("draws the accuracy trend as a rolling average, oldest first", () => {
    const { window, points } = accuracyTrend([...games].reverse());
    expect(window).toBe(3);
    expect(points).toHaveLength(7);
    expect(points[0].opening).toBe(70);
    expect(points[2].opening).toBeCloseTo((70 + 72 + 68) / 3, 5);
    expect(points[0].time).toBeLessThan(points[6].time as number);
    // Games without a per-phase summary are left out.
    expect(accuracyTrend([game("white", "win", "x", null)]).points).toEqual([]);
  });

  it("sorts Claude's themes", () => {
    expect(topConcepts([{ tag: "center", count: 1 }, { tag: "tactics", count: 4 }, { tag: "development", count: 4 }], 2)).toEqual([
      { tag: "development", count: 4 },
      { tag: "tactics", count: 4 },
    ]);
  });
});
