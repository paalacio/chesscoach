import { describe, expect, it } from "vitest";
import { formatMoves, legalSans, playUci, START_FEN, uciLineToSan } from "./chess";
import {
  addMove,
  cleanComment,
  deleteNode,
  isMainline,
  lastId,
  mainlineFrom,
  newTree,
  pathTo,
  promote,
  ROOT,
  treeFromPgn,
  treeFromText,
  treeToPgn,
} from "./game-tree";

function play(moves: string[]) {
  let tree = newTree();
  let id = ROOT;
  for (const m of moves) {
    const r = addMove(tree, id, m);
    if (!r) throw new Error(`illegal ${m}`);
    tree = r.tree;
    id = r.id;
  }
  return { tree, id };
}

describe("chess helpers", () => {
  it("converts UCI lines to SAN and stops at illegal moves", () => {
    expect(uciLineToSan(START_FEN, ["e2e4", "e7e5", "g1f3"])).toEqual(["e4", "e5", "Nf3"]);
    expect(uciLineToSan(START_FEN, ["e2e4", "e2e4"])).toEqual(["e4"]);
    expect(playUci(START_FEN, "e2e5")).toBeNull();
  });

  it("formats move numbers for both sides", () => {
    expect(formatMoves(START_FEN, ["e4", "e5", "Nf3"])).toBe("1.e4 e5 2.Nf3");
    const afterE4 = playUci(START_FEN, "e2e4")!.fen;
    expect(formatMoves(afterE4, ["e5", "Nf3"])).toBe("1...e5 2.Nf3");
  });

  it("lists legal moves including promotions", () => {
    expect(legalSans(START_FEN)).toHaveLength(20);
    const promo = legalSans("8/P7/8/8/8/8/8/k6K w - - 0 1");
    expect(promo).toEqual(expect.arrayContaining(["a8=Q+", "a8=N"]));
  });
});

describe("game tree", () => {
  it("adds moves, reuses existing ones and tracks the path", () => {
    const { tree, id } = play(["e2e4", "e7e5", "g1f3"]);
    expect(id).toBe("e2e4 e7e5 g1f3");
    expect(tree.nodes[id].san).toBe("Nf3");
    expect(tree.nodes[id].ply).toBe(3);
    expect(pathTo(tree, id).map((n) => n.san)).toEqual([null, "e4", "e5", "Nf3"]);
    const again = addMove(tree, "e2e4 e7e5", "g1f3")!;
    expect(again.tree).toBe(tree); // unchanged
    expect(addMove(tree, ROOT, "e2e5")).toBeNull();
  });

  it("keeps variations and can promote and delete them", () => {
    let { tree } = play(["e2e4", "e7e5", "g1f3"]);
    tree = addMove(tree, "e2e4", "c7c5")!.tree; // 1...c5 as a variation
    expect(tree.nodes["e2e4"].children).toEqual(["e2e4 e7e5", "e2e4 c7c5"]);
    expect(isMainline(tree, "e2e4 c7c5")).toBe(false);
    tree = promote(tree, "e2e4 c7c5");
    expect(tree.nodes["e2e4"].children[0]).toBe("e2e4 c7c5");
    expect(lastId(tree, ROOT)).toBe("e2e4 c7c5");
    tree = deleteNode(tree, "e2e4 e7e5");
    expect(tree.nodes["e2e4 e7e5 g1f3"]).toBeUndefined();
    expect(tree.nodes["e2e4"].children).toEqual(["e2e4 c7c5"]);
  });

  it("round-trips PGN with variations and comments", () => {
    const pgn = `[Event "Test"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 (1... c5 2. Nf3) 2. Nf3 {develops} Nc6 3. Bb5 *`;
    const tree = treeFromPgn(pgn);
    expect(mainlineFrom(tree, ROOT).map((n) => n.san)).toEqual([null, "e4", "e5", "Nf3", "Nc6", "Bb5"]);
    expect(tree.nodes["e2e4 c7c5 g1f3"].san).toBe("Nf3");
    expect(tree.nodes["e2e4 e7e5 g1f3"].comment).toBe("develops");
    expect(tree.headers.White).toBe("A");
    const out = treeToPgn(tree);
    expect(out).toContain("1. e4 e5 ( 1... c5 2. Nf3 ) 2. Nf3 { develops } Nc6 3. Bb5 *");
    const again = treeFromPgn(out);
    expect(Object.keys(again.nodes).sort()).toEqual(Object.keys(tree.nodes).sort());
  });

  it("reads Chess.com PGNs and hides clock comments", () => {
    const pgn = `[Event "Live Chess"]\n[Site "Chess.com"]\n[Result "1-0"]\n\n1. e4 {[%clk 0:09:58.5]} 1... e5 {[%clk 0:09:57]} 2. Qh5 {[%clk 0:09:50]} 1-0`;
    const tree = treeFromPgn(pgn);
    expect(tree.nodes["e2e4"].comment).toBe("");
    expect(tree.nodes["e2e4 e7e5 d1h5"].san).toBe("Qh5");
    expect(cleanComment("good move [%clk 0:01:00] [%eval 0.3]")).toBe("good move");
  });

  it("imports a FEN or a PGN from pasted text", () => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const t = treeFromText(fen);
    expect(t.nodes[ROOT].fen).toBe(fen);
    expect(t.nodes[ROOT].ply).toBe(4);
    expect(treeToPgn(t)).toContain(`[FEN "${fen}"]`);
    expect(() => treeFromText("")).toThrow();
    expect(() => treeFromText("8/8/8/8/8/8/8/8 w - - 0 1")).toThrow(/isn't legal/);
    expect(() => treeFromText("1. e4 e5 2. Ke3")).toThrow(/Illegal move/);
  });
});
