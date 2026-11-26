import { describe, expect, it } from "vitest";
import { epdOf, playUci, START_FEN } from "./chess";
import { buildPacket } from "./context-packet";
import { annotationOn, courseContextFor, courseKey, indexAnnotations, notesAt, readCourse } from "./course";
import { nodeAt, sanLineToUcis } from "./repertoire";

// Written for these tests (not from a real course).
const COURSE = `[Event "Sample course: the Italian (made up for tests)"]
[Orientation "white"]

{ The Italian Game: quick development and pressure on f7. }
1. e4 { Grab the centre. } e5 2. Nf3 Nc6 3. Bc4! { The bishop eyes f7. [%cal Gc4f7] }
  ( 3. Bb5 { A different course. } )
3... Bc5 ( 3... Nf6 { The Two Knights. } 4. d3 { A quiet answer. } )
4. c3 { Prepares d4. } Nf6 5. d4 $1 *

[Event "Chapter 2"]
[FEN "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"]

4. c3 d6 { Solid but passive. } 5. d4 *

[Event "Chapter 3"]
[FEN "rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w KQkq - 0 2"]

2. Nc3 { Not reached by the rest of this course. } *
`;

function fenAfter(line: string): string {
  let fen = START_FEN;
  for (const u of sanLineToUcis(line) ?? []) fen = (playUci(fen, u) as { fen: string }).fen;
  return fen;
}

describe("reading a course", () => {
  const read = readCourse(COURSE, "italian.pgn");
  const rep = { moves: read.moves };

  it("takes the side and title from the file", () => {
    expect(read.color).toBe("white");
    expect(read.colorFrom).toBe("header");
    expect(read.title).toBe("Sample course: the Italian (made up for tests)");
    expect(read.chapters).toBe(3);
  });

  it("builds the repertoire: your main-line moves and every reply the course covers", () => {
    expect(read.moves.filter((m) => m.mine).map((m) => m.san).sort()).toEqual(["Bc4", "Nf3", "c3", "d3", "d4", "d4", "e4"]);
    expect(nodeAt(rep, fenAfter("1.e4 e5 2.Nf3 Nc6 3.Bc4"))?.replies.map((m) => m.san).sort()).toEqual(["Bc5", "Nf6"]);
    // Chapter 2 starts from a position chapter 1 reaches, so it joins (…d6 is a new reply).
    expect(nodeAt(rep, fenAfter("1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3"))?.replies.map((m) => m.san).sort()).toEqual(["Nf6", "d6"]);
    expect(read.skippedChapters).toBe(1);
    expect(read.sideLines).toBe(1); // 3.Bb5
  });

  it("keeps the author's comments, symbols and side lines", () => {
    const index = indexAnnotations(read.annotations);
    const bc4 = annotationOn(index, fenAfter("1.e4 e5 2.Nf3 Nc6"), "f1c4");
    expect(bc4).toMatchObject({ comment: "The bishop eyes f7.", nags: "!", main: true }); // [%cal] markup removed
    expect(annotationOn(index, fenAfter("1.e4 e5 2.Nf3 Nc6"), "f1b5")).toMatchObject({ comment: "A different course.", main: false });
    expect(notesAt(index, START_FEN).about).toBe("The Italian Game: quick development and pressure on f7.");
    expect(annotationOn(index, fenAfter("1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6"), "d2d4")).toMatchObject({ nags: "!", comment: "" });
    // A chapter the course doesn't reach: its comment is kept, outside the repertoire.
    expect(annotationOn(index, fenAfter("1.c4 e5"), "b1c3")).toMatchObject({ main: false });
    expect(read.comments).toBe(9); // the intro + 8 move comments
  });

  it("guesses the side when the file doesn't say", () => {
    // Several White moves are covered; Black always answers the same way: a Black course.
    const black = readCourse("1. e4 c5 2. Nf3 ( 2. c3 d5 ) ( 2. Nc3 Nc6 ) d6 *\n\n1. d4 Nf6 *", "sicilian.pgn");
    expect(black.color).toBe("black");
    expect(black.colorFrom).toBe("guess");
    expect(black.title).toBe("sicilian");
    expect(() => readCourse("this is not a pgn", "x.pgn")).toThrow("noGames");
  });

  it("can be read for the other side", () => {
    const asBlack = readCourse(COURSE, "italian.pgn", "black");
    expect(asBlack.moves.filter((m) => m.mine).map((m) => m.san)).toContain("e5");
  });
});

describe("the author's notes for Claude", () => {
  const read = readCourse(COURSE, "italian.pgn");
  const courses = [{ repertoireId: 1, title: read.title, index: indexAnnotations(read.annotations) }];

  it("go into the packet, with the course's moves allowed", () => {
    const fen = fenAfter("1.e4 e5 2.Nf3 Nc6");
    const played = { fenBefore: fenAfter("1.e4 e5 2.Nf3"), uci: "b8c6" };
    const ctx = courseContextFor(courses, fen, played);
    expect(ctx?.moves.map((m) => m.san)).toEqual(["Bc4", "Bb5"]);
    const packet = buildPacket({ fen, lines: [], history: [{ fen, san: null }], course: ctx });
    expect(packet.text).toContain(`AUTHOR'S NOTES (from "Sample course: the Italian (made up for tests)"`);
    expect(packet.text).toContain('3.Bc4! (the course\'s line): "The bishop eyes f7."');
    expect(packet.text).toContain("3.Bb5 (a side line the course shows)");
    expect(packet.text).toContain('Repertoire: from the course "Sample course');
    expect(packet.allowed.anywhere.has("Bb5")).toBe(true);
  });

  it("include the comment on the move being explained, and change the cache key", () => {
    const fenBefore = fenAfter("1.e4 e5 2.Nf3 Nc6");
    const after = fenAfter("1.e4 e5 2.Nf3 Nc6 3.Bc4");
    const ctx = courseContextFor(courses, after, { fenBefore, uci: "f1c4" });
    expect(ctx?.played).toEqual({ san: "Bc4", comment: "The bishop eyes f7.", nags: "!" });
    const text = buildPacket({ fen: after, lines: [], history: [{ fen: after, san: null }], course: ctx }).text;
    expect(text).not.toContain("On the move played"); // only with a MoveContext
    expect(courseKey(ctx as NonNullable<typeof ctx>)).toMatch(/^course:[0-9a-f]+$/);
    expect(courseContextFor(courses, fenAfter("1.d4 d5"))).toBeNull();
    expect(epdOf(fenBefore)).toBe(read.annotations.find((a) => a.uci === "f1c4")?.epd);
  });
});
