import { describe, expect, it } from "vitest";
import { playUci, START_FEN } from "./chess";
import { buildPacket, buildPrompt, normalizeSan } from "./context-packet";
import { infoToLine, mergeInfo } from "./engine-lines";
import type { InfoLine } from "./types";
import { checkMoveExplanation, checkPositionPlan, sanTokensIn } from "./validate";

const RUY_BEFORE = "r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 3 5";
const RUY_AFTER = "r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6";

const info = (multipv: number, cp: number, pv: string[], depth = 20): InfoLine => ({
  depth,
  seldepth: depth + 5,
  multipv,
  score: { kind: "cp", value: cp },
  bound: null,
  nodes: 1000,
  nps: 1000,
  timeMs: 1,
  pv,
});

// Engine lines (side-to-move scores, as Stockfish reports them).
const linesBefore = [
  infoToLine(RUY_BEFORE, info(1, -20, ["f6e4", "d2d4", "b7b5"])),
  infoToLine(RUY_BEFORE, info(2, -25, ["f8e7", "f1e1", "b7b5"])),
  infoToLine(RUY_BEFORE, info(3, -30, ["b7b5", "a4b3", "f8e7"])),
];
const linesAfter = [
  infoToLine(RUY_AFTER, info(1, 27, ["f1e1", "b7b5", "a4b3"])),
  infoToLine(RUY_AFTER, info(2, 20, ["d2d3", "b7b5", "a4b3"])),
];

function history(fens: string[]) {
  return fens.map((fen, i) => ({ fen, san: i === 0 ? null : "x" }));
}

describe("engine lines", () => {
  it("converts to White's point of view with SAN", () => {
    const l = linesBefore[0]; // Black to move, -20 for Black = +20 for White
    expect(l.scoreWhite).toEqual({ kind: "cp", value: 20 });
    expect(l.pvSan).toEqual(["Nxe4", "d4", "b5"]);
  });

  it("merges MultiPV lines and skips bound-only scores", () => {
    let lines = mergeInfo([], START_FEN, info(2, 10, ["d2d4"]), 3);
    lines = mergeInfo(lines, START_FEN, info(1, 30, ["e2e4"]), 3);
    expect(lines.map((l) => l.multipv)).toEqual([1, 2]);
    lines = mergeInfo(lines, START_FEN, { ...info(1, 99, ["g1f3"]), bound: "lower" }, 3);
    expect(lines[0].pvSan[0]).toBe("e4");
    expect(mergeInfo(lines, START_FEN, info(4, 0, ["a2a3"]), 3)).toBe(lines); // beyond MultiPV
  });
});

describe("context packet", () => {
  const packet = buildPacket({
    fen: RUY_AFTER,
    lines: linesAfter,
    history: [
      { fen: START_FEN, san: null },
      { fen: RUY_BEFORE, san: "O-O" },
      { fen: RUY_AFTER, san: "Be7" },
    ],
    move: { san: "Be7", uci: "f8e7", color: "black", fenBefore: RUY_BEFORE, linesBefore },
  });

  it("contains everything Claude needs", () => {
    const t = packet.text;
    expect(t).toContain(`FEN: ${RUY_AFTER}`);
    expect(t).toContain("Side to move: White");
    expect(t).toContain("Game phase: opening");
    expect(t).toContain("Ruy Lopez");
    expect(t).toContain("Played: 5...Be7 by Black");
    expect(t).toContain("The engine's best move instead was: Nxe4");
    expect(t).toContain("1. 6.Re1 b5 7.Bb3");
    expect(t).toContain("Castling: White castled kingside");
    expect(t).toContain("LEGAL MOVES NOW:");
    expect(t).toContain("800-1200");
    expect(t).not.toMatch(/centipawn|cp /i);
  });

  it("knows which moves are allowed", () => {
    expect(packet.allowed.engineFirstBefore).toEqual(new Set(["Nxe4", "Be7", "b5"]));
    expect(packet.allowed.legalNow.has("Re1")).toBe(true);
    expect(packet.allowed.anywhere.has("Bb3")).toBe(true);
    expect(packet.allowed.anywhere.has("Qh5")).toBe(false);
  });

  it("builds prompts for both request kinds", () => {
    expect(buildPrompt("moveExplanation", packet, { san: "Be7", uci: "f8e7", color: "black", fenBefore: RUY_BEFORE, linesBefore })).toContain(
      "Explain the move 5...Be7",
    );
    expect(buildPrompt("positionPlan", packet)).toContain("candidate_moves: only the first moves of the ENGINE LINES");
  });

  it("works for a start position without history", () => {
    const p = buildPacket({ fen: START_FEN, lines: [], history: history([START_FEN]) });
    expect(p.text).toContain("Moves played so far (last 10): none");
    expect(p.text).toContain("(no engine lines");
  });
});

describe("validating Claude's answers", () => {
  const packet = buildPacket({
    fen: RUY_AFTER,
    lines: linesAfter,
    history: [
      { fen: RUY_BEFORE, san: null },
      { fen: RUY_AFTER, san: "Be7" },
    ],
    move: { san: "Be7", uci: "f8e7", color: "black", fenBefore: RUY_BEFORE, linesBefore },
  });

  it("finds move-like tokens but not plain squares", () => {
    expect(sanTokensIn("After Nxe4 and d4, play O-O and fight for e4; Bb3+ next, exd5 or e8=Q.")).toEqual([
      "Nxe4",
      "O-O",
      "Bb3",
      "exd5",
      "e8=Q",
    ]);
    expect(sanTokensIn("Nothing here. Rook on e-file.")).toEqual([]);
    // Naming a piece by its square isn't a move.
    expect(sanTokensIn("Your e4 pawn is attacked by the Nf6, and Black's Bb7 eyes it. Play Re1.")).toEqual(["Re1"]);
    expect(normalizeSan("12...Nf6+!")).toBe("Nf6");
    expect(normalizeSan("0-0")).toBe("O-O");
  });

  it("keeps a valid better move and flags invented ones", () => {
    const ok = checkMoveExplanation(
      {
        summary: "Be7 is solid, but Nxe4 was a bit more active.",
        ideas: ["Castle soon with O-O.", "Watch out for Qh5 tricks."],
        better_move: { san: "Nxe4", why: "It grabs the e4 pawn." },
        plan_next: "Play b5 and Bb3, then castle.",
        concepts: ["development", "king-safety"],
      },
      packet.allowed,
    );
    expect(ok.data.better_move?.san).toBe("Nxe4");
    expect(ok.warnings).toEqual([]);
    expect(ok.flagged).toEqual(["Qh5"]); // not legal and not in any line
  });

  it("drops a better move that isn't an engine move", () => {
    const bad = checkMoveExplanation(
      { summary: "s", ideas: [], better_move: { san: "Qe7", why: "w" }, plan_next: "p", concepts: [] },
      packet.allowed,
    );
    expect(bad.data.better_move).toBeNull();
    expect(bad.warnings[0]).toEqual({ code: "betterMoveDropped", san: "Qe7" });
  });

  it("drops candidate moves that aren't engine lines and limits list sizes", () => {
    const r = checkPositionPlan(
      {
        summary: "s",
        phase_focus: "f",
        plan: ["a", "b", "c", "d"],
        opponent_ideas: ["x"],
        candidate_moves: [
          { san: "Re1", idea: "protect e4" },
          { san: "Qh5", idea: "invented" },
          { san: "d3", idea: "solid" },
        ],
        concepts: ["center"],
      },
      packet.allowed,
    );
    expect(r.data.candidate_moves.map((c) => c.san)).toEqual(["Re1", "d3"]);
    expect(r.data.plan).toHaveLength(3);
    expect(r.warnings).toHaveLength(1);
  });

  it("copes with junk", () => {
    const r = checkPositionPlan(null, packet.allowed);
    expect(r.data.summary).toBe("");
    expect(r.data.candidate_moves).toEqual([]);
  });

  it("sees promotions as legal when they are", () => {
    const fen = playUci("8/P7/8/8/8/8/8/k6K w - - 0 1", "h1g1")!.fen;
    expect(fen).toBeTruthy();
  });
});
