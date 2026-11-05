/**
 * Statistics computed from cards + review logs. Pure functions (no DB access) so they are testable;
 * the Stats screen loads the rows and calls computeStats().
 */
import type { Card, Deck, Note, ReviewLog } from './types';
import type { DeckConfig, Rating } from '../srs/types';
import { DAY, addStudyDays, studyDayKey, studyDayStart, studyDaysBetween } from '../srs/time';

export const MATURE_DAYS = 21;

export type StatsScope = { kind: 'all' } | { kind: 'deck'; deckId: string } | { kind: 'tag'; tag: string };
export type Period = 'today' | 'week' | 'month' | 'year';
export const PERIOD_DAYS: Record<Period, number> = { today: 1, week: 7, month: 30, year: 365 };

export interface StatsInput {
  cards: Card[];
  logs: ReviewLog[];
  notes: Note[];
  decks: Deck[];
  configs: DeckConfig[];
  scope: StatsScope;
  now: number;
  dayStartHour: number;
}

export interface Retention {
  pass: number;
  total: number;
  /** pass / total, or null when there is nothing to measure. */
  rate: number | null;
}

export interface CardStateCounts {
  new: number;
  learning: number;
  relearning: number;
  young: number;
  mature: number;
  suspended: number;
  buried: number;
  total: number;
}

export interface HardCard {
  card: Card;
  note: Note | undefined;
  lapses: number;
  againRate: number;
  reviews: number;
}

export interface DeckProgress {
  deck: Deck;
  total: number;
  newLeft: number;
  learned: number;
  mature: number;
  newPerDay: number;
  /** Study day on which the last new card will have been introduced at the current limit, or null if none left. */
  finishDate: number | null;
  daysLeft: number;
}

export interface Stats {
  today: { studied: number; timeMs: number; newLearned: number; correct: number; again: number };
  streak: { current: number; longest: number; studiedToday: boolean; daysStudied: number };
  /** Review count per study-day key for the last 365 days (+ today). */
  heatmap: Map<string, number>;
  heatmapStart: number;
  states: CardStateCounts;
  retention: Record<Period, { young: Retention; mature: Retention; all: Retention }>;
  /** Answer-button counts per card kind over the selected period. index 0..3 = Again..Easy */
  buttons: Record<'learn' | 'young' | 'mature', [number, number, number, number]>;
  /** Reviews and pass rate per hour of day over the last 30 days. */
  hours: Array<{ hour: number; total: number; pass: number }>;
  /** Share of review answers that were "Again" (lapses), last 30 days, and the 30 days before. */
  forget: { rate: number | null; prevRate: number | null; lapses: number; reviews: number };
  /** Retention of review answers per week, oldest first (last 12 weeks). */
  weekly: Array<{ weekStart: number; rate: number | null; total: number }>;
  /** Cards due per day for the next 90 days (index 0 = today, includes overdue). */
  forecast: Array<{ day: number; young: number; mature: number; learning: number }>;
  intervals: Array<{ label: string; count: number }>;
  eases: Array<{ label: string; count: number }>;
  hardest: HardCard[];
  leeches: HardCard[];
  decks: DeckProgress[];
  avgEase: number | null;
  avgInterval: number | null;
  totalReviews: number;
}

/** Cards/logs that belong to the chosen scope (a deck includes its sub-decks). */
export function scopeCardIds(input: Pick<StatsInput, 'cards' | 'notes' | 'decks' | 'scope'>): Set<string> {
  const { cards, notes, decks, scope } = input;
  if (scope.kind === 'all') return new Set(cards.map((c) => c.id));
  if (scope.kind === 'deck') {
    const ids = new Set([scope.deckId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of decks) if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) (ids.add(d.id), (grew = true));
    }
    return new Set(cards.filter((c) => ids.has(c.deckId)).map((c) => c.id));
  }
  const tagged = new Set(notes.filter((n) => n.tags.includes(scope.tag)).map((n) => n.id));
  return new Set(cards.filter((c) => tagged.has(c.noteId)).map((c) => c.id));
}

const ret = (pass: number, total: number): Retention => ({ pass, total, rate: total ? pass / total : null });

/** A review-type answer: the card was a graduated review card before this answer. */
const isReviewAnswer = (l: ReviewLog) => l.prevState === 'review' && l.type !== 'manual' && l.type !== 'cram';

const INTERVAL_BUCKETS: Array<[number, number, string]> = [
  [1, 1, '1d'],
  [2, 2, '2d'],
  [3, 4, '3-4d'],
  [5, 7, '5-7d'],
  [8, 14, '1-2w'],
  [15, 30, '2w-1m'],
  [31, 60, '1-2m'],
  [61, 120, '2-4m'],
  [121, 365, '4m-1y'],
  [366, Infinity, '>1y'],
];

export function computeStats(input: StatsInput): Stats {
  const { now, dayStartHour } = input;
  const ids = scopeCardIds(input);
  const cards = input.cards.filter((c) => ids.has(c.id));
  const logs = input.logs.filter((l) => ids.has(l.cardId) && l.type !== 'manual').sort((a, b) => a.timestamp - b.timestamp);
  const todayStart = studyDayStart(now, dayStartHour);
  const notesById = new Map(input.notes.map((n) => [n.id, n]));

  // Today
  const todayLogs = logs.filter((l) => l.timestamp >= todayStart);
  const today = {
    studied: todayLogs.length,
    timeMs: todayLogs.reduce((s, l) => s + l.timeTakenMs, 0),
    newLearned: todayLogs.filter((l) => l.prevState === 'new').length,
    correct: todayLogs.filter((l) => l.rating > 1).length,
    again: todayLogs.filter((l) => l.rating === 1).length,
  };

  // Heatmap + streak
  const heatmap = new Map<string, number>();
  for (const l of logs) {
    const k = studyDayKey(l.timestamp, dayStartHour);
    heatmap.set(k, (heatmap.get(k) ?? 0) + 1);
  }
  const days = [...heatmap.keys()].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of days) {
    run = prev && nextDayKey(prev) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  const todayKey = studyDayKey(now, dayStartHour);
  const studiedToday = heatmap.has(todayKey);
  let current = 0;
  let cursor = studiedToday ? now : addStudyDays(now, -1, dayStartHour);
  while (heatmap.has(studyDayKey(cursor, dayStartHour))) {
    current++;
    cursor = addStudyDays(cursor, -1, dayStartHour);
  }
  const heatmapStart = addStudyDays(now, -364, dayStartHour);

  // Card states
  const states: CardStateCounts = { new: 0, learning: 0, relearning: 0, young: 0, mature: 0, suspended: 0, buried: 0, total: cards.length };
  for (const c of cards) {
    if (c.suspended) states.suspended++;
    else if (c.buriedUntil > now) states.buried++;
    else if (c.state === 'new') states.new++;
    else if (c.state === 'learning') states.learning++;
    else if (c.state === 'relearning') states.relearning++;
    else if (c.interval >= MATURE_DAYS) states.mature++;
    else states.young++;
  }

  // Retention per period (true retention: review answers only)
  const reviewLogs = logs.filter(isReviewAnswer);
  const retention = {} as Stats['retention'];
  for (const p of Object.keys(PERIOD_DAYS) as Period[]) {
    const from = addStudyDays(now, -(PERIOD_DAYS[p] - 1), dayStartHour);
    const inP = reviewLogs.filter((l) => l.timestamp >= from);
    const young = inP.filter((l) => l.prevInterval < MATURE_DAYS);
    const mature = inP.filter((l) => l.prevInterval >= MATURE_DAYS);
    const pass = (a: ReviewLog[]) => a.filter((l) => l.rating > 1).length;
    retention[p] = { young: ret(pass(young), young.length), mature: ret(pass(mature), mature.length), all: ret(pass(inP), inP.length) };
  }

  // Buttons (last 30 days)
  const monthFrom = addStudyDays(now, -29, dayStartHour);
  const buttons: Stats['buttons'] = { learn: [0, 0, 0, 0], young: [0, 0, 0, 0], mature: [0, 0, 0, 0] };
  for (const l of logs) {
    if (l.timestamp < monthFrom || l.type === 'cram') continue;
    const kind = l.prevState === 'review' ? (l.prevInterval >= MATURE_DAYS ? 'mature' : 'young') : 'learn';
    buttons[kind][(l.rating as Rating) - 1]++;
  }

  // Hours (last 30 days)
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, pass: 0 }));
  for (const l of logs) {
    if (l.timestamp < monthFrom) continue;
    const h = hours[new Date(l.timestamp).getHours()];
    h.total++;
    if (l.rating > 1) h.pass++;
  }

  // Forget rate (lapses / review answers), this 30 days vs previous 30
  const prevFrom = addStudyDays(now, -59, dayStartHour);
  const cur = reviewLogs.filter((l) => l.timestamp >= monthFrom);
  const before = reviewLogs.filter((l) => l.timestamp >= prevFrom && l.timestamp < monthFrom);
  const lapses = cur.filter((l) => l.rating === 1).length;
  const forget = {
    rate: cur.length ? lapses / cur.length : null,
    prevRate: before.length ? before.filter((l) => l.rating === 1).length / before.length : null,
    lapses,
    reviews: cur.length,
  };

  // Weekly retention, 12 weeks ending today
  const weekly: Stats['weekly'] = [];
  for (let w = 11; w >= 0; w--) {
    const start = addStudyDays(now, -(w * 7 + 6), dayStartHour);
    const end = addStudyDays(now, -(w * 7) + 1, dayStartHour);
    const inW = reviewLogs.filter((l) => l.timestamp >= start && l.timestamp < end);
    const p = inW.filter((l) => l.rating > 1).length;
    weekly.push({ weekStart: start, rate: inW.length ? p / inW.length : null, total: inW.length });
  }

  // Forecast (90 days); overdue cards count today
  const forecast = Array.from({ length: 90 }, (_, day) => ({ day, young: 0, mature: 0, learning: 0 }));
  for (const c of cards) {
    if (c.suspended || c.state === 'new') continue;
    const due = Math.max(c.due, c.buriedUntil > now ? c.buriedUntil : 0);
    const d = Math.max(0, studyDaysBetween(now, due, dayStartHour));
    if (d >= 90) continue;
    if (c.state !== 'review') forecast[d].learning++;
    else if (c.interval >= MATURE_DAYS) forecast[d].mature++;
    else forecast[d].young++;
  }

  // Histograms
  const reviewCards = cards.filter((c) => c.state === 'review' && !c.suspended);
  const intervals = INTERVAL_BUCKETS.map(([lo, hi, label]) => ({ label, count: reviewCards.filter((c) => c.interval >= lo && c.interval <= hi).length }));
  const easeCards = cards.filter((c) => c.state !== 'new' && c.ease > 0);
  const eases: Stats['eases'] = [];
  for (let lo = 130; lo < 310; lo += 20) {
    const hi = lo + 20;
    const last = lo + 20 >= 310;
    eases.push({ label: last ? `${lo}%+` : `${lo}–${hi - 1}%`, count: easeCards.filter((c) => c.ease * 100 >= lo - 0.001 && (last || c.ease * 100 < hi - 0.001)).length });
  }

  // Hardest cards and leeches
  const perCard = new Map<string, { reviews: number; again: number }>();
  for (const l of logs) {
    const p = perCard.get(l.cardId) ?? { reviews: 0, again: 0 };
    p.reviews++;
    if (l.rating === 1) p.again++;
    perCard.set(l.cardId, p);
  }
  const hard = (c: Card): HardCard => {
    const p = perCard.get(c.id) ?? { reviews: 0, again: 0 };
    return { card: c, note: notesById.get(c.noteId), lapses: c.lapses, reviews: p.reviews, againRate: p.reviews ? p.again / p.reviews : 0 };
  };
  const hardest = cards
    .filter((c) => c.state !== 'new' && (c.lapses > 0 || (perCard.get(c.id)?.again ?? 0) > 0))
    .map(hard)
    .sort((a, b) => b.lapses - a.lapses || b.againRate - a.againRate || a.card.ease - b.card.ease)
    .slice(0, 20);
  const leeches = cards.filter((c) => c.leech).map(hard).sort((a, b) => b.lapses - a.lapses);

  // Per-deck progress (top-level decks in scope; a deck scope shows its direct children too)
  const configById = new Map(input.configs.map((c) => [c.id, c]));
  const deckRows: Deck[] =
    input.scope.kind === 'deck'
      ? input.decks.filter((d) => d.id === (input.scope as { deckId: string }).deckId || d.parentId === (input.scope as { deckId: string }).deckId)
      : input.decks.filter((d) => !d.parentId);
  const childrenOf = (id: string): Set<string> => {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of input.decks) if (d.parentId && out.has(d.parentId) && !out.has(d.id)) (out.add(d.id), (grew = true));
    }
    return out;
  };
  const decks: DeckProgress[] = deckRows
    .map((deck) => {
      const subtree = childrenOf(deck.id);
      const own = cards.filter((c) => subtree.has(c.deckId));
      const newLeft = own.filter((c) => c.state === 'new' && !c.suspended).length;
      const newPerDay = configById.get(deck.configId)?.newPerDay ?? 20;
      const daysLeft = newLeft && newPerDay > 0 ? Math.ceil(newLeft / newPerDay) : 0;
      return {
        deck,
        total: own.length,
        newLeft,
        learned: own.filter((c) => c.state !== 'new').length,
        mature: own.filter((c) => c.state === 'review' && c.interval >= MATURE_DAYS).length,
        newPerDay,
        daysLeft,
        finishDate: daysLeft ? addStudyDays(now, daysLeft - 1, dayStartHour) : null,
      };
    })
    .filter((d) => d.total > 0)
    .sort((a, b) => a.deck.name.localeCompare(b.deck.name));

  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  return {
    today,
    streak: { current, longest, studiedToday, daysStudied: days.length },
    heatmap,
    heatmapStart,
    states,
    retention,
    buttons,
    hours,
    forget,
    weekly,
    forecast,
    intervals,
    eases,
    hardest,
    leeches,
    decks,
    avgEase: avg(easeCards.map((c) => c.ease)),
    avgInterval: avg(reviewCards.map((c) => c.interval)),
    totalReviews: logs.length,
  };
}

function nextDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + DAY);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** All tags used by notes, most used first (for the filter). */
export function allTags(notes: Note[]): string[] {
  const counts = new Map<string, number>();
  for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
