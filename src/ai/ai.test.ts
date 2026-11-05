import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { CARD_SET_SCHEMA, MAX_CARDS_PER_BATCH, SYSTEM_PROMPT, describeDraft, externalPrompt, normalizeOutput } from './prompt';
import { applyOutput, draftToParsed, emptyDraft, makeUserMessage, newSession, toApiMessages } from './session';
import { countStreamedCards, partialReply } from './client';
import { estimateCost } from './models';
import { parseImport } from '../db/import';

const card = (front: string, back: string) => ({ type: 'basic', front, back, note: '', text: '', extra: '', reverse: false });

describe('model output', () => {
  it('normalises valid output and caps the batch size', () => {
    const many = Array.from({ length: 70 }, (_, i) => card(`w${i}`, `m${i}`));
    const out = normalizeOutput({ reply: 'ok', action: 'replace', deck: ' English::TOEIC ', tags: ['toeic'], cards: many, suggestions: ['a', 'b', 'c', 'd', 'e'] });
    expect(out?.cards.length).toBe(MAX_CARDS_PER_BATCH);
    expect(out?.deck).toBe('English::TOEIC');
    expect(out?.suggestions.length).toBe(4);
  });

  it('rejects malformed output and drops cards for action none', () => {
    expect(normalizeOutput({ reply: 'x' })).toBeNull();
    expect(normalizeOutput({ reply: 'x', action: 'none', deck: '', tags: [], cards: [card('a', 'b')], suggestions: [] })?.cards).toEqual([]);
  });

  it('every schema object forbids extra properties (structured outputs requirement)', () => {
    expect(CARD_SET_SCHEMA.additionalProperties).toBe(false);
    expect(CARD_SET_SCHEMA.properties.cards.items.additionalProperties).toBe(false);
  });

  it('keeps the system prompt free of volatile content so it can be cached', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(SYSTEM_PROMPT).toContain('Minimum Information Principle');
  });

  it('external prompt asks for JSON the importer can read', () => {
    const p = externalPrompt('TOEIC finance');
    expect(p).toContain('TOEIC finance');
    expect(p).toContain('```json');
    const sample = /\{"deck".*\}\]\}/.exec(p)![0];
    expect(parseImport(sample).items.length).toBe(2);
  });
});

describe('draft and turns', () => {
  it('applies replace, append and none', () => {
    const base = emptyDraft();
    const r = applyOutput(base, { reply: '', action: 'replace', deck: 'D', tags: ['t'], cards: [card('a', '1') as never], suggestions: [] });
    expect(r.cards.length).toBe(1);
    const a = applyOutput(r, { reply: '', action: 'append', deck: '', tags: [], cards: [card('b', '2') as never], suggestions: [] });
    expect(a.cards.map((c) => c.front)).toEqual(['a', 'b']);
    expect(a.deck).toBe('D');
    const n = applyOutput(a, { reply: '', action: 'none', deck: 'X', tags: [], cards: [], suggestions: [] });
    expect(n).toMatchObject({ deck: 'D', cards: a.cards });
  });

  it('sends the draft only when it changed and replays assistant content unchanged', () => {
    let s = newSession();
    const first = makeUserMessage(s, { text: 'make cards', images: [], language: 'th', deckNames: ['English'] });
    expect(first.message.apiText).toContain('existing_decks: English');
    expect(first.message.apiText).toContain('ui_language: Thai');
    const content = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: '{}' }];
    s = {
      ...s,
      messages: [first.message, { id: 'a', role: 'assistant', text: 'ok', content, createdAt: 0 }],
      draft: { deck: 'D', tags: [], cards: [{ id: '1', ...card('a', 'b'), type: 'basic' }] },
    };
    s.draftSeen = describeDraft(s.draft);
    const second = makeUserMessage(s, { text: 'more', images: [], language: 'en', deckNames: ['English'] });
    expect(second.message.apiText).not.toContain('current_draft');
    expect(second.message.apiText).not.toContain('existing_decks');

    const edited = { ...s, draft: { ...s.draft, cards: [] } };
    expect(makeUserMessage(edited, { text: 'x', images: [], language: 'en', deckNames: [] }).message.apiText).toContain('current_draft: empty');

    const withNotice = { ...s, messages: [...s.messages, { id: 'n', role: 'notice' as const, text: 'imported', createdAt: 0 }] };
    const api = toApiMessages([...withNotice.messages, second.message]);
    expect(api.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(api[1].content).toBe(content);
  });

  it('puts images before text in user turns', () => {
    const s = newSession();
    const { message } = makeUserMessage(s, { text: '', images: [{ mediaType: 'image/jpeg', data: 'AAA' }], language: 'en', deckNames: [] });
    const [turn] = toApiMessages([message]);
    const blocks = turn.content as Array<{ type: string }>;
    expect(blocks.map((b) => b.type)).toEqual(['image', 'text']);
  });

  it('converts the draft into importable items', () => {
    const p = draftToParsed({
      deck: 'English',
      tags: ['x'],
      cards: [
        { id: '1', ...card('Revenue', 'รายได้'), type: 'basic' },
        { id: '2', type: 'cloze', front: '', back: '', note: '', text: 'V = {{c1::I}}R', extra: '', reverse: false },
        { id: '3', type: 'optionalReverse', front: 'a', back: 'b', note: '', text: '', extra: '', reverse: true },
        { id: '4', ...card('', 'missing'), type: 'basic' },
      ],
    });
    expect(p.items.map((i) => i.type)).toEqual(['basic', 'cloze', 'optionalReverse', 'basic']);
    expect(p.items[2].fields.addReverse).toBe('y');
    expect(p.items[3].error).toBe('front_missing');
  });
});

describe('streaming helpers and cost', () => {
  it('reads the partial reply and counts streamed cards', () => {
    const partial = '{"reply":"Here are \\"20\\" cards","action":"replace","deck":"D","tags":[],"cards":[{"type":"basic","front":"a"},{"type":"cl';
    expect(partialReply(partial)).toBe('Here are "20" cards');
    expect(countStreamedCards(partial)).toBe(2);
    expect(partialReply('{"rep')).toBe('');
  });

  it('estimates cost from usage', () => {
    expect(estimateCost('claude-sonnet-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeCloseTo(2);
    expect(estimateCost('claude-sonnet-5-5', { input: 0, output: 100_000, cacheRead: 1_000_000, cacheWrite: 0 })).toBeCloseTo(1.2);
  });
});
