// Courses, books and Lichess studies: an annotated PGN becomes a repertoire, and
// the author's comments (and the side lines they show) are kept as notes on the moves.
//
// - Your moves: the first move the course gives for your side in each position (its
//   main line). Other moves it shows for your side are kept as "side line" notes,
//   since a repertoire has one move of yours per position.
// - Opponent moves: every reply the course covers becomes a prepared reply.
// - Comments before and after each move, and annotation symbols (!, ?!, ±, ...), are
//   kept per move; a chapter's opening comment is kept for its starting position.
// - Chapters that start from a set-up position (a FEN) join the repertoire if earlier
//   chapters lead there; otherwise only their comments are kept.

import { makeFen } from "chessops/fen";
import { type Game, type Node as PgnNode, type PgnNodeData, parsePgn, startingPosition } from "chessops/pgn";
import { epdOf, playUci, sanToUci, START_FEN, turnOf } from "./chess";
import type { CourseContext } from "./context-packet";
import { cleanComment } from "./game-tree";
import { type RepMove, walk } from "./repertoire";
import type { Color } from "./types";

export interface CourseAnnotation {
  /** Position before the move. */
  epd: string;
  /** The move ("" = a comment about the position itself, e.g. a chapter's introduction). */
  uci: string;
  san: string;
  /** The author's words (before and after the move), with [%...] board markup removed. */
  comment: string;
  /** Annotation symbols, e.g. "!", "?!", "±". */
  nags: string;
  /** true = the move is in the repertoire (your move or a prepared reply); false = a side line. */
  main: boolean;
}

export interface CourseInfo {
  title: string;
  fileName: string;
  /** Unix seconds. */
  importedAt: number;
}

export interface CourseRead {
  title: string;
  color: Color;
  /** Where the colour came from: the file's Orientation header, or a guess. */
  colorFrom: "header" | "guess";
  moves: RepMove[];
  annotations: CourseAnnotation[];
  chapters: number;
  /** Chapters starting from a position the rest of the course doesn't reach. */
  skippedChapters: number;
  /** Moves for your side kept as notes (side lines). */
  sideLines: number;
  /** Annotations with a comment. */
  comments: number;
}

/** Standard annotation glyphs ($1 = "!", ...), the ones courses use. */
const NAGS: Record<number, string> = {
  1: "!",
  2: "?",
  3: "!!",
  4: "??",
  5: "!?",
  6: "?!",
  7: "□",
  10: "=",
  13: "∞",
  14: "⩲",
  15: "⩱",
  16: "±",
  17: "∓",
  18: "+−",
  19: "−+",
  22: "⨀",
  32: "⟳",
  36: "→",
  40: "↑",
  132: "⇆",
  146: "N",
};

const nagText = (nags: number[] | undefined) => (nags ?? []).map((n) => NAGS[n] ?? "").join("");

const commentOf = (data: PgnNodeData) => cleanComment([...(data.startingComments ?? []), ...(data.comments ?? [])].join(" "));

function startFen(game: Game<PgnNodeData>): string | null {
  const start = startingPosition(game.headers);
  return start.isOk ? makeFen(start.value.toSetup()) : null;
}

/** The side the course is for: the one with fewer alternatives at its own turns. */
export function guessColor(games: Game<PgnNodeData>[]): Color {
  const branching: Record<Color, number> = { white: 0, black: 0 };
  const visit = (node: PgnNode<PgnNodeData>, fen: string) => {
    if (node.children.length > 1) branching[turnOf(fen)]++;
    for (const child of node.children) {
      const uci = sanToUci(fen, child.data.san);
      const next = uci && playUci(fen, uci);
      if (next) visit(child, next.fen);
    }
  };
  for (const g of games) {
    const fen = startFen(g);
    if (fen) visit(g.moves, fen);
  }
  // The opponent's moves branch (the course covers several replies); yours mostly don't.
  return branching.black > branching.white ? "white" : branching.white > branching.black ? "black" : "white";
}

const withoutExtension = (name: string) => name.replace(/\.[^.]+$/, "");

/** Reads an annotated PGN (any number of chapters) as a repertoire for `color` (default: from the file). */
export function readCourse(pgn: string, fileName: string, color?: Color): CourseRead {
  const games = parsePgn(pgn).filter((g) => g.moves.children.length > 0 || (g.comments ?? []).length > 0);
  if (games.length === 0) throw new Error("noGames");

  const header = games.map((g) => g.headers.get("Orientation")?.toLowerCase()).find((o) => o === "white" || o === "black") as Color | undefined;
  const side: Color = color ?? header ?? guessColor(games);
  const first = games[0].headers;
  const event = first.get("Event");
  const title = first.get("StudyName") || (event && event !== "?" ? event : "") || withoutExtension(fileName);

  const moves: RepMove[] = [];
  const mineAt = new Map<string, string>(); // epd -> your move (uci)
  const replies = new Set<string>(); // "epd|uci"
  const notes = new Map<string, CourseAnnotation>(); // "epd|uci"
  let sideLines = 0;

  const note = (a: CourseAnnotation) => {
    const key = `${a.epd}|${a.uci}`;
    const old = notes.get(key);
    if (!old) notes.set(key, a);
    else {
      // The same move in two chapters: keep both comments (once each).
      const comment = old.comment && a.comment && !old.comment.includes(a.comment) ? `${old.comment} / ${a.comment}` : old.comment || a.comment;
      notes.set(key, { ...old, comment, nags: old.nags || a.nags, main: old.main || a.main });
    }
  };

  /** Walks a chapter. `inRep`: the position is part of the repertoire (else only notes are kept). */
  const visit = (node: PgnNode<PgnNodeData>, fen: string, inRep: boolean) => {
    for (const child of node.children) {
      const uci = sanToUci(fen, child.data.san);
      const played = uci ? playUci(fen, uci) : null;
      if (!played) continue; // an illegal move: skip this branch
      const epd = epdOf(fen);
      let childInRep = false;
      if (inRep) {
        if (turnOf(fen) === side) {
          const mine = mineAt.get(epd);
          if (!mine) {
            mineAt.set(epd, played.uci);
            moves.push({ epd, fen, uci: played.uci, san: played.san, mine: true, share: null, source: "course" });
            childInRep = true;
          } else if (mine === played.uci) {
            childInRep = true;
          } else {
            sideLines++;
          }
        } else {
          if (!replies.has(`${epd}|${played.uci}`)) {
            replies.add(`${epd}|${played.uci}`);
            moves.push({ epd, fen, uci: played.uci, san: played.san, mine: false, share: null, source: "course" });
          }
          childInRep = true;
        }
      }
      const comment = commentOf(child.data);
      const nags = nagText(child.data.nags);
      // Side lines are noted even without a comment, so the panel can mention them.
      if (comment || nags || !childInRep) note({ epd, uci: played.uci, san: played.san, comment, nags, main: childInRep });
      visit(child, played.fen, childInRep);
    }
  };

  const chapterIntro = (g: Game<PgnNodeData>, fen: string) => {
    const comment = cleanComment((g.comments ?? []).join(" "));
    if (comment) note({ epd: epdOf(fen), uci: "", san: "", comment, nags: "", main: true });
  };

  // Chapters from the starting position first, then those starting later, as long as
  // the course reaches their position.
  let waiting: { game: Game<PgnNodeData>; fen: string }[] = [];
  for (const g of games) {
    const fen = startFen(g);
    if (!fen) continue;
    if (epdOf(fen) === epdOf(START_FEN)) {
      chapterIntro(g, fen);
      visit(g.moves, fen, true);
    } else waiting.push({ game: g, fen });
  }
  for (let progress = true; progress && waiting.length; ) {
    progress = false;
    const reached = walk(moves);
    const still: typeof waiting = [];
    for (const w of waiting) {
      if (reached.has(epdOf(w.fen))) {
        chapterIntro(w.game, w.fen);
        visit(w.game.moves, w.fen, true);
        progress = true;
      } else still.push(w);
    }
    waiting = still;
  }
  for (const w of waiting) {
    chapterIntro(w.game, w.fen);
    visit(w.game.moves, w.fen, false);
  }

  const annotations = [...notes.values()];
  return {
    title,
    color: side,
    colorFrom: color ? "header" : header ? "header" : "guess",
    moves,
    annotations,
    chapters: games.length,
    skippedChapters: waiting.length,
    sideLines,
    comments: annotations.filter((a) => a.comment).length,
  };
}

// ---------- looking notes up ----------

/** Annotations by position (EPD), the course's own moves first. */
export type CourseIndex = Map<string, CourseAnnotation[]>;

export function indexAnnotations(list: CourseAnnotation[]): CourseIndex {
  const index: CourseIndex = new Map();
  for (const a of list) {
    const at = index.get(a.epd);
    if (at) at.push(a);
    else index.set(a.epd, [a]);
  }
  for (const at of index.values()) at.sort((a, b) => Number(b.main) - Number(a.main));
  return index;
}

/** The author's note on a move, if any. */
export function annotationOn(index: CourseIndex, fen: string, uci: string): CourseAnnotation | null {
  return index.get(epdOf(fen))?.find((a) => a.uci === uci) ?? null;
}

/** What the course says about a position: an introduction, and its moves from there. */
export function notesAt(index: CourseIndex, fen: string): { about: string | null; moves: CourseAnnotation[] } {
  const here = index.get(epdOf(fen)) ?? [];
  return { about: here.find((a) => a.uci === "")?.comment ?? null, moves: here.filter((a) => a.uci !== "") };
}

/** A loaded course: its title and its notes by position. */
export interface LoadedCourse {
  repertoireId: number;
  title: string;
  index: CourseIndex;
}

/**
 * What the courses say for Claude's packet: about the position `fen`, and (for a move
 * explanation) about the move `played` from `fenBefore`. The first course with anything
 * to say is used. Null when no course covers it.
 */
export function courseContextFor(courses: LoadedCourse[], fen: string, played?: { fenBefore: string; uci: string }): CourseContext | null {
  for (const c of courses) {
    const here = notesAt(c.index, fen);
    const onMove = played ? annotationOn(c.index, played.fenBefore, played.uci) : null;
    if (!here.about && here.moves.length === 0 && !onMove) continue;
    return {
      title: c.title,
      about: here.about,
      moves: here.moves.slice(0, 6).map((m) => ({ san: m.san, comment: m.comment, nags: m.nags, main: m.main })),
      played: onMove ? { san: onMove.san, comment: onMove.comment, nags: onMove.nags } : null,
    };
  }
  return null;
}

/** A short key for the notes, so answers built on them are cached apart from plain ones. */
export function courseKey(c: CourseContext): string {
  const text = JSON.stringify(c);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `course:${(h >>> 0).toString(16)}`;
}
