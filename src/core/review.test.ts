import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type GameAnalysis, judgementGlyph, movesFromPgn, reviewGame, summarize, trainingCards } from "./review";

// The Chess.com-style fixture game used by the Rust tests:
// 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 O-O 9.h3 Nxe4 10.Rxe4 d5 11.Rxe5
const pgn = fs.readFileSync(path.join(__dirname, "../../src-tauri/tests/fixtures/chesscom/game.pgn"), "utf8");
const { startFen, moves } = movesFromPgn(pgn);

/** Scores (centipawns, White's view) for each of the 22 positions: equal until 9...Nxe4?? drops a piece. */
const CP = [20, 30, 25, 30, 25, 30, 25, 30, 25, 35, 30, 35, 30, 40, 35, 45, 40, 45, 400, 400, 600, 600];

function analysis(): GameAnalysis {
  return {
    version: 1,
    engine: "Stockfish 19",
    depth: 16,
    evals: CP.map((cp, i) => {
      // The engine "agrees" with every move played, except two:
      let best = moves[i]?.uci ?? null;
      if (i === 17) best = "c6a5"; // instead of 9...Nxe4?? the engine wanted 9...Na5
      if (i === 19) best = "e7f6"; // instead of 10...d5 the engine wanted 10...Bf6
      return { score: { kind: "cp", value: cp }, best, pv: best ? [best] : [], depth: 16 };
    }),
  };
}

describe("game review", () => {
  it("reads the game's moves from the PGN", () => {
    expect(moves).toHaveLength(21);
    expect(moves[8]).toMatchObject({ ply: 9, san: "O-O", uci: "e1g1" });
    expect(moves[17].san).toBe("Nxe4");
    expect(moves[17].fenBefore).toBe(moves[16].fenAfter);
  });

  it("classifies moves with Lichess thresholds", () => {
    const r = reviewGame(startFen, moves, analysis(), "white");
    const nxe4 = r.moves[17];
    expect(nxe4.color).toBe("black");
    expect(nxe4.judgement).toBe("blunder"); // Black's chance drops ~27 points
    expect(nxe4.bestSan).toBe("Na5");
    expect(r.moves[19].judgement).toBe("inaccuracy"); // ~9 points
    expect(r.moves[18].judgement).toBeNull(); // 10.Rxe4 was the engine's move
    expect(r.counts.black).toEqual({ inaccuracy: 1, mistake: 0, blunder: 1 });
    expect(r.counts.white).toEqual({ inaccuracy: 0, mistake: 0, blunder: 0 });
    expect(judgementGlyph(nxe4.judgement)).toBe("??");
  });

  it("computes accuracy per side and phase", () => {
    const r = reviewGame(startFen, moves, analysis(), "white");
    expect(r.accuracy.white.overall).toBeGreaterThan(95);
    expect(r.accuracy.black.overall).toBeLessThan(r.accuracy.white.overall as number);
    // A short game that never left the opening by Lichess's rules.
    expect(r.moves.every((m) => m.phase === "opening")).toBe(true);
    expect(r.accuracy.white.middlegame).toBeNull();
  });

  it("finds key moments and where the game left the named opening", () => {
    const r = reviewGame(startFen, moves, analysis(), "white");
    expect(r.keyMoments).toEqual([17, 19]);
    expect(r.opening?.name).toContain("Ruy Lopez");
    expect(r.leftBook).not.toBeNull();
    const left = r.moves[r.leftBook!.index];
    expect(left.ply).toBeGreaterThan(9); // still in named theory after 5.O-O
    expect(r.leftBook!.byMe).toBe(left.color === "white");
    expect(r.winCurve).toHaveLength(22);
  });

  it("turns only the user's mistakes and blunders into training cards", () => {
    const asBlack = reviewGame(startFen, moves, analysis(), "black");
    const cards = trainingCards(asBlack, "black");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ ply: 18, playedSan: "Nxe4", bestSan: "Na5", bestUci: "c6a5", judgement: "blunder" });
    expect(cards[0].fen).toBe(moves[17].fenBefore);
    expect(trainingCards(reviewGame(startFen, moves, analysis(), "white"), "white")).toEqual([]);
  });

  it("summarises for the games list", () => {
    const s = summarize(reviewGame(startFen, moves, analysis(), "black"), "black");
    expect(s.blunders).toBe(1);
    expect(s.inaccuracies).toBe(1);
    expect(s.accuracy).toBeLessThan(s.opponentAccuracy as number);
    expect(s.openingEco).toMatch(/^C\d\d$/);
  });

  it("refuses an analysis that doesn't match the game", () => {
    const a = analysis();
    a.evals = a.evals.slice(0, 5);
    expect(() => reviewGame(startFen, moves, a, "white")).toThrow(/positions/);
  });
});

import { buildGameReviewPrompt, checkGameReview } from "./game-review-packet";

describe("game review packet for Claude", () => {
  const review = reviewGame(startFen, moves, analysis(), "white");
  const info = {
    white: "someone",
    black: "rival_player",
    whiteElo: 1104,
    blackElo: 1087,
    result: "1-0",
    myColor: "white" as const,
    termination: "someone won by resignation",
    timeControl: "600",
    timeClass: "rapid",
  };
  const packet = buildGameReviewPrompt(info, review);

  it("describes the game, the moves and each key moment", () => {
    const p = packet.prompt;
    expect(p).toContain("The player is White.");
    expect(p).toContain("Time control: 10 min (rapid)");
    expect(p).toMatch(/9\.h3 \(\d+\) Nxe4\?\? \(\d+\)/);
    expect(p).toContain("[1] 9...Nxe4?? by your opponent (opening)");
    expect(p).toContain("Engine's move instead: 9...Na5");
    expect(p).toContain("[2] 10...d5?! by your opponent");
    expect(p).toContain("Write in English.");
    expect(buildGameReviewPrompt(info, review, "pt").prompt).toContain("Brazilian Portuguese");
    expect(packet.momentBest.get(1)).toBe("Na5");
  });

  it("checks Claude's answer", () => {
    const checked = checkGameReview(
      {
        summary: "Your opponent blundered a knight with Nxe4 and you took it with Rxe4.",
        lessons: [
          { title: "Punish hanging pieces", explanation: "After Nxe4 the knight was simply lost.", phase: "opening", concept: "hanging-piece" },
          { title: "b", explanation: "Qh5 would be nice.", phase: "nonsense", concept: "x" },
          { title: "c", explanation: "c", phase: "endgame", concept: "x" },
          { title: "extra", explanation: "dropped", phase: "endgame", concept: "x" },
        ],
        key_moments: [
          { id: 1, comment: "A blunder.", better_move: "Na5" },
          { id: 2, comment: "Not the best.", better_move: "Qd7" },
          { id: 9, comment: "Unknown id", better_move: null },
        ],
        concepts: ["hanging-piece"],
      },
      packet,
    );
    expect(checked.data.lessons).toHaveLength(3);
    expect(checked.data.lessons[1].phase).toBe("middlegame"); // invalid phase replaced
    expect(checked.data.keyMoments.map((k) => k.id)).toEqual([1, 2]);
    expect(checked.data.keyMoments[0]).toMatchObject({ index: 17, betterMove: "Na5" });
    expect(checked.data.keyMoments[1].betterMove).toBeNull(); // Qd7 isn't the engine's move
    expect(checked.warnings).toHaveLength(1);
    expect(checked.flagged).toEqual(["Qh5"]);
  });
});
