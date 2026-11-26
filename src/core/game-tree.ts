// The move tree of the analysis board: a main line plus variations.
//
// Each node is one position. A node's id is the path of UCI moves that leads to it
// ("e2e4 e7e5 g1f3"), and the root's id is "". The first child of a node is the
// main line; the other children are variations. Functions here never change a tree
// in place: they return a new one (that's what React state needs).

import type { Position } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { ChildNode, type Game, makePgn, Node, type PgnNodeData, parsePgn, startingPosition } from "chessops/pgn";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { fenOf, playUci, positionFromFen, START_FEN } from "./chess";

export const ROOT = "";

export interface TreeNode {
  id: string;
  /** Half-moves from the start of the game (the root has ply 0, or more if it starts from a FEN). */
  ply: number;
  fen: string;
  /** The move that led here (null for the root). */
  san: string | null;
  uci: string | null;
  parent: string | null;
  /** First child = main line, the rest are variations. */
  children: string[];
  comment: string;
}

export interface GameTree {
  nodes: Record<string, TreeNode>;
  /** PGN headers (Event, White, Black, Result, ...). */
  headers: Record<string, string>;
}

function plyFromFen(fen: string): number {
  const parts = fen.trim().split(/\s+/);
  const fullmove = Number(parts[5] ?? 1) || 1;
  return (fullmove - 1) * 2 + (parts[1] === "b" ? 1 : 0);
}

export function newTree(fen: string = START_FEN, headers: Record<string, string> = {}): GameTree {
  const normalized = fenOf(positionFromFen(fen)); // throws on a bad FEN
  return {
    nodes: {
      [ROOT]: { id: ROOT, ply: plyFromFen(normalized), fen: normalized, san: null, uci: null, parent: null, children: [], comment: "" },
    },
    headers,
  };
}

export function childId(parentId: string, uci: string): string {
  return parentId === ROOT ? uci : `${parentId} ${uci}`;
}

/** Adds a move after `parentId` (or reuses it if it's already there). Null if the move is illegal. */
export function addMove(tree: GameTree, parentId: string, uci: string): { tree: GameTree; id: string } | null {
  const parent = tree.nodes[parentId];
  if (!parent) return null;
  const played = playUci(parent.fen, uci);
  if (!played) return null;
  const id = childId(parentId, played.uci);
  if (tree.nodes[id]) return { tree, id };
  const node: TreeNode = {
    id,
    ply: parent.ply + 1,
    fen: played.fen,
    san: played.san,
    uci: played.uci,
    parent: parentId,
    children: [],
    comment: "",
  };
  return {
    tree: {
      ...tree,
      nodes: { ...tree.nodes, [id]: node, [parentId]: { ...parent, children: [...parent.children, id] } },
    },
    id,
  };
}

/** Nodes from the root to `id` (inclusive). */
export function pathTo(tree: GameTree, id: string): TreeNode[] {
  const out: TreeNode[] = [];
  let cur: TreeNode | undefined = tree.nodes[id];
  while (cur) {
    out.push(cur);
    cur = cur.parent === null ? undefined : tree.nodes[cur.parent];
  }
  return out.reverse();
}

/** `id` followed by its main-line continuation. */
export function mainlineFrom(tree: GameTree, id: string): TreeNode[] {
  const out: TreeNode[] = [];
  let cur: TreeNode | undefined = tree.nodes[id];
  while (cur) {
    out.push(cur);
    cur = cur.children.length ? tree.nodes[cur.children[0]] : undefined;
  }
  return out;
}

export const nextId = (tree: GameTree, id: string) => tree.nodes[id]?.children[0] ?? id;
export const prevId = (tree: GameTree, id: string) => tree.nodes[id]?.parent ?? id;
export const lastId = (tree: GameTree, id: string) => mainlineFrom(tree, id).at(-1)?.id ?? id;

/** True if every step from the root to `id` follows the first child. */
export function isMainline(tree: GameTree, id: string): boolean {
  return pathTo(tree, id).every((n) => n.parent === null || tree.nodes[n.parent].children[0] === n.id);
}

/** Moves this node's branch up to be the main line at its fork. */
export function promote(tree: GameTree, id: string): GameTree {
  const node = tree.nodes[id];
  if (!node || node.parent === null) return tree;
  // Walk up to the nearest fork where this branch is not first.
  let child = node;
  while (child.parent !== null) {
    const parent = tree.nodes[child.parent];
    if (parent.children[0] !== child.id) {
      const children = [child.id, ...parent.children.filter((c) => c !== child.id)];
      return { ...tree, nodes: { ...tree.nodes, [parent.id]: { ...parent, children } } };
    }
    child = parent;
  }
  return tree;
}

/** Removes a node and everything after it. */
export function deleteNode(tree: GameTree, id: string): GameTree {
  const node = tree.nodes[id];
  if (!node || node.parent === null) return tree;
  const nodes = { ...tree.nodes };
  const drop = (nid: string) => {
    for (const c of nodes[nid].children) drop(c);
    delete nodes[nid];
  };
  drop(id);
  const parent = nodes[node.parent];
  nodes[node.parent] = { ...parent, children: parent.children.filter((c) => c !== id) };
  return { ...tree, nodes };
}

export function setComment(tree: GameTree, id: string, comment: string): GameTree {
  const node = tree.nodes[id];
  if (!node) return tree;
  return { ...tree, nodes: { ...tree.nodes, [id]: { ...node, comment } } };
}

/** Chess.com and Lichess PGNs carry clock data like `[%clk 0:09:58.1]` in comments; hide it. */
export function cleanComment(raw: string): string {
  return raw.replace(/\[%[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

/** Reads the first game of a PGN (with variations and comments). Throws on errors. */
export function treeFromPgn(pgn: string): GameTree {
  const games = parsePgn(pgn);
  const game = games[0];
  if (!game || (game.moves.children.length === 0 && game.headers.size === 0)) {
    throw new Error("No game found in that PGN.");
  }
  const start = startingPosition(game.headers);
  if (start.isErr) throw new Error(`The PGN's starting position isn't valid (${start.error.message}).`);
  const headers: Record<string, string> = {};
  for (const [k, v] of game.headers) headers[k] = v;

  let tree = newTree(makeFen(start.value.toSetup()), headers);
  const walk = (pgnNode: Node<PgnNodeData>, parentId: string, pos: Position) => {
    for (const child of pgnNode.children) {
      const move = parseSan(pos, child.data.san);
      if (!move) throw new Error(`Illegal move in the PGN: ${child.data.san}`);
      const next = pos.clone();
      makeSanAndPlay(next, move);
      const added = addMove(tree, parentId, makeUci(move));
      if (!added) throw new Error(`Illegal move in the PGN: ${child.data.san}`);
      tree = added.tree;
      const comment = cleanComment((child.data.comments ?? []).join(" "));
      if (comment) tree = setComment(tree, added.id, comment);
      walk(child, added.id, next);
    }
  };
  walk(game.moves, ROOT, start.value);
  return tree;
}

/** Writes the tree as PGN (variations and comments included). */
export function treeToPgn(tree: GameTree): string {
  const headers = new Map<string, string>(Object.entries(tree.headers));
  const root = tree.nodes[ROOT];
  if (root.fen !== START_FEN) {
    headers.set("SetUp", "1");
    headers.set("FEN", root.fen);
  }
  if (!headers.has("Result")) headers.set("Result", "*");
  const build = (id: string, into: Node<PgnNodeData>) => {
    for (const cid of tree.nodes[id].children) {
      const n = tree.nodes[cid];
      const child = new ChildNode<PgnNodeData>({ san: n.san ?? "", comments: n.comment ? [n.comment] : undefined });
      into.children.push(child);
      build(cid, child);
    }
  };
  const moves = new Node<PgnNodeData>();
  build(ROOT, moves);
  const game: Game<PgnNodeData> = { headers, moves };
  return makePgn(game);
}

/** Accepts either a FEN or a PGN, as pasted by the user. */
export function treeFromText(text: string): GameTree {
  const t = text.trim();
  if (!t) throw new Error("Paste a PGN or a FEN first.");
  // A FEN is a single line with 8 ranks separated by "/".
  if (!t.includes("\n") && t.split(" ")[0].split("/").length === 8) return newTree(t);
  return treeFromPgn(t);
}
