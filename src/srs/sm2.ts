/**
 * SM-2 scheduler, modelled on Anki's v3 scheduler behaviour.
 * Pure functions only: no storage, no clock, no global randomness.
 */
import type { AnswerResult, DeckConfig, Rating, ReviewKind, ScheduleContext, Scheduler, SchedulingInfo } from './types';
import { addStudyDays, MINUTE, studyDaysBetween } from './time';

const MINUTES_PER_DAY = 1440;

/** Deterministic PRNG in [0, 1) from a string seed (FNV-1a + mulberry32). */
export function seededRandom(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let t = (h + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Anki's fuzz ranges: no fuzz under 2.5 days, then 15% / 10% / 5% bands plus 1 day. */
export function fuzzRange(interval: number): [number, number] {
  if (interval < 2.5) return [interval, interval];
  const bands: Array<[number, number, number]> = [
    [2.5, 7, 0.15],
    [7, 20, 0.1],
    [20, Infinity, 0.05],
  ];
  let delta = 1;
  for (const [start, end, factor] of bands) {
    delta += factor * Math.max(0, Math.min(interval, end) - start);
  }
  const lo = Math.max(2, Math.round(interval - delta));
  const hi = Math.round(interval + delta);
  return [lo, hi];
}

export function applyFuzz(interval: number, seed: string, enabled: boolean): number {
  if (!enabled) return interval;
  const [lo, hi] = fuzzRange(interval);
  if (lo >= hi) return interval;
  return lo + Math.floor(seededRandom(seed) * (hi - lo + 1));
}

function clampInterval(days: number, config: DeckConfig): number {
  return Math.min(config.maxInterval, Math.max(1, Math.round(days)));
}

/** Delay in minutes for a learning/relearning step answer, or null = graduate. */
function stepDelay(steps: number[], step: number, rating: Rating): number | null {
  if (steps.length === 0) return null;
  const idx = Math.max(0, Math.min(step, steps.length - 1));
  switch (rating) {
    case 1:
      return steps[0];
    case 2:
      if (idx === 0) {
        return steps.length > 1
          ? (steps[0] + steps[1]) / 2
          : Math.min(steps[0] * 1.5, steps[0] + MINUTES_PER_DAY);
      }
      return steps[idx];
    case 3:
      return idx + 1 < steps.length ? steps[idx + 1] : null;
    case 4:
      return null;
  }
}

/** Due timestamp for a step delay; steps of a day or more land on a day boundary. */
function dueForStep(minutes: number, ctx: ScheduleContext): number {
  if (minutes >= MINUTES_PER_DAY) {
    return addStudyDays(ctx.now, Math.round(minutes / MINUTES_PER_DAY), ctx.dayStartHour);
  }
  return ctx.now + Math.round(minutes * MINUTE);
}

function dueForDays(days: number, ctx: ScheduleContext): number {
  return addStudyDays(ctx.now, days, ctx.dayStartHour);
}

/** Intervals for Hard/Good/Easy on a review card, after fuzz, strictly increasing. */
export function reviewIntervals(
  card: SchedulingInfo,
  config: DeckConfig,
  ctx: ScheduleContext,
): { hard: number; good: number; easy: number } {
  const ivl = Math.max(1, card.interval);
  const daysLate = Math.max(0, studyDaysBetween(card.due, ctx.now, ctx.dayStartHour));
  const mod = config.intervalModifier;
  const seed = `${ctx.fuzzSeed}:${card.reps}`;

  const hardRaw = config.hardIntervalFactor > 1
    ? Math.max(ivl * config.hardIntervalFactor * mod, ivl + 1)
    : ivl * config.hardIntervalFactor * mod;
  let hard = clampInterval(hardRaw, config);
  hard = clampInterval(applyFuzz(hard, `${seed}:2`, config.fuzz), config);

  const goodRaw = (ivl + daysLate / 2) * card.ease * mod;
  let good = clampInterval(applyFuzz(clampInterval(goodRaw, config), `${seed}:3`, config.fuzz), config);
  good = Math.min(config.maxInterval, Math.max(good, hard + 1));

  const easyRaw = (ivl + daysLate) * card.ease * config.easyBonus * mod;
  let easy = clampInterval(applyFuzz(clampInterval(easyRaw, config), `${seed}:4`, config.fuzz), config);
  easy = Math.min(config.maxInterval, Math.max(easy, good + 1));

  return { hard, good, easy };
}

function answerLearning(
  card: SchedulingInfo,
  rating: Rating,
  config: DeckConfig,
  ctx: ScheduleContext,
): AnswerResult {
  const isRelearn = card.state === 'relearning';
  const steps = isRelearn ? config.relearnSteps : config.learnSteps;
  const kind: ReviewKind = isRelearn ? 'relearn' : 'learn';
  const step = card.state === 'new' ? 0 : Math.max(0, card.learningStep);
  const ease = card.ease > 0 ? card.ease : config.startingEase;
  const delay = stepDelay(steps, step, rating);

  if (delay !== null) {
    const nextStep = rating === 1 ? 0 : rating === 2 ? step : step + 1;
    return {
      card: {
        ...card,
        state: isRelearn ? 'relearning' : 'learning',
        learningStep: nextStep,
        due: dueForStep(delay, ctx),
        ease,
        reps: card.reps + 1,
      },
      newInterval: 0,
      kind,
      becameLeech: false,
    };
  }

  // Graduate to review.
  let interval: number;
  if (isRelearn) {
    const base = Math.max(config.minLapseInterval, card.interval);
    interval = rating === 4 ? base + 1 : base;
  } else {
    const days = rating === 4 ? config.easyInterval : config.graduatingInterval;
    interval = applyFuzz(days, `${ctx.fuzzSeed}:${card.reps}:${rating}`, config.fuzz);
  }
  interval = clampInterval(interval, config);
  return {
    card: {
      ...card,
      state: 'review',
      learningStep: -1,
      interval,
      ease,
      due: dueForDays(interval, ctx),
      reps: card.reps + 1,
    },
    newInterval: interval,
    kind,
    becameLeech: false,
  };
}

function isLeechLapse(lapses: number, threshold: number): boolean {
  if (threshold <= 0 || lapses < threshold) return false;
  const every = Math.max(1, Math.ceil(threshold / 2));
  return (lapses - threshold) % every === 0;
}

function answerReview(
  card: SchedulingInfo,
  rating: Rating,
  config: DeckConfig,
  ctx: ScheduleContext,
): AnswerResult {
  if (rating === 1) {
    const lapses = card.lapses + 1;
    const ease = Math.max(config.minEase, card.ease + config.easeAgainDelta);
    const interval = clampInterval(
      Math.max(config.minLapseInterval, card.interval * config.lapseIntervalMultiplier),
      config,
    );
    const becameLeech = isLeechLapse(lapses, config.leechThreshold);
    if (config.relearnSteps.length > 0) {
      return {
        card: {
          ...card,
          state: 'relearning',
          learningStep: 0,
          interval,
          ease,
          lapses,
          reps: card.reps + 1,
          due: dueForStep(config.relearnSteps[0], ctx),
        },
        newInterval: 0,
        kind: 'review',
        becameLeech,
      };
    }
    return {
      card: { ...card, state: 'review', interval, ease, lapses, reps: card.reps + 1, due: dueForDays(interval, ctx) },
      newInterval: interval,
      kind: 'review',
      becameLeech,
    };
  }

  const ivls = reviewIntervals(card, config, ctx);
  const interval = rating === 2 ? ivls.hard : rating === 3 ? ivls.good : ivls.easy;
  const easeDelta = rating === 2 ? config.easeHardDelta : rating === 4 ? config.easeEasyDelta : 0;
  const ease = Math.max(config.minEase, card.ease + easeDelta);
  return {
    card: { ...card, state: 'review', learningStep: -1, interval, ease, reps: card.reps + 1, due: dueForDays(interval, ctx) },
    newInterval: interval,
    kind: 'review',
    becameLeech: false,
  };
}

export const sm2Scheduler: Scheduler = {
  id: 'sm2',
  answer(card, rating, config, ctx) {
    if (card.state === 'review') return answerReview(card, rating, config, ctx);
    return answerLearning(card, rating, config, ctx);
  },
  preview(card, config, ctx) {
    const out = {} as Record<Rating, number>;
    for (const r of [1, 2, 3, 4] as Rating[]) {
      out[r] = Math.max(0, this.answer(card, r, config, ctx).card.due - ctx.now);
    }
    return out;
  },
};

/** A blank scheduling state for a brand-new card. */
export function newSchedulingInfo(now: number): SchedulingInfo {
  return { state: 'new', due: now, interval: 0, ease: 0, reps: 0, lapses: 0, learningStep: -1 };
}
