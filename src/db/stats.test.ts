import { describe, expect, it } from 'vitest';
import { computeStats, allTags } from './stats';
import type { Card, Deck, Note, ReviewLog } from './types';
import { DAY, HOUR, defaultDeckConfig } from '../srs';

const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime();
const deck = (id: string, parentId: string | null = null): Deck => ({ id, name: id, parentId, configId: 'default', createdAt: 0, updatedAt: 0 });
const note = (id: string, deckId: string, tags: string[] = []): Note => ({ id, deckId, type: 'basic', fields: { front: id, back: 'b' }, tags, checksum: id, createdAt: 0, updatedAt: 0 });
const card = (id: string, deckId: string, p: Partial<Card> = {}): Card => ({
  id, noteId: id, deckId, ord: 0, flag: 0, suspended: false, buriedUntil: 0, leech: false, createdAt: 0, updatedAt: 0,
  state: 'new', due: NOW, interval: 0, ease: 0, reps: 0, lapses: 0, learningStep: -1, ...p,
});
let n = 0;
const log = (cardId: string, ts: number, rating: 1 | 2 | 3 | 4, prevState: ReviewLog['prevState'] = 'review', prevInterval = 5): ReviewLog => ({
  id: `l${n++}`, cardId, deckId: 'A', timestamp: ts, rating, prevInterval, newInterval: 0, prevEase: 2.5, newEase: 2.5,
  prevState, newState: 'review', timeTakenMs: 4000, type: 'review', snapshot: {} as Card, buriedSiblings: [], leechAdded: false,
});

function input(cards: Card[], logs: ReviewLog[], notes: Note[] = cards.map((c) => note(c.id, c.deckId)), scope: Parameters<typeof computeStats>[0]['scope'] = { kind: 'all' }) {
  return { cards, logs, notes, decks: [deck('A'), deck('B', 'A'), deck('C')], configs: [defaultDeckConfig()], scope, now: NOW, dayStartHour: 4 };
}

describe('computeStats', () => {
  it('counts states, today and streaks', () => {
    const cards = [
      card('n1', 'A'),
      card('l1', 'A', { state: 'learning' }),
      card('y1', 'B', { state: 'review', interval: 5, ease: 2.5, due: NOW + 2 * DAY }),
      card('m1', 'C', { state: 'review', interval: 40, ease: 2.3, due: NOW + 10 * DAY }),
      card('s1', 'C', { state: 'review', interval: 3, suspended: true }),
    ];
    const logs = [
      log('y1', NOW - HOUR, 3),
      log('m1', NOW - 2 * HOUR, 1, 'review', 40),
      log('y1', NOW - DAY, 3),
      log('y1', NOW - 2 * DAY, 3),
      log('y1', NOW - 5 * DAY, 3),
      log('y1', NOW - 6 * DAY, 3),
      log('y1', NOW - 7 * DAY, 3),
    ];
    const s = computeStats(input(cards, logs));
    expect(s.states).toMatchObject({ new: 1, learning: 1, young: 1, mature: 1, suspended: 1, total: 5 });
    expect(s.today.studied).toBe(2);
    expect(s.streak.current).toBe(3);
    expect(s.streak.longest).toBe(3);
    expect(s.retention.today.mature).toMatchObject({ pass: 0, total: 1 });
    expect(s.retention.week.young.rate).toBe(1);
    expect(s.forget.lapses).toBe(1);
    expect(s.forecast[2].young).toBe(1);
    expect(s.forecast[10].mature).toBe(1);
    expect(s.forecast[0].learning).toBe(1);
    expect(s.intervals.find((b) => b.label === '5-7d')?.count).toBe(1);
    expect(s.hardest[0].card.id).toBe('m1');
  });

  it('filters by deck (with sub-decks) and by tag', () => {
    const cards = [card('a', 'A'), card('b', 'B'), card('c', 'C')];
    const notes = [note('a', 'A', ['x']), note('b', 'B'), note('c', 'C', ['x'])];
    expect(computeStats(input(cards, [], notes, { kind: 'deck', deckId: 'A' })).states.total).toBe(2);
    expect(computeStats(input(cards, [], notes, { kind: 'tag', tag: 'x' })).states.total).toBe(2);
    expect(allTags(notes)).toEqual(['x']);
  });

  it('estimates when new cards run out per deck', () => {
    const cards = Array.from({ length: 45 }, (_, i) => card(`c${i}`, 'C'));
    const s = computeStats(input(cards, []));
    const c = s.decks.find((d) => d.deck.id === 'C')!;
    expect(c.newLeft).toBe(45);
    expect(c.daysLeft).toBe(3);
  });

  it('lists leeches and the button breakdown', () => {
    const cards = [card('x', 'A', { state: 'review', interval: 1, ease: 1.3, lapses: 8, leech: true, suspended: true })];
    const logs = [log('x', NOW - HOUR, 1), log('x', NOW - 2 * HOUR, 2, 'learning', 0)];
    const s = computeStats(input(cards, logs));
    expect(s.leeches.map((l) => l.card.id)).toEqual(['x']);
    expect(s.buttons.young[0]).toBe(1);
    expect(s.buttons.learn[1]).toBe(1);
  });
});

describe('import links', async () => {
  const { decodeImportPayload, findImportPayload, resolveImportText, bytesToBase64Url } = await import('./importLink');
  const json = JSON.stringify({ deck: 'English::Lesson 1', cards: [{ front: 'ทดสอบ', back: 'test' }] });
  const plain = bytesToBase64Url(new TextEncoder().encode(json));
  it('decodes plain and gzip payloads', async () => {
    expect(await decodeImportPayload(plain)).toBe(json);
    const gz = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    expect(await decodeImportPayload(bytesToBase64Url(gz))).toBe(json);
  });
  it('finds payloads in pasted links and leaves JSON alone', async () => {
    const link = `https://manmegagram.github.io/forget-me-not/#import=${plain}`;
    expect(findImportPayload(link)).toBe(plain);
    expect(await resolveImportText(link)).toBe(json);
    expect(await resolveImportText(json)).toBe(json);
  });
});
