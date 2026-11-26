import { describe, expect, it } from "vitest";
import { START_FEN } from "./chess";
import { factsToText, positionFacts } from "./facts";
import { lookupOpening, openingOfLine } from "./openings";
import { divideGame, mixedness, phaseOfLine, positionPhase } from "./phase";
import { positionFromFen } from "./chess";

const RUY = "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6";
const MIDDLE = "r4rk1/pp2qppp/2n1bn2/3p4/3P4/2NBBN2/PP2QPPP/R4RK1 w - - 0 12";

describe("position facts", () => {
  it("describes the starting position", () => {
    const f = positionFacts(START_FEN);
    expect(f.white.material).toBe(39);
    expect(f.materialBalance).toBe(0);
    expect(f.white.castling).toContain("both sides");
    expect(f.openFiles).toEqual([]);
    expect(f.white.undefended).toEqual([]);
  });

  it("sees castling, material and an undefended piece", () => {
    const f = positionFacts(RUY);
    expect(f.white.castling).toBe("castled kingside");
    expect(f.black.castling).toContain("both sides");
    // After 5...Be7 the e4 pawn is attacked by the f6 knight and defended by nothing
    // (that's why 5...Nxe4, the Open Ruy Lopez, is possible).
    expect(f.white.undefended).toEqual(["pawn on e4"]);
    // Black knight on e4 attacked by the rook, defended by nobody:
    const g = positionFacts("r1bqkb1r/pppp1ppp/2n5/1B2p3/4n3/5N2/PPPP1PPP/RNBQR1K1 b kq - 1 5");
    expect(g.black.undefended).toContain("knight on e4");
  });

  it("finds passed pawns and open files", () => {
    // White pawns a4, d5; Black pawns e6, h6 -> a-pawn passed; files b, c, f, g open.
    const f = positionFacts("4k3/8/4p2p/3P4/P7/8/8/4K3 w - - 0 1");
    expect(f.white.passedPawns).toEqual(["a4"]);
    expect(f.black.passedPawns).toEqual(["h6"]);
    expect(f.openFiles).toEqual(["b", "c", "f", "g"]);
    expect(f.halfOpenFor.white).toEqual(["e", "h"]);
    expect(factsToText(f).join("\n")).toContain("Passed pawns: White: a4. Black: h6.");
  });
});

describe("phase detection (Lichess divider)", () => {
  it("calls the start position an opening and a bare-kings ending an endgame", () => {
    expect(positionPhase(START_FEN)).toBe("opening");
    expect(positionPhase("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1")).toBe("endgame");
    expect(mixedness(positionFromFen(START_FEN).board)).toBeLessThan(150);
  });

  it("finds the middlegame once pieces leave the back rank", () => {
    // Ruy Lopez after 5.O-O Be7: White's back rank still has R, N, B, Q, R, K (6 pieces).
    expect(positionPhase(RUY)).toBe("opening");
    // Fully developed: White's back rank has only R, R, K (fewer than 4) -> middlegame.
    expect(positionPhase(MIDDLE)).toBe("middlegame");
  });

  it("divides a game into phases", () => {
    const fens = [
      START_FEN,
      MIDDLE,
      "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 40",
    ];
    expect(divideGame(fens)).toEqual({ middlegame: 1, endgame: 2 });
    expect(phaseOfLine(fens.slice(0, 1))).toBe("opening");
    expect(phaseOfLine(fens.slice(0, 2))).toBe("middlegame");
    expect(phaseOfLine(fens)).toBe("endgame");
  });
});

describe("opening names", () => {
  it("names positions from the bundled list, whatever the move counters", () => {
    expect(lookupOpening(RUY)?.name).toContain("Ruy Lopez");
    expect(lookupOpening(RUY.replace(/ 4 6$/, " 0 1"))?.name).toContain("Ruy Lopez");
    expect(lookupOpening(START_FEN)).toBeNull();
  });

  it("reports where a line left the named positions", () => {
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const weird = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPPKPPP/RNBQ1BNR b kq - 1 1";
    const info = openingOfLine([START_FEN, afterE4]);
    expect(info.opening?.eco).toBe("B00");
    expect(info.inBook).toBe(true);
    const out = openingOfLine([START_FEN, afterE4, weird]);
    expect(out.inBook).toBe(false);
    expect(out.lastBookIndex).toBe(1);
  });
});
