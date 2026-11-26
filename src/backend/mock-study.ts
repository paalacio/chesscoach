// Mock mode, Phase 4: repertoires, trainer cards, files and backups, kept in memory.
//
// - Repertoires: three are built at start (unless ?mock=empty) from well-known lines
//   in the openings the app's owner plays, using a made-up "book" explorer: a move
//   counts as book when it leads to a named opening in the bundled opening list.
// - Trainer: some cards are learned (a few of them due); "My mistakes" come from
//   reviewing the made-up mock games for real.
// - Files: saving downloads the file; opening shows the browser's file picker.

import { legalSans, playUci, sanToUci, START_FEN } from "../core/chess";
import { lookupOpening } from "../core/openings";
import type { CourseAnnotation, CourseInfo } from "../core/course";
import { buildRepertoire, type BuildOracle, type MoveStats } from "../core/repertoire-build";
import { type GameLine, type Repertoire, type RepertoireMeta, type RepMove, type RepNote, sanLineToUcis } from "../core/repertoire";
import { movesFromPgn, reviewGame, trainingCards, type GameAnalysis } from "../core/review";
import { answerCard, type StoredCard, type StoredReview } from "../core/srs";
import { repertoireCards, type MistakeInfo } from "../core/trainer";
import type { Color } from "../core/types";
import explorerFixture from "./fixtures/explorer.json";
import claudeFixtures from "./fixtures/claude.json";
import gamesFixture from "./fixtures/games.json";
import type { ExplorerResult, RepertoireData, RepertoireInfo, ReviewDay, SrsData } from "./types";
import { BackendError } from "./types";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const emptyMode = params.get("mock") === "empty";

/** A small deterministic hash, so made-up numbers are the same on every run. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Made-up explorer numbers from the opening list: every legal move that reaches a
 * named opening, with a game count that falls off with depth and varies per move.
 */
export function bookExplorer(fen: string): ExplorerResult {
  const depth = (Number(fen.split(" ")[5] ?? 1) - 1) * 2 + (fen.split(" ")[1] === "b" ? 1 : 0);
  const moves = legalSans(fen)
    .map((san) => {
      const uci = sanToUci(fen, san);
      const next = uci && playUci(fen, uci);
      const opening = next ? lookupOpening(next.fen) : null;
      if (!uci || !next || !opening) return null;
      // Main lines (short names) are played more than side lines.
      const weight = (hash(fen + uci) % 60) + 40 + Math.max(0, 60 - opening.name.length);
      const games = Math.round((weight * 2_000_000) / 4 ** Math.min(depth, 8) / 100) + 3;
      const w = 38 + (hash(uci + fen) % 14);
      const d = 6 + (hash(fen) % 6);
      return {
        uci: next.uci,
        san: next.san,
        averageRating: 1400,
        white: Math.round((games * w) / 100),
        draws: Math.round((games * d) / 100),
        black: games - Math.round((games * w) / 100) - Math.round((games * d) / 100),
        opening,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => b.white + b.draws + b.black - (a.white + a.draws + a.black))
    .slice(0, 12);
  const sum = (k: "white" | "draws" | "black") => moves.reduce((a, m) => a + m[k], 0);
  return { white: sum("white"), draws: sum("draws"), black: sum("black"), moves, opening: lookupOpening(fen) };
}

const statsOf = (r: ExplorerResult): MoveStats => ({
  total: r.white + r.draws + r.black,
  moves: r.moves.map((m) => ({ uci: m.uci, san: m.san, games: m.white + m.draws + m.black })),
});

/** Real recorded masters answers where we have them, else the made-up book numbers. */
const explorerFor = (fen: string) =>
  (explorerFixture as unknown as { masters: Record<string, ExplorerResult> }).masters[fen.split(" ").slice(0, 4).join(" ")] ?? bookExplorer(fen);

/** The builder's oracle in mock mode: recorded masters games (or the book) for both sides, no engine. */
const bookOracle: BuildOracle = {
  opponentMoves: async (fen) => statsOf(explorerFor(fen)),
  theoryMoves: async (fen) => statsOf(explorerFor(fen)),
  evaluate: async (_fen, candidates) => ({ best: candidates[0] ? { uci: candidates[0], win: 52 } : null, moves: {} }),
};

/** The owner's openings (Ruy Lopez and Queen's Gambit as White; Sicilian and King's Indian as Black). */
const STARTERS: { name: string; color: Color; lines: { slot: string; name: string; moves: string }[] }[] = [
  {
    name: "White · 1.e4",
    color: "white",
    lines: [
      { slot: "white_e4_e5", name: "Ruy Lopez: Closed", moves: "1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1" },
      { slot: "white_e4_c5", name: "Sicilian: Open", moves: "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3" },
      { slot: "white_e4_e6", name: "French: Tarrasch", moves: "1.e4 e6 2.d4 d5 3.Nd2" },
      { slot: "white_e4_c6", name: "Caro-Kann: Advance", moves: "1.e4 c6 2.d4 d5 3.e5" },
    ],
  },
  {
    name: "White · 1.d4",
    color: "white",
    lines: [
      { slot: "white_d4_d5", name: "Queen's Gambit Declined", moves: "1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5" },
      { slot: "white_d4_nf6", name: "Queen's Pawn: 2.c4", moves: "1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4" },
    ],
  },
  {
    name: "Black",
    color: "black",
    lines: [
      { slot: "black_e4", name: "Sicilian: Najdorf", moves: "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6" },
      { slot: "black_d4", name: "King's Indian", moves: "1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6" },
      { slot: "black_other", name: "King's Indian setup vs 1.c4", moves: "1.c4 Nf6 2.Nc3 g6" },
    ],
  },
];

interface StoredRep {
  info: RepertoireInfo;
  moves: RepMove[];
  notes: Map<string, RepNote>;
  course: CourseInfo | null;
  annotations: CourseAnnotation[];
}

export function mockStudy() {
  const reps = new Map<number, StoredRep>();
  const cards = new Map<string, StoredCard>();
  const reviews: StoredReview[] = [];
  let nextId = 1;

  const games = (gamesFixture as unknown as { games: { id: number; url: string; white: string; black: string; myColor: Color; myResult: string; endTime: number; pgn: string; analysis: GameAnalysis }[] }).games;

  // "My mistakes": review the mock games for real (they come with real engine analysis).
  const mistakes: MistakeInfo[] = [];
  for (const g of games) {
    try {
      const { startFen, moves } = movesFromPgn(g.pgn);
      for (const c of trainingCards(reviewGame(startFen, moves, g.analysis, g.myColor), g.myColor)) {
        mistakes.push({
          id: mistakes.length + 1,
          gameId: g.id,
          ply: c.ply,
          fen: c.fen,
          playedUci: c.playedUci,
          playedSan: c.playedSan,
          bestUci: c.bestUci,
          bestSan: c.bestSan,
          judgement: c.judgement,
          winBefore: c.winBefore,
          winAfter: c.winAfter,
          myColor: g.myColor,
          opponent: g.myColor === "white" ? g.black : g.white,
          url: g.url,
          endTime: g.endTime,
        });
      }
    } catch {
      // A game without usable analysis just has no cards.
    }
  }

  const create = (name: string, color: Color, meta: RepertoireMeta) => {
    const id = nextId++;
    const now = Math.floor(Date.now() / 1000);
    reps.set(id, { info: { id, name, color, meta, moveCount: 0, createdAt: now, updatedAt: now }, moves: [], notes: new Map(), course: null, annotations: [] });
    return id;
  };

  // Build the starter repertoires and learn some of their moves (a few are due).
  const ready = (async () => {
    if (emptyMode) return;
    for (const s of STARTERS) {
      const id = create(s.name, s.color, { lines: s.lines, builtAt: Date.now() });
      const rep: Repertoire = { id, name: s.name, color: s.color, moves: [], notes: {}, meta: {} };
      const seeds = s.lines.map((l) => sanLineToUcis(l.moves) ?? []);
      const built = await buildRepertoire(rep, seeds, bookOracle, { minShare: 10, minReach: 2, maxPlies: 12, maxPositions: 400 });
      const stored = reps.get(id) as StoredRep;
      stored.moves = built.moves;
      stored.info.moveCount = built.moves.length;
    }
    const black = [...reps.values()].find((r) => r.info.color === "black");
    if (!black) return;
    const blackRep: Repertoire = { id: black.info.id, name: "", color: "black", moves: black.moves, notes: {}, meta: {} };
    const day = 86_400_000;
    const learned = repertoireCards([blackRep], new Map()).slice(0, 14);
    for (const [i, c] of learned.entries()) {
      // Learned 1-6 days ago; the first ones are due again by now.
      const when = new Date(Date.now() - (i < 5 ? 6 : 1 + (i % 3)) * day);
      const r = await answerCard(null, { id: c.id, kind: "repertoire", answer: c.answer.uci }, true, when);
      cards.set(c.id, r.card);
      reviews.push(r.review);
    }
    // A streak: some reviews on each of the last three days.
    for (let d = 1; d <= 3; d++) {
      for (let k = 0; k < 4; k++) reviews.push({ cardId: learned[k]?.id ?? "x", rating: 3, reviewedAt: Math.floor((Date.now() - d * day) / 1000) + k, log: {} });
    }
    // A note and a "why" on the Najdorf's 5...a6, for the screenshots.
    const najdorf = playLine("1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3");
    if (najdorf) {
      const epd = najdorf.split(" ").slice(0, 4).join(" ");
      black.notes.set(epd, { epd, note: "Najdorf: a6 keeps Nb5 and Bb5 out and prepares ...e5 or ...b5.", why: null });
    }
  })();

  const getRep = (id: number) => {
    const r = reps.get(id);
    if (!r) throw new BackendError("notFound", "That repertoire doesn't exist any more.");
    return r;
  };
  const dataOf = (r: StoredRep): RepertoireData => ({
    info: { ...r.info, moveCount: r.moves.length },
    moves: r.moves,
    notes: [...r.notes.values()],
    course: r.course,
    annotations: r.annotations,
  });
  const localDay = (sec: number) => {
    const d = new Date(sec * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  return {
    async repertoireList(): Promise<RepertoireInfo[]> {
      await ready;
      return [...reps.values()].map((r) => dataOf(r).info);
    },
    async repertoireCreate(name: string, color: Color, meta: RepertoireMeta) {
      await ready;
      return create(name, color, meta);
    },
    async repertoireGet(id: number) {
      await ready;
      return dataOf(getRep(id));
    },
    async repertoireSaveMoves(id: number, moves: RepMove[]) {
      const r = getRep(id);
      r.moves = moves;
      r.info.updatedAt = Math.floor(Date.now() / 1000);
    },
    async repertoireUpdate(id: number, name: string | null, meta: RepertoireMeta | null) {
      const r = getRep(id);
      if (name != null) r.info.name = name;
      if (meta != null) r.info.meta = meta;
    },
    async courseSave(id: number, title: string, fileName: string, _pgn: string, annotations: CourseAnnotation[]) {
      const r = getRep(id);
      r.course = { title, fileName, importedAt: Math.floor(Date.now() / 1000) };
      r.annotations = annotations;
    },
    async repertoireDelete(id: number) {
      reps.delete(id);
      for (const k of [...cards.keys()]) if (k.startsWith(`rep:${id}:`)) cards.delete(k);
    },
    async repertoireSetNote(id: number, epd: string, note: string | null, why: string | null) {
      const r = getRep(id);
      const old = r.notes.get(epd) ?? { epd, note: "", why: null };
      r.notes.set(epd, { epd, note: note ?? old.note, why: why ?? old.why });
    },
    async srsList() {
      await ready;
      return [...cards.values()];
    },
    async srsRecord(card: StoredCard, review: StoredReview) {
      cards.set(card.id, card);
      reviews.push(review);
    },
    async srsReviewDays(): Promise<ReviewDay[]> {
      await ready;
      const counts = new Map<string, number>();
      const firsts = new Map<string, number>();
      for (const r of reviews) {
        counts.set(localDay(r.reviewedAt), (counts.get(localDay(r.reviewedAt)) ?? 0) + 1);
        firsts.set(r.cardId, Math.min(firsts.get(r.cardId) ?? Infinity, r.reviewedAt));
      }
      const newOn = (day: string) => [...firsts.values()].filter((t) => localDay(t) === day).length;
      return [...counts.entries()].sort().map(([day, count]) => ({ day, count, newCards: newOn(day) }));
    },
    async srsExport(): Promise<SrsData> {
      return { cards: [...cards.values()], reviews: [...reviews] };
    },
    async srsImport(data: SrsData) {
      let n = 0;
      for (const c of data.cards ?? []) {
        const old = cards.get(c.id);
        if (!old || old.updatedAt < c.updatedAt) {
          cards.set(c.id, c);
          n++;
        }
      }
      const fresh = (data.reviews ?? []).filter((r) => !reviews.some((x) => x.cardId === r.cardId && x.reviewedAt === r.reviewedAt && x.rating === r.rating));
      reviews.push(...fresh);
      return { cards: n, reviews: fresh.length };
    },
    async conceptCounts() {
      if (emptyMode) return [];
      // From the real recorded Claude review of the first mock game, plus made-up counts for the others.
      const review = (claudeFixtures as unknown as { gameReview?: { answer?: { lessons?: { concept?: string }[]; concepts?: string[] } } }).gameReview?.answer;
      const tags = new Map<string, number>();
      for (const l of review?.lessons ?? []) if (l.concept) tags.set(l.concept, (tags.get(l.concept) ?? 0) + 1);
      for (const c of review?.concepts ?? []) tags.set(c, (tags.get(c) ?? 0) + 1);
      for (const [t, n] of [["tactics", 3], ["development", 2], ["king-safety", 2], ["hanging-piece", 2], ["pawn-structure", 1]] as const) tags.set(t, (tags.get(t) ?? 0) + n);
      return [...tags.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
    },
    async mistakeCards() {
      return emptyMode ? [] : mistakes;
    },
    async recentGameMoves(limit = 50, maxPly = 40): Promise<GameLine[]> {
      if (emptyMode) return [];
      return games.slice(0, limit).map((g) => {
        const { moves } = movesFromPgn(g.pgn);
        return {
          gameId: g.id,
          url: g.url,
          myColor: g.myColor,
          opponent: g.myColor === "white" ? g.black : g.white,
          myResult: g.myResult,
          endTime: g.endTime,
          moves: moves.slice(0, maxPly).map((m, i) => ({ ply: i + 1, epd: m.fenBefore.split(" ").slice(0, 4).join(" "), uci: m.uci, san: m.san })),
        };
      });
    },

    async fileSaveText(defaultName: string, _filter: string, _ext: string, contents: string) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([contents], { type: "text/plain" }));
      a.download = defaultName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return defaultName;
    },
    fileOpenText(_filter: string, extensions: string[]) {
      return new Promise<{ name: string; contents: string } | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = extensions.map((e) => `.${e}`).join(",");
        input.style.display = "none";
        input.setAttribute("data-testid", "mock-file-input");
        input.onchange = async () => {
          const f = input.files?.[0];
          input.remove();
          resolve(f ? { name: f.name, contents: await f.text() } : null);
        };
        document.body.appendChild(input);
        input.click();
      });
    },
    async dbBackup() {
      return "Tung Tung Chessahur backup (mock).sqlite";
    },
    async dbRestore() {
      return null;
    },
  };
}

function playLine(line: string): string | null {
  let fen = START_FEN;
  for (const u of sanLineToUcis(line) ?? []) {
    const p = playUci(fen, u);
    if (!p) return null;
    fen = p.fen;
  }
  return fen;
}
