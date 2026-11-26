// The trainer's cards and lessons, built from the repertoires and from the
// mistakes found in game reviews. Pure functions: the store (src/store/trainer.ts)
// runs the sessions and saves the answers.

import { epdOf, playUci } from "./chess";
import { nodesOf, pathTo, type Repertoire, type RepMove, type RepNode } from "./repertoire";
import { type CardKind, isDue, isNew, type StoredCard } from "./srs";
import type { Color } from "./types";

/** A mistake from a reviewed game (see `MistakeCard` in src-tauri/src/study.rs). */
export interface MistakeInfo {
  id: number;
  gameId: number;
  ply: number;
  fen: string;
  playedUci: string;
  playedSan: string;
  bestUci: string;
  bestSan: string;
  judgement: string;
  winBefore: number;
  winAfter: number;
  myColor: Color;
  opponent: string;
  url: string;
  endTime: number | null;
}

export interface TrainCard {
  id: string;
  kind: CardKind;
  /** The position: it's your move. */
  fen: string;
  color: Color;
  /** The move to find. */
  answer: { uci: string; san: string };
  repertoireId: number | null;
  mistake: MistakeInfo | null;
  stored: StoredCard | null;
}

export const repCardId = (repertoireId: number, epd: string) => `rep:${repertoireId}:${epd}`;
export const mistakeCardId = (id: number) => `mistake:${id}`;

/** One card per position where a repertoire has your move. */
export function repertoireCards(reps: Repertoire[], stored: Map<string, StoredCard>): TrainCard[] {
  const out: TrainCard[] = [];
  for (const rep of reps) {
    for (const node of nodesOf(rep).values()) {
      if (!node.mine) continue;
      const id = repCardId(rep.id, node.epd);
      out.push({
        id,
        kind: "repertoire",
        fen: node.fen,
        color: rep.color,
        answer: { uci: node.mine.uci, san: node.mine.san },
        repertoireId: rep.id,
        mistake: null,
        stored: stored.get(id) ?? null,
      });
    }
  }
  return out;
}

export function mistakeCards(list: MistakeInfo[], stored: Map<string, StoredCard>): TrainCard[] {
  return list.map((m) => {
    const id = mistakeCardId(m.id);
    return {
      id,
      kind: "mistake" as const,
      fen: m.fen,
      color: m.myColor,
      answer: { uci: m.bestUci, san: m.bestSan },
      repertoireId: null,
      mistake: m,
      stored: stored.get(id) ?? null,
    };
  });
}

export const cardIsNew = (c: TrainCard) => isNew(c.stored, c.answer.uci);

/** Cards due now (not new ones), the most overdue first. */
export function dueCards(cards: TrainCard[], nowSec: number): TrainCard[] {
  return cards.filter((c) => !cardIsNew(c) && isDue(c.stored, nowSec)).sort((a, b) => (a.stored?.due ?? 0) - (b.stored?.due ?? 0));
}

export interface TrainerCounts {
  /** New repertoire moves not learned yet. */
  newMoves: number;
  due: number;
  /** Mistake cards that are new or due. */
  mistakes: number;
}

export function countCards(cards: TrainCard[], nowSec: number): TrainerCounts {
  let newMoves = 0;
  let due = 0;
  let mistakes = 0;
  for (const c of cards) {
    const fresh = cardIsNew(c);
    if (c.kind === "repertoire" && fresh) newMoves++;
    if (!fresh && isDue(c.stored, nowSec)) due++;
    if (c.kind === "mistake" && (fresh || isDue(c.stored, nowSec))) mistakes++;
  }
  return { newMoves, due, mistakes };
}

// ---------- learning new lines ----------

export interface LessonStep {
  /** Position before the move. */
  fen: string;
  uci: string;
  san: string;
  mine: boolean;
  /** Your moves: the card for this position, and whether it's new to you. */
  cardId: string | null;
  isNew: boolean;
}

export interface Lesson {
  repertoireId: number;
  color: Color;
  steps: LessonStep[];
}

/**
 * The next line to learn: from the start to the most common position with a move
 * you haven't learned yet, then on along the most played replies while there are
 * more new moves, up to `maxNew` of them. Null when everything is learned.
 */
export function nextLesson(rep: Repertoire, cards: Map<string, TrainCard>, maxNew: number): Lesson | null {
  const nodes = nodesOf(rep);
  const fresh = (n: RepNode) => {
    if (!n.mine) return false;
    const c = cards.get(repCardId(rep.id, n.epd));
    return c ? cardIsNew(c) : true;
  };
  let first: RepNode | null = null;
  for (const n of nodes.values()) {
    if (fresh(n) && (!first || n.reach > first.reach || (n.reach === first.reach && n.ply < first.ply))) first = n;
  }
  if (!first || maxNew <= 0) return null;

  const toStep = (m: RepMove): LessonStep => {
    const node = nodes.get(m.epd);
    return {
      fen: m.fen,
      uci: m.uci,
      san: m.san,
      mine: m.mine,
      cardId: m.mine ? repCardId(rep.id, m.epd) : null,
      isNew: m.mine && !!node && fresh(node),
    };
  };
  // pathTo gives the moves that lead to `first`; the FEN of each step is the one
  // reached along this path (a transposition can store a different move order).
  const steps: LessonStep[] = [];
  let fen = "";
  const push = (m: RepMove) => {
    const step = toStep(m);
    const at = fen || m.fen;
    const played = playUci(at, m.uci);
    if (!played) return false;
    steps.push({ ...step, fen: at });
    fen = played.fen;
    return true;
  };
  for (const m of pathTo(rep, first.epd) ?? []) if (!push(m)) return null;
  if (!fen) fen = first.fen;

  // Continue from `first` while new moves keep coming.
  let count = 0;
  const seen = new Set<string>();
  for (;;) {
    const node = nodes.get(epdOf(fen));
    if (!node || seen.has(node.epd)) break;
    seen.add(node.epd);
    if (node.mine) {
      if (fresh(node)) count++;
      push(node.mine);
      if (count >= maxNew) break;
    } else {
      // The most played reply that still leads to something new, else the most played.
      const leadsToNew = node.replies.find((r) => {
        const next = playUci(fen, r.uci);
        const n = next && nodes.get(epdOf(next.fen));
        return !!n && fresh(n);
      });
      const reply = leadsToNew ?? null;
      if (!reply) break;
      push(reply);
    }
  }
  if (!steps.some((s) => s.isNew)) return null;
  // End the lesson on your own move.
  while (steps.length && !steps[steps.length - 1].mine) steps.pop();
  return { repertoireId: rep.id, color: rep.color, steps };
}

/** The moves leading to a repertoire card's position (to play them before asking). */
export function leadIn(rep: Repertoire, epd: string): LessonStep[] {
  const path = pathTo(rep, epd) ?? [];
  const steps: LessonStep[] = [];
  let fen = "";
  for (const m of path) {
    const at = fen || m.fen;
    const played = playUci(at, m.uci);
    if (!played) break;
    steps.push({ fen: at, uci: played.uci, san: played.san, mine: m.mine, cardId: null, isNew: false });
    fen = played.fen;
  }
  return steps;
}
