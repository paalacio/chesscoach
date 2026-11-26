// Spaced repetition with FSRS (the ts-fsrs library, FSRS-7 model).
//
// A card is a position where it's your move. Answering right schedules it further
// away each time (days, then weeks, then months); a wrong answer brings it back
// within minutes. Cards are stored as JSON (see src-tauri/src/study.rs), so the
// dates inside them have to be turned back into Date objects when loaded.

import { DefaultScheduler, Rating } from "ts-fsrs";

export type CardKind = "repertoire" | "mistake";

/** A card as stored in the database. */
export interface StoredCard {
  /** "rep:<repertoire id>:<epd>" or "mistake:<training card id>". */
  id: string;
  kind: CardKind;
  /** The move (UCI) the card was learned with. */
  answer: string;
  /** The ts-fsrs card, as JSON. */
  card: unknown;
  /** Unix seconds. */
  due: number;
  updatedAt: number;
}

export interface StoredReview {
  cardId: string;
  /** 1 = again, 3 = good (we only use these two). */
  rating: number;
  /** Unix seconds. */
  reviewedAt: number;
  log: unknown;
}

// We pin the model version (FSRS-7), so stored cards always have the same shape.
type Scheduler = Awaited<ReturnType<typeof DefaultScheduler<"FSRS-7">>>;
/** The card type the scheduler works with (taken from its own `review`). */
type FsrsCard = Parameters<Scheduler["review"]>[0]["card"];
let shared: Promise<Scheduler> | null = null;

/**
 * The scheduler: learning steps of 1 and 10 minutes for new and forgotten cards,
 * and some randomness ("fuzz") so cards learned together don't all come back on
 * the same day. FSRS-7 may skip the learning steps when it's confident.
 */
export function createScheduler(fuzz = true): Promise<Scheduler> {
  return DefaultScheduler<"FSRS-7">({ version: "FSRS-7", learningSteps: ["1m", "10m"], relearningSteps: ["10m"], enableFuzz: fuzz });
}

function scheduler(): Promise<Scheduler> {
  shared ??= createScheduler();
  return shared;
}

const DATE_FIELDS = ["dueAt", "lastReviewAt", "reviewTime"];

/** JSON keeps dates as text; ts-fsrs wants Date objects back. */
export function reviveDates<T>(json: unknown): T {
  const o = { ...(json as Record<string, unknown>) };
  for (const k of DATE_FIELDS) {
    if (typeof o[k] === "string" || typeof o[k] === "number") o[k] = new Date(o[k] as string);
  }
  return o as T;
}

const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/** A card is new when it was never reviewed, or when its answer has changed since. */
export const isNew = (stored: StoredCard | null | undefined, answer: string) => !stored || stored.answer !== answer;

export const isDue = (stored: StoredCard | null | undefined, nowSec: number) => !!stored && stored.due <= nowSec;

/**
 * Records an answer. `correct` → "Good", wrong → "Again". Returns the card and the
 * review to store. A card whose answer changed starts over as a new card.
 */
export async function answerCard(
  stored: StoredCard | null,
  base: { id: string; kind: CardKind; answer: string },
  correct: boolean,
  now: Date = new Date(),
  sched?: Scheduler,
): Promise<{ card: StoredCard; review: StoredReview }> {
  const s = sched ?? (await scheduler());
  const card: FsrsCard = stored && !isNew(stored, base.answer) ? reviveDates<FsrsCard>(stored.card) : s.newCard({ now });
  const grade = correct ? Rating.Good : Rating.Again;
  const result = s.review({ card, grade, now });
  return {
    card: { ...base, card: toJson(result.card), due: seconds(result.card.dueAt), updatedAt: seconds(now) },
    review: { cardId: base.id, rating: grade, reviewedAt: seconds(now), log: toJson(result.revlog) },
  };
}

/** How many days until a card is due again (fractions for minutes/hours). */
export function daysUntil(stored: StoredCard, nowSec: number): number {
  return (stored.due - nowSec) / 86_400;
}

// ---------- daily goal and streak ----------

/** "2026-11-26" in local time. */
export function localDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d - 1));
}

/**
 * Days in a row with at least one review, ending today (or yesterday, if you
 * haven't trained yet today: the streak isn't lost until the day is over).
 */
export function streak(days: { day: string; count: number }[], today: string = localDay()): number {
  const trained = new Set(days.filter((d) => d.count > 0).map((d) => d.day));
  let day = trained.has(today) ? today : dayBefore(today);
  let n = 0;
  while (trained.has(day)) {
    n++;
    day = dayBefore(day);
  }
  return n;
}

export function countOn(days: { day: string; count: number }[], day: string = localDay()): number {
  return days.find((d) => d.day === day)?.count ?? 0;
}

// ---------- the training export file ----------

/** Identifies a ChessCoach training file (see docs/data-formats.md). */
export const TRAINING_FORMAT = "chesscoach-training";

export interface TrainingFile {
  format: typeof TRAINING_FORMAT;
  version: 1;
  /** ISO date-time. */
  exportedAt: string;
  cards: StoredCard[];
  reviews: StoredReview[];
}

export function trainingFile(cards: StoredCard[], reviews: StoredReview[], now: Date = new Date()): TrainingFile {
  return { format: TRAINING_FORMAT, version: 1, exportedAt: now.toISOString(), cards, reviews };
}

const isCard = (c: unknown): c is StoredCard => {
  const o = c as StoredCard;
  return !!o && typeof o.id === "string" && (o.kind === "repertoire" || o.kind === "mistake") && typeof o.answer === "string" && typeof o.due === "number" && typeof o.updatedAt === "number" && typeof o.card === "object";
};
const isReview = (r: unknown): r is StoredReview => {
  const o = r as StoredReview;
  return !!o && typeof o.cardId === "string" && typeof o.rating === "number" && typeof o.reviewedAt === "number";
};

/** Reads a training file; throws if it isn't one. Broken entries are skipped. */
export function parseTrainingFile(text: string): { cards: StoredCard[]; reviews: StoredReview[]; skipped: number } {
  let o: Partial<TrainingFile>;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error("notTrainingFile");
  }
  if (o?.format !== TRAINING_FORMAT || !Array.isArray(o.cards) || !Array.isArray(o.reviews)) throw new Error("notTrainingFile");
  if (typeof o.version !== "number" || o.version > 1) throw new Error("newerTrainingFile");
  const cards = o.cards.filter(isCard);
  const reviews = o.reviews.filter(isReview).map((r) => ({ ...r, log: r.log ?? {} }));
  return { cards, reviews, skipped: o.cards.length - cards.length + (o.reviews.length - reviews.length) };
}
