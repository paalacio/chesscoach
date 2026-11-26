import { describe, expect, it } from "vitest";
import { epdOf, playUci, START_FEN } from "./chess";
import {
  addLine,
  addReply,
  deviationOf,
  type GameLine,
  nodeAt,
  pathTo,
  pickReply,
  type Repertoire,
  repertoireFromPgn,
  repertoireToPgn,
  removeMove,
  repStats,
  sanLineToUcis,
  setMyMove,
} from "./repertoire";
import { buildRepertoire, type BuildOracle, chooseMyMove, type MoveStats } from "./repertoire-build";

const empty = (color: "white" | "black", id = 1): Repertoire => ({ id, name: "Test", color, moves: [], notes: {}, meta: {} });

/** The FEN after a SAN line from the start. */
function fenAfter(line: string): string {
  let fen = START_FEN;
  for (const u of sanLineToUcis(line) ?? []) fen = (playUci(fen, u) as { fen: string }).fen;
  return fen;
}

function withLine(rep: Repertoire, line: string): Repertoire {
  return { ...rep, moves: addLine(rep, START_FEN, sanLineToUcis(line) ?? [], "user").moves };
}

describe("repertoire tree", () => {
  it("merges transpositions: two move orders reach the same position", () => {
    let rep = withLine(empty("black"), "1.d4 Nf6 2.c4 e6 3.Nc3 Bb4");
    rep = withLine(rep, "1.c4 e6 2.d4 Nf6 3.Nf3 b6");
    const node = nodeAt(rep, fenAfter("1.c4 e6 2.d4 Nf6"));
    // Same position as after 1.d4 Nf6 2.c4 e6: White's replies from both lines are there.
    expect(node?.replies.map((m) => m.san).sort()).toEqual(["Nc3", "Nf3"]);
    expect(repStats(rep).myMoves).toBe(6); // Nf6, e6, Bb4 (1.d4 order) + e6, Nf6, b6 (1.c4 order)
  });

  it("changing your move removes what only followed the old one", () => {
    let rep = withLine(empty("white"), "1.e4 e5 2.Nf3 Nc6 3.Bb5");
    const before = repStats(rep).positions;
    rep = { ...rep, moves: setMyMove(rep, fenAfter("1.e4 e5 2.Nf3 Nc6"), "f1c4") };
    expect(nodeAt(rep, fenAfter("1.e4 e5 2.Nf3 Nc6"))?.mine?.san).toBe("Bc4");
    expect(repStats(rep).positions).toBe(before);
    rep = { ...rep, moves: removeMove(rep, epdOf(fenAfter("1.e4")), "e7e5") };
    expect(rep.moves.map((m) => m.san)).toEqual(["e4"]);
  });

  it("keeps one move of yours per position; a conflicting line stops there", () => {
    const rep = withLine(empty("white"), "1.e4 e5 2.Nf3");
    const r = addLine(rep, START_FEN, sanLineToUcis("1.e4 e5 2.Bc4 Nf6") ?? [], "user");
    expect(r.conflicts).toBe(1);
    expect(r.moves.filter((m) => m.mine).map((m) => m.san)).toEqual(["e4", "Nf3"]);
    const replaced = addLine(rep, START_FEN, sanLineToUcis("1.e4 e5 2.Bc4 Nf6") ?? [], "user", true);
    expect(replaced.moves.filter((m) => m.mine).map((m) => m.san).sort()).toEqual(["Bc4", "e4"]);
  });

  it("finds the most likely way into a position and picks replies by share", () => {
    let rep = withLine(empty("black"), "1.e4 c5 2.Nf3 d6");
    rep = withLine(rep, "1.e4 c5 2.c3 Nf6");
    rep = { ...rep, moves: addReply(rep, fenAfter("1.e4 c5"), "g1f3", 70) };
    rep = { ...rep, moves: addReply(rep, fenAfter("1.e4 c5"), "c2c3", 10) };
    expect(pathTo(rep, epdOf(fenAfter("1.e4 c5 2.Nf3")))?.map((m) => m.san)).toEqual(["e4", "c5", "Nf3"]);
    const node = nodeAt(rep, fenAfter("1.e4 c5")) as NonNullable<ReturnType<typeof nodeAt>>;
    expect(node.replies.map((r) => r.san)).toEqual(["Nf3", "c3"]); // most played first
    expect(pickReply(node, 0.5)?.san).toBe("Nf3");
    expect(pickReply(node, 0.99)?.san).toBe("c3");
  });

  it("reads SAN lines with move numbers", () => {
    expect(sanLineToUcis("1.e4 c5 2.Nf3 d6 3.d4")).toEqual(["e2e4", "c7c5", "g1f3", "d7d6", "d2d4"]);
    expect(sanLineToUcis("1. e4 e5 2. Ke3")).toBeNull();
  });
});

describe("repertoire PGN", () => {
  it("exports with variations and notes, and imports back", () => {
    let rep = withLine(empty("black"), "1.e4 c5 2.Nf3 d6");
    rep = withLine(rep, "1.d4 Nf6");
    rep = { ...rep, notes: { [epdOf(fenAfter("1.e4 c5"))]: { epd: epdOf(fenAfter("1.e4 c5")), note: "The Sicilian", why: null } } };
    const pgn = repertoireToPgn(rep);
    expect(pgn).toContain('[Orientation "black"]');
    expect(pgn).toContain("{ The Sicilian }");
    expect(pgn).toMatch(/1\. e4 \( 1\. d4 Nf6 \) 1\.\.\. c5/);

    const back = repertoireFromPgn(empty("black", 2), pgn);
    expect(back.color).toBe("black");
    expect(back.added).toBe(6);
    expect(back.notes).toEqual([{ epd: epdOf(fenAfter("1.e4 c5")), note: "The Sicilian", why: null }]);
    expect(repStats({ moves: back.moves }).myMoves).toBe(3);
  });
});

describe("where games left the repertoire", () => {
  const rep = withLine(withLine(empty("white"), "1.e4 e5 2.Nf3 Nc6 3.Bb5"), "1.e4 c5 2.Nf3");
  const game = (line: string): GameLine => {
    const ucis = sanLineToUcis(line) ?? [];
    let fen = START_FEN;
    const moves = ucis.map((u, i) => {
      const p = playUci(fen, u) as { fen: string; san: string };
      const m = { ply: i + 1, epd: epdOf(fen), uci: u, san: p.san };
      fen = p.fen;
      return m;
    });
    return { gameId: 1, url: "u", myColor: "white", opponent: "x", myResult: "win", endTime: null, moves };
  };

  it("spots your own deviation", () => {
    const d = deviationOf([rep], game("1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5"));
    expect(d).toMatchObject({ kind: "mine", ply: 5, played: { san: "Bc4" }, expected: { san: "Bb5" } });
  });

  it("spots a new opponent move", () => {
    expect(deviationOf([rep], game("1.e4 e6 2.d4"))).toMatchObject({ kind: "opponent", ply: 2, played: { san: "e6" } });
  });

  it("says when a game followed the line to its end", () => {
    expect(deviationOf([rep], game("1.e4 c5 2.Nf3 d6 3.d4"))).toMatchObject({ kind: "end", ply: 4 });
  });

  it("ignores repertoires of the other colour", () => {
    expect(deviationOf([{ ...rep, color: "black" }], game("1.e4 e6"))).toBeNull();
  });
});

describe("building a repertoire", () => {
  // A tiny made-up explorer: after 1.e4, Black plays c5 60%, e5 30%, e6 7%, b6 3%.
  const opponentTable: Record<string, MoveStats> = {
    [epdOf(fenAfter("1.e4"))]: {
      total: 100,
      moves: [
        { uci: "c7c5", san: "c5", games: 60 },
        { uci: "e7e5", san: "e5", games: 30 },
        { uci: "e7e6", san: "e6", games: 7 },
        { uci: "b7b6", san: "b6", games: 3 },
      ],
    },
    [epdOf(fenAfter("1.e4 c5 2.Nf3"))]: { total: 100, moves: [{ uci: "d7d6", san: "d6", games: 50 }, { uci: "b8c6", san: "Nc6", games: 50 }] },
  };
  const theoryTable: Record<string, MoveStats> = {
    [epdOf(fenAfter("1.e4 c5"))]: { total: 100, moves: [{ uci: "g1f3", san: "Nf3", games: 80 }, { uci: "b1c3", san: "Nc3", games: 20 }] },
    [epdOf(fenAfter("1.e4 e5"))]: { total: 100, moves: [{ uci: "g1f3", san: "Nf3", games: 90 }] },
  };
  const oracle: BuildOracle = {
    opponentMoves: async (fen) => opponentTable[epdOf(fen)] ?? null,
    theoryMoves: async (fen) => theoryTable[epdOf(fen)] ?? null,
    // The engine likes the theory moves; elsewhere its best move is the first legal pawn push.
    evaluate: async (fen, candidates) => ({
      best: { uci: epdOf(fen) === epdOf(fenAfter("1.e4 e6")) ? "d2d4" : (candidates[0] ?? "a2a3"), win: 55 },
      moves: Object.fromEntries(candidates.map((c) => [c, 54])),
    }),
  };

  it("adds common replies, skips rare ones, and fills in your moves", async () => {
    const seeds = [sanLineToUcis("1.e4") ?? []];
    const r = await buildRepertoire(empty("white"), seeds, oracle, { minShare: 5, minReach: 1, maxPlies: 3, maxPositions: 100 });
    const rep = { ...empty("white"), moves: r.moves };
    expect(nodeAt(rep, fenAfter("1.e4"))?.replies.map((m) => m.san)).toEqual(["c5", "e5", "e6"]); // b6 (3%) left out
    expect(nodeAt(rep, fenAfter("1.e4 c5"))?.mine).toMatchObject({ san: "Nf3", source: "theory" });
    expect(nodeAt(rep, fenAfter("1.e4 e6"))?.mine).toMatchObject({ san: "d4", source: "engine" });
    // maxPlies 3: the replies after 2.Nf3 (half-move 3, Black to move) aren't added.
    expect(nodeAt(rep, fenAfter("1.e4 c5 2.Nf3"))?.replies ?? []).toEqual([]);
    expect(r.incomplete).toBe(false);
  });

  it("drops lines that come up too rarely overall", async () => {
    const r = await buildRepertoire(empty("white"), [sanLineToUcis("1.e4") ?? []], oracle, {
      minShare: 5,
      minReach: 10, // e6 (7% of games) is now too rare
      maxPlies: 6,
      maxPositions: 100,
    });
    const rep = { ...empty("white"), moves: r.moves };
    expect(nodeAt(rep, fenAfter("1.e4"))?.replies.map((m) => m.san)).toEqual(["c5", "e5"]);
    // 1.e4 c5 2.Nf3 comes up in 60% of games; d6 and Nc6 (50% each) → 30% each: kept.
    expect(nodeAt(rep, fenAfter("1.e4 c5 2.Nf3"))?.replies.map((m) => m.san).sort()).toEqual(["Nc6", "d6"]);
  });

  it("stops at the position budget and says so", async () => {
    const r = await buildRepertoire(empty("white"), [sanLineToUcis("1.e4") ?? []], oracle, { minShare: 5, minReach: 1, maxPlies: 10, maxPositions: 2 });
    expect(r.incomplete).toBe(true);
  });

  it("prefers the engine's move when the theory move is clearly worse", async () => {
    const worse: BuildOracle = { ...oracle, evaluate: async () => ({ best: { uci: "b1c3", win: 60 }, moves: { g1f3: 50, b1c3: 60 } }) };
    expect(await chooseMyMove(fenAfter("1.e4 c5"), worse)).toEqual({ uci: "b1c3", source: "theory" });
    const noTheory: BuildOracle = { ...oracle, theoryMoves: async () => null, evaluate: async () => ({ best: { uci: "d2d4", win: 52 }, moves: {} }) };
    expect(await chooseMyMove(fenAfter("1.e4 c5"), noTheory)).toEqual({ uci: "d2d4", source: "engine" });
  });
});
