import { describe, expect, it } from 'vitest';
import { defaultDeckConfig } from './config';
import { applyFuzz, fuzzRange, newSchedulingInfo, reviewIntervals, sm2Scheduler } from './sm2';
import { addStudyDays, DAY, formatDelay, MINUTE, studyDayStart, studyDaysBetween } from './time';
import type { DeckConfig, ScheduleContext, SchedulingInfo } from './types';

// 2026-11-05 10:00 local time
const NOW = new Date(2026, 10, 5, 10, 0, 0).getTime();
const ctx = (now = NOW, seed = 'card-1'): ScheduleContext => ({ now, dayStartHour: 4, fuzzSeed: seed });
const noFuzz = (over: Partial<DeckConfig> = {}): DeckConfig => ({ ...defaultDeckConfig(), fuzz: false, ...over });

function reviewCard(over: Partial<SchedulingInfo> = {}): SchedulingInfo {
  return {
    state: 'review',
    due: studyDayStart(NOW, 4),
    interval: 10,
    ease: 2.5,
    reps: 5,
    lapses: 0,
    learningStep: -1,
    ...over,
  };
}

describe('time helpers', () => {
  it('treats 02:00 as part of the previous study day when the day starts at 04:00', () => {
    const at2am = new Date(2026, 10, 6, 2, 0).getTime();
    expect(studyDayStart(at2am, 4)).toBe(new Date(2026, 10, 5, 4, 0).getTime());
  });
  it('counts study days between timestamps', () => {
    expect(studyDaysBetween(NOW, addStudyDays(NOW, 3, 4), 4)).toBe(3);
  });
  it('formats delays like Anki', () => {
    expect(formatDelay(1 * MINUTE)).toBe('1m');
    expect(formatDelay(10 * MINUTE)).toBe('10m');
    expect(formatDelay(4 * DAY)).toBe('4d');
    expect(formatDelay(45 * DAY)).toBe('1.5mo');
    expect(formatDelay(730 * DAY)).toBe('2y');
  });
});

describe('new / learning cards', () => {
  const cfg = noFuzz();
  const fresh = newSchedulingInfo(NOW);

  it('shows the default button intervals 1m / 6m / 10m / 4d', () => {
    const p = sm2Scheduler.preview(fresh, cfg, ctx());
    expect(formatDelay(p[1])).toBe('1m');
    expect(formatDelay(p[2])).toBe('6m'); // average of 1m and 10m (rounded)
    expect(formatDelay(p[3])).toBe('10m');
    expect(studyDaysBetween(NOW, NOW + p[4], 4)).toBe(4);
  });

  it('Good walks through steps then graduates with the graduating interval', () => {
    const r1 = sm2Scheduler.answer(fresh, 3, cfg, ctx());
    expect(r1.card.state).toBe('learning');
    expect(r1.card.learningStep).toBe(1);
    expect(r1.card.due).toBe(NOW + 10 * MINUTE);
    expect(r1.card.ease).toBe(2.5);

    const r2 = sm2Scheduler.answer(r1.card, 3, cfg, ctx(NOW + 10 * MINUTE));
    expect(r2.card.state).toBe('review');
    expect(r2.card.interval).toBe(1);
    expect(r2.newInterval).toBe(1);
    expect(r2.card.due).toBe(addStudyDays(NOW, 1, 4));
  });

  it('Again resets to the first step', () => {
    const r1 = sm2Scheduler.answer(fresh, 3, cfg, ctx());
    const r2 = sm2Scheduler.answer(r1.card, 1, cfg, ctx());
    expect(r2.card.learningStep).toBe(0);
    expect(r2.card.due).toBe(NOW + MINUTE);
  });

  it('Hard repeats the current step (not the first one)', () => {
    const r1 = sm2Scheduler.answer(fresh, 3, cfg, ctx());
    const r2 = sm2Scheduler.answer(r1.card, 2, cfg, ctx());
    expect(r2.card.learningStep).toBe(1);
    expect(r2.card.due).toBe(NOW + 10 * MINUTE);
  });

  it('Easy graduates immediately with the easy interval', () => {
    const r = sm2Scheduler.answer(fresh, 4, cfg, ctx());
    expect(r.card.state).toBe('review');
    expect(r.card.interval).toBe(4);
  });

  it('with a single step, Hard is 1.5x that step', () => {
    const r = sm2Scheduler.answer(fresh, 2, noFuzz({ learnSteps: [10] }), ctx());
    expect(r.card.due).toBe(NOW + 15 * MINUTE);
  });

  it('with no steps, Good graduates at once', () => {
    const r = sm2Scheduler.answer(fresh, 3, noFuzz({ learnSteps: [] }), ctx());
    expect(r.card.state).toBe('review');
  });

  it('steps of a day or more land on a day boundary', () => {
    const r = sm2Scheduler.answer(fresh, 3, noFuzz({ learnSteps: [10, 1440, 4320] }), ctx());
    expect(r.card.due).toBe(addStudyDays(NOW, 1, 4)); // next step is 1440m = 1 day
    const r2 = sm2Scheduler.answer(r.card, 3, noFuzz({ learnSteps: [10, 1440, 4320] }), ctx());
    expect(r2.card.due).toBe(addStudyDays(NOW, 3, 4));
  });
});

describe('review cards', () => {
  const cfg = noFuzz();

  it('Good multiplies the interval by ease', () => {
    const r = sm2Scheduler.answer(reviewCard(), 3, cfg, ctx());
    expect(r.card.interval).toBe(25);
    expect(r.card.ease).toBe(2.5);
  });

  it('Hard uses the hard factor and lowers ease by 15%', () => {
    const r = sm2Scheduler.answer(reviewCard(), 2, cfg, ctx());
    expect(r.card.interval).toBe(12);
    expect(r.card.ease).toBeCloseTo(2.35);
  });

  it('Easy applies easy bonus and raises ease by 15%', () => {
    const r = sm2Scheduler.answer(reviewCard(), 4, cfg, ctx());
    expect(r.card.interval).toBe(33); // 10 * 2.5 * 1.3 = 32.5
    expect(r.card.ease).toBeCloseTo(2.65);
  });

  it('keeps Hard < Good < Easy even with tiny intervals', () => {
    const iv = reviewIntervals(reviewCard({ interval: 1, ease: 1.3 }), cfg, ctx());
    expect(iv.hard).toBeLessThan(iv.good);
    expect(iv.good).toBeLessThan(iv.easy);
  });

  it('credits half of the overdue days on Good and all of them on Easy', () => {
    const late = reviewCard({ due: addStudyDays(NOW, -4, 4) });
    expect(sm2Scheduler.answer(late, 3, cfg, ctx()).card.interval).toBe(30); // (10 + 2) * 2.5
    expect(sm2Scheduler.answer(late, 4, cfg, ctx()).card.interval).toBe(46); // (10 + 4) * 2.5 * 1.3 = 45.5
  });

  it('applies the interval modifier', () => {
    const r = sm2Scheduler.answer(reviewCard(), 3, noFuzz({ intervalModifier: 0.8 }), ctx());
    expect(r.card.interval).toBe(20);
  });

  it('caps at the maximum interval', () => {
    const r = sm2Scheduler.answer(reviewCard({ interval: 30000 }), 4, cfg, ctx());
    expect(r.card.interval).toBe(36500);
  });

  it('Again lapses: ease -20%, relearning step, min interval 1 day', () => {
    const r = sm2Scheduler.answer(reviewCard(), 1, cfg, ctx());
    expect(r.card.state).toBe('relearning');
    expect(r.card.lapses).toBe(1);
    expect(r.card.ease).toBeCloseTo(2.3);
    expect(r.card.interval).toBe(1);
    expect(r.card.due).toBe(NOW + 10 * MINUTE);

    const back = sm2Scheduler.answer(r.card, 3, cfg, ctx(NOW + 10 * MINUTE));
    expect(back.card.state).toBe('review');
    expect(back.card.interval).toBe(1);
  });

  it('ease never drops below 130%', () => {
    const r = sm2Scheduler.answer(reviewCard({ ease: 1.35 }), 1, cfg, ctx());
    expect(r.card.ease).toBe(1.3);
  });

  it('flags a leech on the 8th lapse and again every 4 lapses after', () => {
    expect(sm2Scheduler.answer(reviewCard({ lapses: 6 }), 1, cfg, ctx()).becameLeech).toBe(false);
    expect(sm2Scheduler.answer(reviewCard({ lapses: 7 }), 1, cfg, ctx()).becameLeech).toBe(true);
    expect(sm2Scheduler.answer(reviewCard({ lapses: 8 }), 1, cfg, ctx()).becameLeech).toBe(false);
    expect(sm2Scheduler.answer(reviewCard({ lapses: 11 }), 1, cfg, ctx()).becameLeech).toBe(true);
  });

  it('without relearning steps, Again goes straight back to review', () => {
    const r = sm2Scheduler.answer(reviewCard(), 1, noFuzz({ relearnSteps: [] }), ctx());
    expect(r.card.state).toBe('review');
    expect(r.card.due).toBe(addStudyDays(NOW, 1, 4));
  });
});

describe('fuzz', () => {
  it('does not fuzz short intervals', () => {
    expect(fuzzRange(2)).toEqual([2, 2]);
  });
  it('keeps fuzz within Anki ranges', () => {
    expect(fuzzRange(10)).toEqual([8, 12]); // delta = 1 + 0.15*4.5 + 0.1*3 = 1.975
    expect(fuzzRange(100)).toEqual([93, 107]); // delta = 1 + 0.675 + 1.3 + 4 = 6.975
  });
  it('is deterministic per seed so previews match the applied interval', () => {
    expect(applyFuzz(25, 'abc', true)).toBe(applyFuzz(25, 'abc', true));
    const cfg = defaultDeckConfig();
    const card = reviewCard();
    const preview = sm2Scheduler.preview(card, cfg, ctx());
    const applied = sm2Scheduler.answer(card, 3, cfg, ctx());
    expect(applied.card.due - NOW).toBe(preview[3]);
  });
  it('spreads cards over several days', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(applyFuzz(30, `card-${i}`, true));
    expect(seen.size).toBeGreaterThan(3);
  });
});
