// Repertoire: the moves you play and the opponent replies you're ready for.
//
// A repertoire is stored as a flat list of moves. Each move belongs to the
// position before it, keyed by EPD (a FEN without move counters), so two move
// orders that reach the same position share everything after it ("transpositions
// merge"). In each position where it's your turn there is exactly one move of
// yours; where it's the opponent's turn there can be several replies, each with
// how often it's played (its "share", in % of games).
//
// Every function here returns new data instead of changing what it gets.

import { type Game, makePgn, Node as PgnNode, ChildNode, type PgnNodeData, parsePgn, startingPosition } from "chessops/pgn";
import { makeFen } from "chessops/fen";
import { epdOf, playUci, sanToUci, START_FEN, turnOf } from "./chess";
import { cleanComment } from "./game-tree";
import type { Color } from "./types";

/** Where a move came from (shown in the UI). */
export type RepSource = "claude" | "theory" | "engine" | "explorer" | "user" | "pgn" | "game";

export interface RepMove {
  /** Position before the move. */
  epd: string;
  /** A full FEN of that position. */
  fen: string;
  uci: string;
  san: string;
  /** true = your move, false = an opponent reply. */
  mine: boolean;
  /** Opponent replies: % of games at your level that choose this move (null = unknown). */
  share: number | null;
  source: RepSource;
}

export interface RepNote {
  epd: string;
  note: string;
  /** Claude's one-line reason for your move here. */
  why: string | null;
}

/** An opening chosen in the wizard for one slot (e.g. "Black vs 1.e4"). */
export interface ChosenLine {
  slot: string;
  name: string;
  /** SAN with move numbers, from the start position. */
  moves: string;
}

export interface RepertoireMeta {
  lines?: ChosenLine[];
  /** Unix ms of the last automatic build. */
  builtAt?: number;
  /** The last build stopped early (position budget reached, or cancelled). */
  incomplete?: boolean;
}

export interface Repertoire {
  id: number;
  name: string;
  color: Color;
  moves: RepMove[];
  notes: Record<string, RepNote>;
  meta: RepertoireMeta;
}

/** One position of a repertoire, with its moves. */
export interface RepNode {
  epd: string;
  fen: string;
  /** Your move here (only where it's your turn). */
  mine: RepMove | null;
  /** Opponent replies, most played first (only where it's their turn). */
  replies: RepMove[];
  /** Half-moves from the start, along the shortest way in. */
  ply: number;
  /** Chance that a game reaches this position (0-1), following the replies' shares. */
  reach: number;
}

export const ROOT_EPD = epdOf(START_FEN);

// ---------- reading ----------

/** Moves grouped by position (not checked for reachability). */
function movesByEpd(moves: RepMove[]): Map<string, RepMove[]> {
  const out = new Map<string, RepMove[]>();
  for (const m of moves) {
    const list = out.get(m.epd);
    if (list) list.push(m);
    else out.set(m.epd, [m]);
  }
  return out;
}

const shareOf = (m: RepMove) => (m.share == null ? 0 : m.share);

/** Chance of an opponent reply being played (unknown shares count as rare: 1%). */
const chanceOf = (m: RepMove) => (m.mine ? 1 : (m.share ?? 1) / 100);

/** A small "most likely first" queue (a binary heap on `reach`, ties: fewer moves first). */
class LikelyFirst<T extends { reach: number; ply: number }> {
  private items: T[] = [];
  get size() {
    return this.items.length;
  }
  private before = (a: T, b: T) => a.reach > b.reach || (a.reach === b.reach && a.ply < b.ply);
  push(item: T) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (!this.before(a[i], a[parent])) break;
      [a[i], a[parent]] = [a[parent], a[i]];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.before(a[l], a[m])) m = l;
        if (r < a.length && this.before(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Every position you can reach from the start by following the repertoire,
 * with the most likely way in. Positions are visited most likely first, so
 * `reach` is the best chance of getting there.
 */
export function walk(moves: RepMove[]): Map<string, RepNode> {
  const byEpd = movesByEpd(moves);
  const nodes = new Map<string, RepNode>();
  const queue = new LikelyFirst<{ fen: string; ply: number; reach: number }>();
  queue.push({ fen: START_FEN, ply: 0, reach: 1 });
  for (let item = queue.pop(); item; item = queue.pop()) {
    const { fen, ply, reach } = item;
    const epd = epdOf(fen);
    if (nodes.has(epd)) continue;
    const here = byEpd.get(epd) ?? [];
    const mine = here.find((m) => m.mine) ?? null;
    const replies = here.filter((m) => !m.mine).sort((a, b) => shareOf(b) - shareOf(a));
    nodes.set(epd, { epd, fen, mine, replies, ply, reach });
    for (const m of mine ? [mine] : replies) {
      const next = playUci(fen, m.uci);
      if (!next || nodes.has(epdOf(next.fen))) continue;
      queue.push({ fen: next.fen, ply: ply + 1, reach: reach * chanceOf(m) });
    }
  }
  return nodes;
}

const walkCache = new WeakMap<RepMove[], Map<string, RepNode>>();
/** `walk`, remembered per moves list (the lists are never changed in place). */
export function nodesOf(rep: Pick<Repertoire, "moves">): Map<string, RepNode> {
  let nodes = walkCache.get(rep.moves);
  if (!nodes) {
    nodes = walk(rep.moves);
    walkCache.set(rep.moves, nodes);
  }
  return nodes;
}

export function nodeAt(rep: Pick<Repertoire, "moves">, fen: string): RepNode | null {
  return nodesOf(rep).get(epdOf(fen)) ?? null;
}

/** Is it your move in this position (for this repertoire)? */
export const isMyTurn = (rep: Pick<Repertoire, "color">, fen: string) => turnOf(fen) === rep.color;

export interface RepStats {
  positions: number;
  myMoves: number;
  /** Positions where a line ends (nothing more prepared). */
  lineEnds: number;
  /** Deepest line, in full moves. */
  depth: number;
}

export function repStats(rep: Pick<Repertoire, "moves">): RepStats {
  let myMoves = 0;
  let lineEnds = 0;
  let maxPly = 0;
  for (const n of nodesOf(rep).values()) {
    if (n.mine) myMoves++;
    if (!n.mine && n.replies.length === 0) lineEnds++;
    maxPly = Math.max(maxPly, n.ply);
  }
  return { positions: nodesOf(rep).size, myMoves, lineEnds, depth: Math.ceil(maxPly / 2) };
}

/** The most likely way from the start to a position: the moves to play, in order. */
export function pathTo(rep: Pick<Repertoire, "moves">, epd: string): RepMove[] | null {
  const nodes = nodesOf(rep);
  if (!nodes.has(epd)) return null;
  // Walk again from the start, most likely positions first, remembering the
  // move that led to each position the first time it's taken off the queue.
  const came = new Map<string, RepMove | null>();
  const queue = new LikelyFirst<{ fen: string; ply: number; reach: number; via: RepMove | null }>();
  queue.push({ fen: START_FEN, ply: 0, reach: 1, via: null });
  for (let item = queue.pop(); item && !came.has(epd); item = queue.pop()) {
    const here = epdOf(item.fen);
    if (came.has(here)) continue;
    came.set(here, item.via);
    const node = nodes.get(here);
    if (!node) continue;
    for (const m of node.mine ? [node.mine] : node.replies) {
      const next = playUci(item.fen, m.uci);
      if (next && !came.has(epdOf(next.fen))) {
        queue.push({ fen: next.fen, ply: item.ply + 1, reach: item.reach * chanceOf(m), via: m });
      }
    }
  }
  if (!came.has(epd)) return null;
  const path: RepMove[] = [];
  let at = epd;
  for (let m = came.get(at); m; m = came.get(at)) {
    path.unshift(m);
    at = m.epd;
  }
  return path;
}

/** Picks an opponent reply, more often the more it's played. `random` is 0..1. */
export function pickReply(node: RepNode, random: number): RepMove | null {
  if (node.replies.length === 0) return null;
  const weights = node.replies.map((m) => Math.max(m.share ?? 1, 0.5));
  let x = random * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return node.replies[i];
  }
  return node.replies[node.replies.length - 1];
}

// ---------- editing ----------

/** Drops moves that can't be reached from the start any more (after a change higher up). */
export function prune(moves: RepMove[]): RepMove[] {
  const nodes = walk(moves);
  return moves.filter((m) => {
    const n = nodes.get(m.epd);
    if (!n) return false;
    return m.mine ? n.mine === m : true;
  });
}

function makeMove(fen: string, uci: string, mine: boolean, share: number | null, source: RepSource): RepMove | null {
  const played = playUci(fen, uci);
  if (!played) return null;
  return { epd: epdOf(fen), fen, uci: played.uci, san: played.san, mine, share, source };
}

/** Sets your move in a position (replacing the old one and what followed it). */
export function setMyMove(rep: Repertoire, fen: string, uci: string, source: RepSource = "user"): RepMove[] {
  if (!isMyTurn(rep, fen)) return rep.moves;
  const move = makeMove(fen, uci, true, null, source);
  if (!move) return rep.moves;
  const epd = epdOf(fen);
  const old = rep.moves.find((m) => m.mine && m.epd === epd);
  if (!old) return [...rep.moves, move]; // adding never cuts anything off
  if (old.uci === move.uci) return rep.moves;
  return prune([...rep.moves.filter((m) => m !== old), move]);
}

/** Adds an opponent reply (or updates its share). */
export function addReply(rep: Repertoire, fen: string, uci: string, share: number | null, source: RepSource = "user"): RepMove[] {
  if (isMyTurn(rep, fen)) return rep.moves;
  const move = makeMove(fen, uci, false, share, source);
  if (!move) return rep.moves;
  const existing = rep.moves.find((m) => !m.mine && m.epd === move.epd && m.uci === move.uci);
  if (existing) {
    if (share == null || existing.share === share) return rep.moves;
    return rep.moves.map((m) => (m === existing ? { ...m, share } : m));
  }
  return [...rep.moves, move];
}

/** Removes a move and everything that can only be reached through it. */
export function removeMove(rep: Repertoire, epd: string, uci: string): RepMove[] {
  return prune(rep.moves.filter((m) => !(m.epd === epd && m.uci === uci)));
}

export interface AddLineResult {
  moves: RepMove[];
  /** Positions where the line wanted a different move of yours than the repertoire has. */
  conflicts: number;
  /** Moves that were new. */
  added: number;
}

/**
 * Adds a line of moves (UCI) starting from `fen`. Your moves are only set where you
 * have none yet, unless `replaceMine` is true; opponent moves are added as replies.
 */
export function addLine(rep: Repertoire, fen: string, ucis: string[], source: RepSource, replaceMine = false): AddLineResult {
  let moves = rep.moves;
  let conflicts = 0;
  let added = 0;
  let at = fen;
  for (const uci of ucis) {
    const played = playUci(at, uci);
    if (!played) break;
    const epd = epdOf(at);
    if (isMyTurn(rep, at)) {
      const current = moves.find((m) => m.mine && m.epd === epd);
      if (!current || (current.uci !== played.uci && replaceMine)) {
        moves = setMyMove({ ...rep, moves }, at, played.uci, source);
        added++;
      } else if (current.uci !== played.uci) {
        conflicts++;
        break; // the rest of the line isn't reachable in this repertoire
      }
    } else if (!moves.some((m) => !m.mine && m.epd === epd && m.uci === played.uci)) {
      moves = addReply({ ...rep, moves }, at, played.uci, null, source);
      added++;
    }
    at = played.fen;
  }
  return { moves, conflicts, added };
}

/** Reads a SAN line like "1.e4 c5 2.Nf3 d6" (from the start) as UCI moves. Null if a move is illegal. */
export function sanLineToUcis(line: string, fen: string = START_FEN): string[] | null {
  const tokens = line
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\d+\.(\.\.)?/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/[!?]+$/, ""))
    .filter((t) => t && t !== "..." && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  const out: string[] = [];
  let at = fen;
  for (const san of tokens) {
    const uci = sanToUci(at, san);
    if (!uci) return null;
    const played = playUci(at, uci);
    if (!played) return null;
    out.push(played.uci);
    at = played.fen;
  }
  return out;
}

// ---------- PGN export and import ----------

/**
 * The repertoire as one PGN game with variations: your moves and the most played
 * reply are the main line. Notes become comments after the move that reaches the
 * position. A position reached a second time (a transposition) isn't repeated.
 */
export function repertoireToPgn(rep: Repertoire): string {
  const nodes = nodesOf(rep);
  const seen = new Set<string>();
  const build = (fen: string, into: PgnNode<PgnNodeData>) => {
    const epd = epdOf(fen);
    if (seen.has(epd)) return;
    seen.add(epd);
    const node = nodes.get(epd);
    if (!node) return;
    for (const m of node.mine ? [node.mine] : node.replies) {
      const next = playUci(fen, m.uci);
      if (!next) continue;
      const note = rep.notes[epdOf(next.fen)];
      const comments = [note?.note, m.mine && note?.why ? `Why: ${note.why}` : ""].filter(Boolean) as string[];
      const child = new ChildNode<PgnNodeData>({ san: m.san, comments: comments.length ? comments : undefined });
      into.children.push(child);
      build(next.fen, child);
    }
  };
  const moves = new PgnNode<PgnNodeData>();
  build(START_FEN, moves);
  const headers = new Map<string, string>([
    ["Event", `Tung Tung Chessahur repertoire: ${rep.name}`],
    ["Site", "Tung Tung Chessahur"],
    ["White", rep.color === "white" ? "Me" : "Opponent"],
    ["Black", rep.color === "black" ? "Me" : "Opponent"],
    ["Result", "*"],
    // Lichess studies use this header for the side the study is for.
    ["Orientation", rep.color],
  ]);
  const game: Game<PgnNodeData> = { headers, moves };
  return makePgn(game);
}

export interface PgnImport {
  moves: RepMove[];
  notes: RepNote[];
  /** Colour from an "Orientation" header, if the PGN has one. */
  color: Color | null;
  added: number;
  conflicts: number;
  games: number;
}

/**
 * Adds the moves of every game in a PGN (variations included) to a repertoire.
 * Your existing moves win over the file's where they disagree (counted as conflicts).
 */
export function repertoireFromPgn(rep: Repertoire, pgn: string): PgnImport {
  const games = parsePgn(pgn);
  let moves = rep.moves;
  const notes: RepNote[] = [];
  let added = 0;
  let conflicts = 0;
  let color: Color | null = null;
  for (const game of games) {
    const o = game.headers.get("Orientation")?.toLowerCase();
    if (o === "white" || o === "black") color ??= o;
    const start = startingPosition(game.headers);
    if (start.isErr) continue;
    const walkPgn = (node: PgnNode<PgnNodeData>, fen: string) => {
      for (const child of node.children) {
        const uci = sanToUci(fen, child.data.san);
        if (!uci) continue;
        const r = addLine({ ...rep, moves }, fen, [uci], "pgn");
        moves = r.moves;
        added += r.added;
        conflicts += r.conflicts;
        if (r.conflicts) continue;
        const next = playUci(fen, uci);
        if (!next) continue;
        const comment = cleanComment((child.data.comments ?? []).join(" ")).replace(/^Why: /, "");
        if (comment) notes.push({ epd: epdOf(next.fen), note: comment, why: null });
        walkPgn(child, next.fen);
      }
    };
    walkPgn(game.moves, makeFen(start.value.toSetup()));
  }
  return { moves, notes, color, added, conflicts, games: games.length };
}

// ---------- where games left the repertoire ----------

export interface GameLine {
  gameId: number;
  url: string;
  myColor: Color;
  opponent: string;
  myResult: "win" | "loss" | "draw" | string;
  endTime: number | null;
  /** The first moves of the game; `epd` is the position before each move. */
  moves: { ply: number; epd: string; uci: string; san: string }[];
}

export interface Deviation {
  game: GameLine;
  repertoireId: number;
  /** "mine": you played something else; "opponent": a reply you haven't prepared;
   *  "end": the game followed the repertoire to the end of the line. */
  kind: "mine" | "opponent" | "end";
  /** Half-move number (1 = White's first move). */
  ply: number;
  /** FEN of the position before the move (built from the EPD, counters from the ply). */
  fen: string;
  played: { uci: string; san: string } | null;
  expected: { uci: string; san: string } | null;
}

const fenFromEpd = (epd: string, ply: number) => `${epd} 0 ${Math.floor((ply - 1) / 2) + 1}`;

/** How far a game followed one repertoire, and where it left it. */
function followGame(rep: Repertoire, game: GameLine): Deviation {
  const nodes = nodesOf(rep);
  let lastPly = 0;
  for (const m of game.moves) {
    const node = nodes.get(m.epd);
    if (!node) break;
    lastPly = m.ply;
    const base = { game, repertoireId: rep.id, ply: m.ply, fen: fenFromEpd(m.epd, m.ply), played: { uci: m.uci, san: m.san } };
    if (turnOf(node.fen) === rep.color) {
      if (!node.mine) return { ...base, kind: "end", played: null, expected: null };
      if (node.mine.uci !== m.uci) return { ...base, kind: "mine", expected: { uci: node.mine.uci, san: node.mine.san } };
    } else {
      if (node.replies.length === 0) return { ...base, kind: "end", played: null, expected: null };
      if (!node.replies.some((r) => r.uci === m.uci)) return { ...base, kind: "opponent", expected: null };
    }
  }
  const last = game.moves.find((m) => m.ply === lastPly);
  return { game, repertoireId: rep.id, kind: "end", ply: lastPly, fen: last ? fenFromEpd(last.epd, lastPly) : START_FEN, played: null, expected: null };
}

/** Where a game left your repertoire (the repertoire for your colour that it followed longest). */
export function deviationOf(reps: Repertoire[], game: GameLine): Deviation | null {
  let best: Deviation | null = null;
  for (const rep of reps) {
    if (rep.color !== game.myColor || rep.moves.length === 0) continue;
    const d = followGame(rep, game);
    if (!best || d.ply > best.ply) best = d;
  }
  // A game that never entered the repertoire (first move already different) tells us little
  // unless it was your own first move.
  if (best && best.ply === 0) return null;
  return best;
}
