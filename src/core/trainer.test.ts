import { describe, expect, it } from "vitest";
import { epdOf, playUci, START_FEN } from "./chess";
import { buildProposalPrompt, checkLine, checkProposal, slotById, slotsFor } from "./repertoire-proposal";
import { addLine, addReply, type Repertoire, sanLineToUcis } from "./repertoire";
import { answerCard, createScheduler, isNew, reviveDates, type StoredCard, streak } from "./srs";
import { countCards, dueCards, leadIn, nextLesson, repCardId, repertoireCards, type TrainCard } from "./trainer";

function fenAfter(line: string): string {
  let fen = START_FEN;
  for (const u of sanLineToUcis(line) ?? []) fen = (playUci(fen, u) as { fen: string }).fen;
  return fen;
}

describe("Claude's repertoire proposal", () => {
  const blackE4 = slotById("black_e4") as NonNullable<ReturnType<typeof slotById>>;
  const whiteE5 = slotById("white_e4_e5") as NonNullable<ReturnType<typeof slotById>>;
  const blackOther = slotById("black_other") as NonNullable<ReturnType<typeof slotById>>;

  it("checks every line: legal, in the slot, ending with the player's move", () => {
    expect(checkLine(blackE4, "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6")?.sans.at(-1)).toBe("a6");
    // A trailing opponent move is dropped.
    expect(checkLine(whiteE5, "1.e4 e5 2.Nf3 Nc6 3.Bb5 a6")?.sans).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    expect(checkLine(blackE4, "1.d4 d5")).toBeNull(); // wrong slot
    expect(checkLine(blackE4, "1.e4 c5 2.Nf3 h6")).not.toBeNull(); // odd but legal
    expect(checkLine(blackE4, "1.e4 c5 2.Nf3 Qxh2")).toBeNull(); // illegal
    expect(checkLine(blackOther, "1.c4 e5 2.Nc3 Nf6")).not.toBeNull();
    expect(checkLine(blackOther, "1.e4 e5")).toBeNull();
    expect(checkLine(whiteE5, "1.e4 e5")).toBeNull(); // no move of White's after the slot's moves
  });

  it("keeps good options, drops bad ones, and counts them", () => {
    const p = checkProposal(
      {
        summary: "Sharp Sicilian.",
        slots: [
          {
            slot: "black_e4",
            options: [
              { name: "Najdorf", moves: "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6", style: "sharp", theory: "high", pros: ["a"], cons: ["b"], plans: ["c"], why_for_you: "d" },
              { name: "Broken", moves: "1.e4 c5 2.Nf3 Qxh2", style: "x", theory: "y", pros: [], cons: [], plans: [], why_for_you: "" },
              { name: "Dragon", moves: "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 g6", style: "weird", theory: "high", pros: [], cons: [], plans: [], why_for_you: "" },
            ],
          },
        ],
      },
      [blackE4],
    );
    expect(p.dropped).toBe(1);
    expect(p.slots[0].options.map((o) => o.name)).toEqual(["Najdorf", "Dragon"]);
    expect(p.slots[0].options[1].style).toBe("balanced"); // unknown style → balanced
    expect(p.slots[0].options[0].moves).toBe("1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6");
  });

  it("builds the prompt from the answers, games and slots", () => {
    const prompt = buildProposalPrompt(
      "white",
      slotsFor("white", ["e4", "d4"]),
      { style: "balanced", theory: "some", attacking: "attack", openings: "Ruy Lopez, Queen's Gambit" },
      [{ label: "As White, your first move", games: 40, score: 52.5, top: ["1.e4 (30)", "1.d4 (10)"] }],
      "pt",
    );
    expect(prompt).toContain("Openings they play or want to keep: Ruy Lopez, Queen's Gambit");
    expect(prompt).toContain("- white_e4_e5: White after 1.e4 e5. Lines start with: 1.e4 e5");
    expect(prompt).toContain("- white_d4_nf6:");
    expect(prompt).toContain("40 games, scored 53%");
    expect(prompt).toContain("Brazilian Portuguese");
  });
});

describe("spaced repetition", () => {
  const base = { id: "rep:1:x", kind: "repertoire" as const, answer: "e2e4" };
  const now = new Date("2026-11-26T10:00:00Z");

  it("a right answer schedules days ahead, a wrong one minutes ahead", async () => {
    const s = await createScheduler(false);
    const good = await answerCard(null, base, true, now, s);
    expect(good.card.due - now.getTime() / 1000).toBeGreaterThan(86_400);
    expect(good.review).toMatchObject({ cardId: "rep:1:x", rating: 3 });
    const bad = await answerCard(null, base, false, now, s);
    expect(bad.card.due - now.getTime() / 1000).toBeLessThan(3600);
  });

  it("keeps working after a trip through JSON, and restarts when the answer changes", async () => {
    const s = await createScheduler(false);
    const first = await answerCard(null, base, true, now, s);
    const stored: StoredCard = JSON.parse(JSON.stringify(first.card));
    const later = new Date(stored.due * 1000);
    const second = await answerCard(stored, base, true, later, s);
    expect(second.card.due - stored.due).toBeGreaterThan(first.card.due - now.getTime() / 1000); // the gap grows
    expect(reviveDates<{ dueAt: Date }>(stored.card).dueAt).toBeInstanceOf(Date);

    expect(isNew(stored, "d2d4")).toBe(true);
    const restarted = await answerCard(stored, { ...base, answer: "d2d4" }, true, later, s);
    expect((restarted.card.card as { reps: number }).reps).toBe(1);
  });

  it("counts the streak, forgiving a day not trained yet", () => {
    const days = [
      { day: "2026-11-23", count: 5 },
      { day: "2026-11-24", count: 3 },
      { day: "2026-11-25", count: 1 },
    ];
    expect(streak(days, "2026-11-25")).toBe(3);
    expect(streak(days, "2026-11-26")).toBe(3); // today not trained yet
    expect(streak(days, "2026-11-27")).toBe(0);
    expect(streak([...days, { day: "2026-11-26", count: 2 }], "2026-11-26")).toBe(4);
  });
});

describe("trainer cards and lessons", () => {
  let rep: Repertoire = { id: 7, name: "Black", color: "black", moves: [], notes: {}, meta: {} };
  for (const line of ["1.e4 c5 2.Nf3 d6 3.d4 cxd4", "1.e4 c5 2.c3 Nf6", "1.d4 Nf6 2.c4 g6"]) {
    rep = { ...rep, moves: addLine(rep, START_FEN, sanLineToUcis(line) ?? [], "user").moves };
  }
  rep = { ...rep, moves: addReply(rep, START_FEN, "e2e4", 55) };
  rep = { ...rep, moves: addReply(rep, START_FEN, "d2d4", 30) };
  rep = { ...rep, moves: addReply(rep, fenAfter("1.e4 c5"), "g1f3", 70) };
  rep = { ...rep, moves: addReply(rep, fenAfter("1.e4 c5"), "c2c3", 10) };
  rep = { ...rep, moves: addReply(rep, fenAfter("1.e4 c5 2.Nf3 d6"), "d2d4", 90) };

  it("makes a card for every position with your move", () => {
    const cards = repertoireCards([rep], new Map());
    expect(cards.map((c) => c.answer.san).sort()).toEqual(["Nf6", "Nf6", "c5", "cxd4", "d6", "g6"]);
    expect(countCards(cards, 0)).toEqual({ newMoves: 6, due: 0, mistakes: 0 });
  });

  it("teaches the most common line first, up to the new-move limit", () => {
    const cards = new Map(repertoireCards([rep], new Map()).map((c) => [c.id, c]));
    const lesson = nextLesson(rep, cards, 2);
    expect(lesson?.steps.map((s) => s.san)).toEqual(["e4", "c5", "Nf3", "d6"]);
    expect(lesson?.steps.filter((s) => s.isNew).map((s) => s.san)).toEqual(["c5", "d6"]);
  });

  it("skips what you know, and lists due cards most overdue first", () => {
    const stored = (id: string, due: number): [string, StoredCard] => [id, { id, kind: "repertoire", answer: "", card: {}, due, updatedAt: 0 }];
    const c5 = repCardId(7, epdOf(fenAfter("1.e4")));
    const d6 = repCardId(7, epdOf(fenAfter("1.e4 c5 2.Nf3")));
    const known = new Map([stored(c5, 50), stored(d6, 10)]);
    // Stored answers must match the repertoire's move, else the card counts as new.
    for (const c of repertoireCards([rep], new Map())) {
      const s = known.get(c.id);
      if (s) s.answer = c.answer.uci;
    }
    const cards: TrainCard[] = repertoireCards([rep], known);
    expect(dueCards(cards, 100).map((c) => c.answer.san)).toEqual(["d6", "c5"]);
    const lesson = nextLesson(rep, new Map(cards.map((c) => [c.id, c])), 5);
    expect(lesson?.steps.filter((s) => s.isNew).map((s) => s.san)).toEqual(["cxd4"]);
    expect(leadIn(rep, epdOf(fenAfter("1.e4 c5 2.Nf3"))).map((s) => s.san)).toEqual(["e4", "c5", "Nf3"]);
  });
});

describe("training file", async () => {
  const { parseTrainingFile, trainingFile } = await import("./srs");
  it("round-trips and skips broken entries", () => {
    const card: StoredCard = { id: "rep:1:x", kind: "repertoire", answer: "e2e4", card: { state: 2 }, due: 10, updatedAt: 5 };
    const file = trainingFile([card], [{ cardId: "rep:1:x", rating: 3, reviewedAt: 5, log: {} }], new Date("2026-11-26T00:00:00Z"));
    const text = JSON.stringify({ ...file, cards: [...file.cards, { id: 3 }] });
    const back = parseTrainingFile(text);
    expect(back.cards).toEqual([card]);
    expect(back.reviews).toHaveLength(1);
    expect(back.skipped).toBe(1);
  });
  it("refuses other files", () => {
    expect(() => parseTrainingFile("not json")).toThrow("notTrainingFile");
    expect(() => parseTrainingFile(JSON.stringify({ format: "other" }))).toThrow("notTrainingFile");
    expect(() => parseTrainingFile(JSON.stringify({ format: "chesscoach-training", version: 2, cards: [], reviews: [] }))).toThrow("newerTrainingFile");
  });
});

describe("real recorded proposals", async () => {
  const fx = (await import("../backend/fixtures/claude.json")).default as Record<string, unknown>;
  it("pass the move checks (no option dropped)", () => {
    for (const [key, color] of [
      ["repertoireProposalWhite", "white"],
      ["repertoireProposalWhitePt", "white"],
      ["repertoireProposalBlack", "black"],
      ["repertoireProposalBlackPt", "black"],
    ] as const) {
      const p = checkProposal(fx[key], slotsFor(color, ["e4", "d4"]));
      expect(p.dropped, key).toBe(0);
      for (const s of p.slots) expect(s.options.length, `${key} ${s.slot.id}`).toBeGreaterThanOrEqual(2);
    }
  });
});
