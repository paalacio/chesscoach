import { describe, expect, it } from "vitest";
import {
  classifyMove,
  formatScore,
  moveAccuracy,
  scoreToCp,
  toWhitePov,
  winFor,
  winningChances,
  winPercent,
} from "./winprob";

describe("win probability (Lichess formula)", () => {
  it("is 50% at 0.00 and symmetric", () => {
    expect(winPercent({ kind: "cp", value: 0 })).toBeCloseTo(50, 10);
    const up = winPercent({ kind: "cp", value: 150 });
    const down = winPercent({ kind: "cp", value: -150 });
    expect(up + down).toBeCloseTo(100, 10);
  });

  it("matches known values of 2/(1+exp(-0.00368208*cp))-1", () => {
    expect(winningChances(100)).toBeCloseTo(0.18205, 4);
    expect(winPercent({ kind: "cp", value: 100 })).toBeCloseTo(59.1, 1);
    expect(winPercent({ kind: "cp", value: 300 })).toBeCloseTo(75.1, 1);
  });

  it("caps centipawns at ±1000 and treats mates as ±1000", () => {
    expect(scoreToCp({ kind: "cp", value: 5000 })).toBe(1000);
    expect(scoreToCp({ kind: "mate", value: 3 })).toBe(1000);
    expect(scoreToCp({ kind: "mate", value: -2 })).toBe(-1000);
    expect(scoreToCp({ kind: "mate", value: 0 })).toBe(-1000);
    expect(winPercent({ kind: "mate", value: 1 })).toBeCloseTo(winPercent({ kind: "cp", value: 1000 }), 10);
  });

  it("converts side-to-move scores to White's point of view", () => {
    expect(toWhitePov({ kind: "cp", value: 40 }, "black")).toEqual({ kind: "cp", value: -40 });
    expect(toWhitePov({ kind: "mate", value: 2 }, "white")).toEqual({ kind: "mate", value: 2 });
    expect(winFor("black", 70)).toBe(30);
  });

  it("formats scores like an engine panel", () => {
    expect(formatScore({ kind: "cp", value: 35 })).toBe("+0.35");
    expect(formatScore({ kind: "cp", value: -120 })).toBe("−1.20");
    expect(formatScore({ kind: "cp", value: 0 })).toBe("0.00");
    expect(formatScore({ kind: "mate", value: 3 })).toBe("#3");
    expect(formatScore({ kind: "mate", value: -2 })).toBe("#−2");
  });
});

describe("move classification (Lichess thresholds)", () => {
  it("uses 0.1 / 0.2 / 0.3 drops in winning chances (5 / 10 / 15 win% points)", () => {
    expect(classifyMove(60, 56)).toBeNull();
    expect(classifyMove(60, 55)).toBe("inaccuracy");
    expect(classifyMove(60, 50.1)).toBe("inaccuracy");
    expect(classifyMove(60, 50)).toBe("mistake");
    expect(classifyMove(60, 45)).toBe("blunder");
    expect(classifyMove(40, 70)).toBeNull(); // improving is never a mistake
  });

  it("computes Lichess move accuracy", () => {
    expect(moveAccuracy(50, 60)).toBe(100);
    expect(moveAccuracy(50, 50)).toBe(100);
    // 103.1668 * exp(-0.04354 * 10) - 3.1669 + 1 ≈ 64.6
    expect(moveAccuracy(60, 50)).toBeCloseTo(64.6, 1);
    expect(moveAccuracy(100, 0)).toBe(0);
  });
});
