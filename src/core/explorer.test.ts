import { describe, expect, it } from "vitest";
import masters from "../backend/fixtures/explorer.json";
import { START_FEN } from "./chess";
import { buildOpeningPrompt, checkOpeningOverview, compactCount, type ExplorerData, explorerRows, scoreFor } from "./explorer";

const start = (masters as unknown as { masters: Record<string, ExplorerData> }).masters["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"];
const RUY = "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6";

describe("explorer rows", () => {
  it("turns Lichess numbers into shares and percentages", () => {
    const rows = explorerRows(START_FEN, start);
    expect(rows[0].san).toBe("e4");
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(100, 5);
    const r = rows[0];
    expect(r.whitePct + r.drawPct + r.blackPct).toBeCloseTo(100, 5);
    expect(r.opening?.name).toBe("King's Pawn Game");
    expect(scoreFor("white", r)).toBeGreaterThan(50); // White scores well with 1.e4 among masters
  });

  it("names openings from the bundled list when Lichess doesn't", () => {
    const rows = explorerRows(START_FEN, { white: 1, draws: 0, black: 0, opening: null, moves: [{ uci: "e2e4", san: "e4", averageRating: null, white: 1, draws: 0, black: 0, opening: null }] });
    expect(rows[0].opening?.eco).toBe("B00");
  });

  it("formats counts compactly", () => {
    expect(compactCount(1234567)).toBe("1.2M");
    expect(compactCount(950)).toBe("950");
  });
});

describe("explain this opening", () => {
  it("includes the explorer numbers and allows explorer moves", () => {
    const { prompt, allowed } = buildOpeningPrompt(
      { fen: START_FEN, lines: [], history: [{ fen: START_FEN, san: null }] },
      [{ title: "Masters games", data: start }],
      null,
      "pt",
    );
    expect(prompt).toContain("OPENING EXPLORER");
    expect(prompt).toMatch(/Masters games \(\d+ games\):\n {2}1\.e4: \d+% of games, score for White \d+%/);
    expect(prompt).toContain("Brazilian Portuguese");
    expect(allowed.anywhere.has("Nf3")).toBe(true);
  });

  it("checks the answer and flags invented moves", () => {
    const { allowed } = buildOpeningPrompt({ fen: RUY, lines: [], history: [{ fen: RUY, san: null }] }, [], { eco: "C84", name: "Ruy Lopez: Closed" }, "en");
    const r = checkOpeningOverview(
      {
        summary: "A classical opening.",
        pawn_structure: "The e4/e5 tension.",
        plans_white: ["Re1, c3 and d4.", "a", "b", "c"],
        plans_black: ["b5 and O-O."],
        traps: [{ name: "Noah's Ark", description: "After Qh5 the bishop gets trapped." }, { name: "", description: "" }],
        common_mistakes: ["Taking on e4 too early."],
        middlegame: "Manoeuvre.",
        concepts: ["center"],
      },
      allowed,
    );
    expect(r.data.plansWhite).toHaveLength(3);
    expect(r.data.traps).toHaveLength(1);
    expect(r.flagged).toEqual(["Qh5"]);
  });
});
