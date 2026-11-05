import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import { commitImport, extractJson, findDuplicates, parseImport } from './import';
import { gatherQueue } from './queue';
import { answerCard, getConfig, saveConfig, undoAnswer, ensureDeckPath } from './repo';
import { renderCard } from '../cards/render';
import { renderMarkdown } from '../cards/markdown';

const SAMPLE = {
  deck: 'TOEIC Finance',
  tags: ['toeic', 'finance'],
  cards: [
    { front: 'Revenue', back: 'รายได้', note: 'Annual revenue rose 10%.' },
    { front: 'Invoice', back: 'ใบแจ้งหนี้', type: 'reverse' },
    { text: 'Ohm: {{c1::V}} = {{c2::I}} × R' },
    { front: '', back: 'missing front' },
  ],
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('import', () => {
  it('extracts JSON wrapped in prose or code fences', () => {
    expect(JSON.parse(extractJson('Here you go:\n```json\n{"a":1}\n```\nEnjoy'))).toEqual({ a: 1 });
    expect(JSON.parse(extractJson('Sure! {"deck":"x","cards":[{"front":"a}b","back":"c"}]} done'))).toMatchObject({ deck: 'x' });
  });

  it('parses types and flags invalid rows', () => {
    const p = parseImport(JSON.stringify(SAMPLE));
    expect(p.deck).toBe('TOEIC Finance');
    expect(p.items.map((i) => i.type)).toEqual(['basic', 'reverse', 'cloze', 'basic']);
    expect(p.items[3].error).toBe('front_missing');
    expect(p.items[0].tags).toEqual(['toeic', 'finance']);
  });

  it('reports invalid JSON', () => {
    expect(parseImport('not json').errors).toEqual(['invalid_json']);
  });

  it('creates notes, the right number of cards, and detects duplicates on re-import', async () => {
    const p = parseImport(JSON.stringify(SAMPLE));
    const dups = await findDuplicates(p.items);
    const res = await commitImport(p.items, p.items.map(() => 'add'), dups, { deckPath: p.deck });
    expect(res.added).toBe(3);
    expect(res.skipped).toBe(1);
    expect(res.cards).toBe(1 + 2 + 2); // basic + reverse(2) + cloze(2)

    const again = parseImport(JSON.stringify({ ...SAMPLE, cards: [{ front: '  revenue ', back: 'x' }, { front: 'New word', back: 'y' }] }));
    const d2 = await findDuplicates(again.items);
    expect(d2.map((d) => d.kind)).toEqual(['existing', 'none']);

    const r2 = await commitImport(again.items, ['overwrite', 'add'], d2, { deckId: res.deckId });
    expect(r2).toMatchObject({ added: 1, updated: 1 });
    const revenue = await db.notes.where('checksum').equals('revenue').first();
    expect(revenue?.fields.back).toBe('x');
  });

  it('creates nested decks from A::B paths', async () => {
    const leaf = await ensureDeckPath('English::TOEIC::Finance');
    const parent = await db.decks.get(leaf.parentId!);
    expect(parent?.name).toBe('TOEIC');
    expect((await ensureDeckPath('English::TOEIC::Finance')).id).toBe(leaf.id);
  });
});

describe('queue and answering', () => {
  async function seed(n: number) {
    const cards = Array.from({ length: n }, (_, i) => ({ front: `word ${i}`, back: `meaning ${i}` }));
    const p = parseImport(JSON.stringify({ deck: 'D', cards }));
    return commitImport(p.items, p.items.map(() => 'add'), await findDuplicates(p.items), { deckPath: 'D' });
  }

  it('limits new cards per day', async () => {
    await seed(30);
    const g = await gatherQueue({ now: Date.now(), dayStartHour: 4, rootDeckId: null });
    expect(g.queue.new.length).toBe(20);
  });

  it('counts studied new cards against the limit and undo restores the card', async () => {
    const { deckId } = await seed(25);
    const cfg = await getConfig('default');
    const g = await gatherQueue({ now: Date.now(), dayStartHour: 4, rootDeckId: deckId });
    const first = g.queue.new[0];
    const { card, log } = await answerCard({ card: first, rating: 3, timeTakenMs: 1200, config: cfg, dayStartHour: 4 });
    expect(card.state).toBe('learning');
    expect(log.prevState).toBe('new');
    expect(log.timeTakenMs).toBe(1200);

    const g2 = await gatherQueue({ now: Date.now(), dayStartHour: 4, rootDeckId: deckId });
    expect(g2.queue.new.length).toBe(19);
    expect(g2.queue.learning.length).toBe(1);

    await undoAnswer(log.id);
    const restored = await db.cards.get(first.id);
    expect(restored?.state).toBe('new');
    expect(await db.reviewLogs.count()).toBe(0);
  });

  it('buries siblings of a reverse card after answering', async () => {
    const p = parseImport(JSON.stringify({ deck: 'R', cards: [{ front: 'a', back: 'b', type: 'reverse' }] }));
    const { deckId } = await commitImport(p.items, ['add'], await findDuplicates(p.items), { deckPath: 'R' });
    const cfg = await getConfig('default');
    const g = await gatherQueue({ now: Date.now(), dayStartHour: 4, rootDeckId: deckId });
    expect(g.queue.new.length).toBe(2);
    const { log } = await answerCard({ card: g.queue.new[0], rating: 4, timeTakenMs: 500, config: cfg, dayStartHour: 4 });
    expect(log.buriedSiblings.length).toBe(1);
    const g2 = await gatherQueue({ now: Date.now(), dayStartHour: 4, rootDeckId: deckId });
    expect(g2.queue.new.length).toBe(0);
  });

  it('suspends and tags a leech', async () => {
    const { deckId } = await seed(1);
    const cfg = { ...(await getConfig('default')), leechThreshold: 1, relearnSteps: [] };
    await saveConfig(cfg);
    const card = (await db.cards.where('deckId').equals(deckId).first())!;
    const review = { ...card, state: 'review' as const, interval: 5, ease: 2.5, due: Date.now() };
    await db.cards.put(review);
    const { card: after } = await answerCard({ card: review, rating: 1, timeTakenMs: 100, config: cfg, dayStartHour: 4 });
    expect(after.leech).toBe(true);
    expect(after.suspended).toBe(true);
    const note = await db.notes.get(card.noteId);
    expect(note?.tags).toContain('leech');
  });
});

describe('rendering', () => {
  it('escapes HTML so card text cannot inject scripts', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> **bold**');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders cloze question and answer for each ordinal', () => {
    const note = { id: 'n', deckId: 'd', type: 'cloze' as const, fields: { text: 'A {{c1::B}} C {{c2::D::hint}}', extra: '' }, tags: [], checksum: '', createdAt: 0, updatedAt: 0 };
    const c1 = renderCard(note, 0);
    expect(c1.question).toContain('[…]');
    expect(c1.question).toContain('D');
    const c2 = renderCard(note, 1);
    expect(c2.question).toContain('[hint]');
    expect(c2.answer).toContain('cloze-revealed');
  });

  it('renders KaTeX math', () => {
    expect(renderMarkdown('$$\\frac{F}{A}$$')).toContain('katex');
  });
});
