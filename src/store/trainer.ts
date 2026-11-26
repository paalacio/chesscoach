// The trainer: runs a session in one of three modes and saves every answer.
//
// - Learn new lines: a line from the repertoire is shown move by move (with an
//   arrow on each new move), then you play it again from the start without help.
//   Only that second pass is graded.
// - Review due: cards that are due, each after the opponent's last move of the line
//   that leads to it; when the line goes on to another due card, it continues.
// - My mistakes: positions from your games where you made a mistake; any move about
//   as good as Stockfish's counts.
// The app plays the opponent's moves itself, choosing more often the replies that are
// played more. A wrong answer shows the right move and comes back a few cards later.

import { create } from "zustand";
import { backend, type ReviewDay, toBackendError } from "../backend";
import { epdOf, playUci, START_FEN, turnOf } from "../core/chess";
import { AS_GOOD_POINTS } from "../core/engine-lines";
import { nodeAt, pickReply, type Repertoire } from "../core/repertoire";
import { answerCard, countOn, localDay, streak, type StoredCard } from "../core/srs";
import {
  cardIsNew,
  countCards,
  dueCards,
  leadIn,
  type Lesson,
  type MistakeInfo,
  mistakeCards,
  nextLesson,
  repertoireCards,
  type TrainCard,
  type TrainerCounts,
} from "../core/trainer";
import { tNow } from "../i18n";
import { useAnalysis } from "./analysis";
import { useApp } from "./app";
import { useRepertoire } from "./repertoire";
import { askWhy, cachedWhy } from "./why";

export type TrainMode = "learn" | "review" | "mistakes";

export interface Session {
  mode: TrainMode;
  /** Position on the board. */
  fen: string;
  lastMove: string | null;
  /** auto: the app is playing moves; yourMove: waiting for you; right / wrong: after your answer. */
  status: "auto" | "yourMove" | "checking" | "right" | "wrong" | "lessonDone" | "done";
  orientation: "white" | "black";
  card: TrainCard | null;
  expected: { uci: string; san: string } | null;
  /** Show the arrow for the expected move. */
  hint: boolean;
  /** This answer counts for the schedule. */
  graded: boolean;
  wrong: string | null;
  /** A different move that's about as good (My mistakes). */
  alsoGood: string | null;
  reason: string | null;
  /** "lookup": checking for a saved answer (quick); "asking": Claude is answering. */
  reasonLoading: false | "lookup" | "asking";
  /** Moves shown so far (SAN), for the line above the board. */
  line: string[];
  lesson: Lesson | null;
  pass: "show" | "quiz";
  step: number;
  queue: TrainCard[];
  /** Answers this session will ask for (grows when a wrong card comes back). */
  total: number;
  answered: number;
  right: number;
  learned: number;
}

interface TrainerState {
  loaded: boolean;
  reps: Repertoire[];
  mistakes: MistakeInfo[];
  stored: Map<string, StoredCard>;
  days: ReviewDay[];
  counts: TrainerCounts;
  session: Session | null;
  /** "Keep learning" was clicked: ignore the new-moves-per-day limit until the app restarts. */
  ignoreLimit: boolean;

  load(): Promise<void>;
  start(mode: TrainMode): void;
  move(uci: string): void;
  next(): void;
  stop(): void;
  askReason(): Promise<void>;
  keepLearning(): void;
}

const MOVE_DELAY = 450;
const MISTAKES_PER_SESSION = 20;
/** A wrong card comes back after this many other cards. */
const REPEAT_AFTER = 3;

let token = 0; // changes when a session stops, so pending timers do nothing

function allCards(s: Pick<TrainerState, "reps" | "mistakes" | "stored">): TrainCard[] {
  return [...repertoireCards(s.reps, s.stored), ...mistakeCards(s.mistakes, s.stored)];
}

export function newLeftToday(s: Pick<TrainerState, "days" | "ignoreLimit">): number {
  if (s.ignoreLimit) return Infinity;
  const limit = useApp.getState().settings?.newCardsPerDay ?? 10;
  return Math.max(0, limit - (s.days.find((d) => d.day === localDay())?.newCards ?? 0));
}

export const todayCount = (days: ReviewDay[]) => countOn(days);
export const currentStreak = (days: ReviewDay[]) => streak(days);

export const useTrainer = create<TrainerState>((set, get) => {
  const now = () => Math.floor(Date.now() / 1000);
  const patch = (p: Partial<Session>) => set((s) => (s.session ? { session: { ...s.session, ...p } } : {}));
  const later = (ms: number, f: () => void) => {
    const t = token;
    setTimeout(() => t === token && get().session && f(), ms);
  };

  /** Saves an answer and updates the counts. */
  async function record(card: TrainCard, correct: boolean) {
    try {
      const r = await answerCard(card.stored, { id: card.id, kind: card.kind, answer: card.answer.uci }, correct);
      await backend.srsRecord(r.card, r.review);
      const stored = new Map(get().stored);
      const wasNew = cardIsNew(card);
      stored.set(card.id, r.card);
      const today = localDay();
      const days = [...get().days];
      const i = days.findIndex((d) => d.day === today);
      const day = i >= 0 ? days[i] : { day: today, count: 0, newCards: 0 };
      const updated = { ...day, count: day.count + 1, newCards: day.newCards + (wasNew ? 1 : 0) };
      if (i >= 0) days[i] = updated;
      else days.push(updated);
      set({ stored, days, counts: countCards(allCards({ ...get(), stored }), now()) });
    } catch (e) {
      console.error("Could not save the answer", toBackendError(e).message);
    }
  }

  /** A quick one-line reason, if one is already known (never asks Claude). */
  async function quickReason(card: TrainCard | null, fen: string, expected: { uci: string; san: string }) {
    const rep = card?.repertoireId != null ? get().reps.find((r) => r.id === card.repertoireId) : null;
    const note = rep?.notes[epdOf(fen)];
    if (note?.why || note?.note) return note.why || note.note;
    return (await cachedWhy(fen, expected.uci))?.summary ?? null;
  }

  /** Plays an opponent move on the board (after a short pause). */
  function autoMove(uci: string, then: () => void) {
    const s = get().session;
    if (!s) return;
    const played = playUci(s.fen, uci);
    if (!played) return then();
    patch({ status: "auto" });
    later(MOVE_DELAY, () => {
      const cur = get().session as Session;
      patch({ fen: played.fen, lastMove: played.uci, line: [...cur.line, played.san] });
      then();
    });
  }

  /** Waits for your move. */
  function askFor(card: TrainCard | null, expected: { uci: string; san: string }, hint: boolean, graded: boolean) {
    patch({ status: "yourMove", card, expected, hint, graded, wrong: null, alsoGood: null, reason: null, reasonLoading: false });
  }

  // ---------- learn ----------

  function lessonStep() {
    const s = get().session as Session;
    const lesson = s.lesson as Lesson;
    if (s.step >= lesson.steps.length) {
      if (s.pass === "show") {
        patch({ pass: "quiz", step: 0, fen: START_FEN, lastMove: null, line: [] });
        later(MOVE_DELAY * 2, lessonStep);
      } else {
        patch({ status: "lessonDone" });
      }
      return;
    }
    const st = lesson.steps[s.step];
    if (!st.mine) {
      autoMove(st.uci, () => {
        patch({ step: (get().session as Session).step + 1 });
        lessonStep();
      });
      return;
    }
    const card = st.cardId ? (allCards(get()).find((c) => c.id === st.cardId) ?? null) : null;
    askFor(card, { uci: st.uci, san: st.san }, s.pass === "show" && st.isNew, s.pass === "quiz" && st.isNew);
  }

  function startLesson(): boolean {
    const s = get();
    const left = newLeftToday(s);
    const cards = new Map(allCards(s).map((c) => [c.id, c]));
    // The lesson from the repertoire whose next new line is most likely to come up.
    let best: Lesson | null = null;
    for (const rep of s.reps) {
      const l = nextLesson(rep, cards, Math.min(left, 6));
      if (l && (!best || l.steps.length < best.steps.length)) best = l;
    }
    if (!best) return false;
    patch({ lesson: best, pass: "show", step: 0, fen: START_FEN, lastMove: null, line: [], orientation: best.color });
    later(MOVE_DELAY, lessonStep);
    return true;
  }

  // ---------- review and mistakes ----------

  function nextCard() {
    const s = get().session as Session;
    const [card, ...rest] = s.queue;
    if (!card) {
      patch({ status: "done", card: null, expected: null });
      return;
    }
    patch({ queue: rest, card, orientation: card.color, wrong: null, alsoGood: null, reason: null });
    if (card.kind === "mistake" || card.repertoireId == null) {
      patch({ fen: card.fen, lastMove: null, line: [] });
      askFor(card, card.answer, false, true);
      return;
    }
    // Show the line that leads to the card; the opponent's last move is played on the board.
    const rep = get().reps.find((r) => r.id === card.repertoireId);
    const steps = rep ? leadIn(rep, epdOf(card.fen)) : [];
    const last = steps[steps.length - 1];
    if (last && !last.mine) {
      patch({ fen: last.fen, lastMove: steps.length > 1 ? steps[steps.length - 2].uci : null, line: steps.slice(0, -1).map((x) => x.san) });
      autoMove(last.uci, () => askFor(card, card.answer, false, true));
    } else {
      patch({ fen: card.fen, lastMove: last?.uci ?? null, line: steps.map((x) => x.san) });
      askFor(card, card.answer, false, true);
    }
  }

  /** After a right answer to a repertoire card: go on along the line if the next card is due too. */
  function continueLine(): boolean {
    const s = get().session as Session;
    const rep = s.card?.repertoireId != null ? get().reps.find((r) => r.id === s.card?.repertoireId) : null;
    const node = rep && nodeAt(rep, s.fen);
    if (!rep || !node) return false;
    const reply = pickReply(node, Math.random());
    const after = reply && playUci(s.fen, reply.uci);
    if (!reply || !after) return false;
    const i = s.queue.findIndex((c) => c.repertoireId === rep.id && epdOf(c.fen) === epdOf(after.fen));
    if (i < 0) return false;
    const card = s.queue[i];
    patch({ queue: s.queue.filter((_, k) => k !== i), card });
    autoMove(reply.uci, () => askFor(card, card.answer, false, true));
    return true;
  }

  function afterRight() {
    const s = get().session as Session;
    if (s.mode === "learn") {
      later(MOVE_DELAY, () => {
        patch({ step: (get().session as Session).step + 1 });
        lessonStep();
      });
    } else if (s.mode === "review" && s.card?.kind === "repertoire") {
      later(MOVE_DELAY, () => continueLine() || nextCard());
    }
    // My mistakes (and mistake cards in a review) wait for "Continue", so you can read.
  }

  return {
    loaded: false,
    reps: [],
    mistakes: [],
    stored: new Map(),
    days: [],
    counts: { newMoves: 0, due: 0, mistakes: 0 },
    session: null,
    ignoreLimit: false,

    async load() {
      try {
        if (!useRepertoire.getState().ready) await useRepertoire.getState().init();
        const reps = Object.values(useRepertoire.getState().reps);
        const [cards, mistakes, days] = await Promise.all([backend.srsList(), backend.mistakeCards(), backend.srsReviewDays()]);
        const stored = new Map(cards.map((c) => [c.id, c]));
        set({ reps, mistakes, stored, days, loaded: true, counts: countCards(allCards({ reps, mistakes, stored }), now()) });
      } catch (e) {
        console.error("Could not load the trainer", toBackendError(e).message);
        set({ loaded: true });
      }
    },

    start(mode) {
      token++;
      const s = get();
      const base: Session = {
        mode,
        fen: START_FEN,
        lastMove: null,
        status: "auto",
        orientation: "white",
        card: null,
        expected: null,
        hint: false,
        graded: false,
        wrong: null,
        alsoGood: null,
        reason: null,
        reasonLoading: false,
        line: [],
        lesson: null,
        pass: "show",
        step: 0,
        queue: [],
        total: 0,
        answered: 0,
        right: 0,
        learned: 0,
      };
      if (mode === "learn") {
        set({ session: base });
        if (!startLesson()) patch({ status: "done" });
        return;
      }
      const cards = allCards(s);
      const queue =
        mode === "review"
          ? dueCards(cards, now())
          : [
              ...dueCards(cards.filter((c) => c.kind === "mistake"), now()),
              ...cards.filter((c) => c.kind === "mistake" && cardIsNew(c)),
            ].slice(0, MISTAKES_PER_SESSION);
      set({ session: { ...base, queue, total: queue.length } });
      nextCard();
    },

    move(uci) {
      const s = get().session;
      if (!s || (s.status !== "yourMove" && s.status !== "wrong") || !s.expected) return;
      const played = playUci(s.fen, uci);
      if (!played) return;
      const expected = s.expected;
      const correct = played.uci === expected.uci;

      const right = (alsoGood: string | null) => {
        const cur = get().session as Session;
        const firstTry = cur.status !== "wrong";
        if (cur.graded && firstTry && cur.card) void record(cur.card, true);
        patch({
          status: "right",
          fen: played.fen,
          lastMove: played.uci,
          line: [...cur.line, played.san],
          alsoGood,
          answered: cur.answered + (firstTry ? 1 : 0),
          right: cur.right + (firstTry ? 1 : 0),
          learned: cur.learned + (cur.graded && firstTry && cur.card && cardIsNew(cur.card) ? 1 : 0),
          hint: false,
        });
        afterRight();
      };

      const wrong = () => {
        const cur = get().session as Session;
        if (cur.status !== "wrong") {
          if (cur.graded && cur.card) void record(cur.card, false);
          // Repeat it soon (review and mistakes); in a lesson the quiz pass comes back anyway.
          const queue = [...cur.queue];
          const again = !!cur.card && cur.mode !== "learn";
          if (again && cur.card) queue.splice(Math.min(REPEAT_AFTER, queue.length), 0, cur.card);
          patch({ queue, answered: cur.answered + 1, total: cur.total + (again ? 1 : 0) });
        }
        patch({ status: "wrong", wrong: played.uci, hint: true, reason: null, reasonLoading: "lookup" });
        void quickReason(cur.card, cur.fen, expected).then((reason) => patch({ reason, reasonLoading: false }));
      };

      if (correct) return right(null);
      // My mistakes: a move about as good as Stockfish's counts too.
      if (s.card?.kind === "mistake" && s.status === "yourMove" && useAnalysis.getState().engineOn) {
        patch({ status: "checking" });
        void useAnalysis
          .getState()
          .evaluateMoves(s.fen, [expected.uci, played.uci], 16)
          .then((evals) => {
            const forMover = (w: number) => (turnOf(s.fen) === "white" ? w : 100 - w);
            const a = evals[expected.uci];
            const b = evals[played.uci];
            if (a && b && forMover(b.winWhite) >= forMover(a.winWhite) - AS_GOOD_POINTS) right(played.san);
            else wrong();
          });
        return;
      }
      wrong();
    },

    next() {
      const s = get().session;
      if (!s) return;
      if (s.status === "lessonDone") {
        if (!startLesson()) patch({ status: "done" });
        return;
      }
      if (s.mode === "learn") return;
      nextCard();
    },

    stop() {
      token++;
      set({ session: null });
      void get().load();
    },

    async askReason() {
      const s = get().session;
      if (!s?.expected || s.reasonLoading) return;
      const fen = s.status === "right" && s.card ? s.card.fen : s.fen;
      const expected = s.status === "right" && s.card ? s.card.answer : s.expected;
      patch({ reasonLoading: "asking" });
      try {
        const answer = await askWhy(fen, expected.uci);
        patch({ reason: answer.summary, reasonLoading: false });
        if (s.card?.repertoireId != null) {
          await backend.repertoireSetNote(s.card.repertoireId, epdOf(fen), null, answer.summary).catch(() => {});
        }
      } catch (e) {
        patch({ reason: toBackendError(e).message, reasonLoading: false });
      }
    },

    keepLearning() {
      set({ ignoreLimit: true });
      get().start("learn");
    },
  };
});

/** The text for a finished session (exported for the UI). */
export function sessionSummary(s: Session): string {
  return tNow("train.summary", { right: s.right, count: s.answered });
}
