/**
 * Builds today's study queue with Anki-like per-deck limits.
 * Each deck's own daily limits apply to that deck and everything below it.
 */
import { db } from './schema';
import type { Card, Deck } from './types';
import { addStudyDays, normalizeConfig, studyDayStart, type DeckConfig, type NewReviewOrder } from '../srs';
import { defaultDeckConfig } from '../srs/config';

export interface DeckCounts {
  new: number;
  learn: number;
  review: number;
}

export interface QueueLists {
  learning: Card[];
  review: Card[];
  new: Card[];
}

interface DeckResult {
  learning: Card[];
  review: Card[];
  new: Card[];
}

export interface GatherResult {
  /** Counts per deck (including sub-decks), after limits. */
  counts: Map<string, DeckCounts>;
  /** Cards for the requested root, after limits. */
  queue: QueueLists;
}

export interface GatherOptions {
  now: number;
  dayStartHour: number;
  /** null = all decks */
  rootDeckId: string | null;
  /** Extra new/review cards allowed today (Custom Study "increase today's limit"). */
  extraNew?: number;
  extraReview?: number;
}

export async function gatherQueue(opts: GatherOptions): Promise<GatherResult> {
  const { now, dayStartHour } = opts;
  const todayStart = studyDayStart(now, dayStartHour);
  const tomorrow = addStudyDays(now, 1, dayStartHour);

  const [decks, configsRaw, dueCards, newCards, todayLogs] = await Promise.all([
    db.decks.toArray(),
    db.configs.toArray(),
    db.cards.where('due').below(tomorrow).filter((c) => c.state !== 'new' && !c.suspended && c.buriedUntil <= now).toArray(),
    db.cards.where('state').equals('new').filter((c) => !c.suspended && c.buriedUntil <= now).toArray(),
    db.reviewLogs.where('timestamp').aboveOrEqual(todayStart).toArray(),
  ]);

  const configs = new Map<string, DeckConfig>(configsRaw.map((c) => [c.id, normalizeConfig(c)]));
  const fallback = configs.get('default') ?? defaultDeckConfig();
  const cfgOf = (d: Deck) => configs.get(d.configId) ?? fallback;

  const newDone = new Map<string, number>();
  const reviewDone = new Map<string, number>();
  for (const log of todayLogs) {
    if (log.type === 'cram' || log.type === 'manual') continue;
    if (log.prevState === 'new') newDone.set(log.deckId, (newDone.get(log.deckId) ?? 0) + 1);
    else if (log.prevState === 'review') reviewDone.set(log.deckId, (reviewDone.get(log.deckId) ?? 0) + 1);
  }

  const ownLearning = new Map<string, Card[]>();
  const ownReview = new Map<string, Card[]>();
  const ownNew = new Map<string, Card[]>();
  const push = (m: Map<string, Card[]>, c: Card) => {
    const list = m.get(c.deckId);
    if (list) list.push(c);
    else m.set(c.deckId, [c]);
  };
  for (const c of dueCards) {
    if (c.state === 'review') push(ownReview, c);
    else push(ownLearning, c);
  }
  for (const c of newCards) push(ownNew, c);
  for (const list of ownReview.values()) list.sort((a, b) => a.due - b.due || (a.id < b.id ? -1 : 1));
  for (const list of ownNew.values()) list.sort((a, b) => a.createdAt - b.createdAt || a.ord - b.ord);
  for (const list of ownLearning.values()) list.sort((a, b) => a.due - b.due);

  const children = new Map<string | null, Deck[]>();
  for (const d of decks) {
    const list = children.get(d.parentId) ?? [];
    list.push(d);
    children.set(d.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  // Sum of descendants' done counts, so a parent's limit covers its whole subtree.
  const subtreeDone = (id: string, m: Map<string, number>): number =>
    (m.get(id) ?? 0) + (children.get(id) ?? []).reduce((s, d) => s + subtreeDone(d.id, m), 0);

  const counts = new Map<string, DeckCounts>();
  const results = new Map<string, DeckResult>();

  const visit = (deck: Deck): DeckResult => {
    const cfg = cfgOf(deck);
    const kids = (children.get(deck.id) ?? []).map(visit);
    const learning = [...(ownLearning.get(deck.id) ?? []), ...kids.flatMap((k) => k.learning)];
    const isRoot = deck.id === opts.rootDeckId;
    const newLimit = Math.max(0, cfg.newPerDay - subtreeDone(deck.id, newDone) + (isRoot ? opts.extraNew ?? 0 : 0));
    const reviewLimit = Math.max(0, cfg.reviewsPerDay - subtreeDone(deck.id, reviewDone) + (isRoot ? opts.extraReview ?? 0 : 0));
    const review = [...(ownReview.get(deck.id) ?? []), ...kids.flatMap((k) => k.review)].slice(0, reviewLimit);
    const fresh = [...(ownNew.get(deck.id) ?? []), ...kids.flatMap((k) => k.new)].slice(0, newLimit);
    const res = { learning, review, new: fresh };
    counts.set(deck.id, { new: fresh.length, learn: learning.length, review: review.length });
    results.set(deck.id, res);
    return res;
  };
  const tops = (children.get(null) ?? []).map(visit);

  let queue: QueueLists;
  if (opts.rootDeckId && results.has(opts.rootDeckId)) {
    const r = results.get(opts.rootDeckId)!;
    queue = { learning: [...r.learning], review: [...r.review], new: [...r.new] };
  } else {
    queue = {
      learning: tops.flatMap((t) => t.learning),
      review: tops.flatMap((t) => t.review),
      new: tops.flatMap((t) => t.new),
    };
  }
  queue.learning.sort((a, b) => a.due - b.due);
  queue.review.sort((a, b) => a.due - b.due);
  return { counts, queue };
}

export function totalCounts(counts: Map<string, DeckCounts>, topIds: string[]): DeckCounts {
  return topIds.reduce(
    (acc, id) => {
      const c = counts.get(id);
      if (c) {
        acc.new += c.new;
        acc.learn += c.learn;
        acc.review += c.review;
      }
      return acc;
    },
    { new: 0, learn: 0, review: 0 },
  );
}

// ---------- in-session queue ----------

export interface SessionPick {
  card: Card | null;
  /** When nothing is ready: the next learning card's due time today, if any. */
  nextLearningDue: number | null;
}

export function pickNext(
  q: QueueLists,
  now: number,
  opts: { learnAheadMinutes: number; order: NewReviewOrder; learningFirst: boolean; reviewedNew: number; reviewedReview: number },
): SessionPick {
  const dueLearning = q.learning.find((c) => c.due <= now);
  if (dueLearning && opts.learningFirst) return { card: dueLearning, nextLearningDue: null };

  const nextMain = (): Card | null => {
    if (!q.review.length) return q.new[0] ?? null;
    if (!q.new.length) return q.review[0] ?? null;
    if (opts.order === 'newFirst') return q.new[0];
    if (opts.order === 'reviewsFirst') return q.review[0];
    // mixed: spread new cards evenly between reviews
    const totalNew = opts.reviewedNew + q.new.length;
    const totalReview = opts.reviewedReview + q.review.length;
    return opts.reviewedNew * totalReview <= opts.reviewedReview * totalNew ? q.new[0] : q.review[0];
  };
  const main = nextMain();
  if (dueLearning && !main) return { card: dueLearning, nextLearningDue: null };
  if (main) {
    if (dueLearning) return { card: dueLearning, nextLearningDue: null };
    return { card: main, nextLearningDue: null };
  }
  const ahead = q.learning.find((c) => c.due <= now + opts.learnAheadMinutes * 60_000);
  if (ahead) return { card: ahead, nextLearningDue: null };
  return { card: null, nextLearningDue: q.learning[0]?.due ?? null };
}

/** Removes a card from the session lists and re-queues it if it is due again today. */
export function requeue(q: QueueLists, updated: Card, tomorrow: number): QueueLists {
  const without = (list: Card[]) => list.filter((c) => c.id !== updated.id);
  const next: QueueLists = { learning: without(q.learning), review: without(q.review), new: without(q.new) };
  if ((updated.state === 'learning' || updated.state === 'relearning') && updated.due < tomorrow && !updated.suspended) {
    next.learning.push(updated);
    next.learning.sort((a, b) => a.due - b.due);
  }
  return next;
}

/** Puts a card back after an undo, at the front of the list it came from. */
export function restoreToQueue(q: QueueLists, card: Card): QueueLists {
  const without = (list: Card[]) => list.filter((c) => c.id !== card.id);
  const next: QueueLists = { learning: without(q.learning), review: without(q.review), new: without(q.new) };
  if (card.state === 'new') next.new.unshift(card);
  else if (card.state === 'review') next.review.unshift(card);
  else next.learning.unshift({ ...card, due: Math.min(card.due, Date.now()) });
  return next;
}
