/**
 * System prompt and output schema for the card-writing assistant.
 * Keep SYSTEM_PROMPT byte-stable: it is the cached prefix of every request.
 * Anything that changes per turn (decks, current draft, UI language) goes in the user turn.
 */
import type { Language } from '../db/types';

export const AI_CARD_TYPES = ['basic', 'reverse', 'optionalReverse', 'typein', 'cloze'] as const;
export type AiCardType = (typeof AI_CARD_TYPES)[number];

/** Hard cap the prompt asks for and the client enforces per response. */
export const MAX_CARDS_PER_BATCH = 50;

const RULES = `Card-writing rules (SuperMemo "20 rules", Minimum Information Principle):
1. One card = one fact. Keep the answer as short as possible (ideally 1-5 words). Never put a list or several facts on one card.
2. Lists and enumerations: split them into separate cards, or use cloze deletions with one cloze number per item.
3. Prefer cloze deletions for definitions, formulas, laws, processes, and example sentences. Each {{cN::...}} becomes its own card, so use c1, c2, ... for things that should be asked separately and the same number only for things that must be recalled together.
4. Give context so each card has exactly one correct answer: add a short cue on the front (e.g. part of speech, field, "(verb)", "(finance)") when the word or concept is ambiguous.
5. Put an example sentence, mnemonic, or short explanation in "note" (shown after the answer). Keep it to one or two sentences.
6. Do not invent facts. If you are unsure about something, leave it out and say so in "reply". For engineering and science, include units and state assumptions; use LaTeX math between $...$ (inline) or $$...$$ (block).
7. Avoid near-duplicates within the set and against the current draft.`;

const TYPES = `Card types (field "type"):
- "basic": front -> back. Default.
- "reverse": front -> back AND back -> front. Use for vocabulary only when the learner wants to practise both directions.
- "optionalReverse": like basic; set "reverse": true to also create the back -> front card.
- "typein": the learner types the answer, compared letter by letter. Use for spelling practice; keep "back" to the exact word or short phrase.
- "cloze": put the whole sentence in "text" with {{c1::answer}} or {{c1::answer::hint}}; optional "extra" is shown after the answer. Leave front/back empty.
For every card, fill unused string fields with "" and set "reverse" to false unless it is an optionalReverse card that should get a reverse card.
Supported formatting in any field: **bold**, *italic*, "- " bullet lists, line breaks, images as ![](https://...), math as $...$ / $$...$$. No HTML.`;

const LANGUAGE = `Languages: the learner is a Thai speaker. Default for vocabulary: English word or phrase on the front, Thai meaning on the back, an English example sentence in "note". For other subjects, write questions in the language the learner uses unless they ask otherwise. Write "reply" and "suggestions" in the language given as ui_language in <app_context>.`;

const OUTPUT = `Output: every response is one JSON object matching the schema.
- "reply": a short chat message to the learner (1-4 sentences, plain text, no JSON, no card list). Say what you made and anything they should check. If the request is too big for one batch, say how you split it.
- "action":
  - "replace": the cards you return become the whole draft (new set, regenerated set, or the full draft after edits the learner asked for such as "change card 3" or "make them shorter").
  - "append": the cards you return are added to the current draft (e.g. "add 10 more", "continue"). Return only the new cards.
  - "none": no change to the draft (answering a question, asking a clarifying question). Return an empty "cards" array.
- At most ${MAX_CARDS_PER_BATCH} cards per response. If the learner asks for more, make the first ${MAX_CARDS_PER_BATCH}, tell them to say "continue" for the next batch, and suggest splitting big topics into sub-decks.
- "deck": the deck name for the draft. Use "::" for sub-decks, e.g. "English::TOEIC::Finance". Reuse an existing deck name from <app_context> when the topic fits one.
- "tags": 1-4 short lowercase tags without spaces (use "-"), e.g. ["toeic", "finance"].
- "suggestions": 2-4 short follow-up commands the learner could tap next, e.g. "Add 10 more", "Add example sentences".
When the request is vague, make a reasonable small set (about 10 cards) right away and offer refinements in "suggestions" rather than only asking questions. If the learner attaches photos (textbook pages, word lists, slides), build cards from their content.`;

export const SYSTEM_PROMPT = `You are the flashcard assistant inside "Forget Me Not", a spaced-repetition app (similar to Anki). You turn what the learner asks for, pastes, or photographs into high-quality flashcards. The learner reviews the draft in the app, can edit or delete cards, and imports them into a deck.

${RULES}

${TYPES}

${LANGUAGE}

${OUTPUT}`;

/** Prompt for the copy-and-paste fallback (used in another Claude app without an API key). */
export function externalPrompt(request: string): string {
  return `${SYSTEM_PROMPT.split('\n\nOutput:')[0]}

Output format: reply with ONLY one JSON object in a \`\`\`json code block, in this shape:
{"deck": "English::TOEIC::Finance", "tags": ["toeic"], "cards": [{"type": "basic", "front": "...", "back": "...", "note": "..."}, {"type": "cloze", "text": "... {{c1::...}} ...", "extra": "..."}]}
At most ${MAX_CARDS_PER_BATCH} cards. Write the explanations for me in Thai.

My request:
${request.trim()}`;
}

const str = { type: 'string' } as const;

export const CARD_SET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'action', 'deck', 'tags', 'cards', 'suggestions'],
  properties: {
    reply: str,
    action: { type: 'string', enum: ['replace', 'append', 'none'] },
    deck: str,
    tags: { type: 'array', items: str },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'front', 'back', 'note', 'text', 'extra', 'reverse'],
        properties: {
          type: { type: 'string', enum: [...AI_CARD_TYPES] },
          front: str,
          back: str,
          note: str,
          text: str,
          extra: str,
          reverse: { type: 'boolean' },
        },
      },
    },
    suggestions: { type: 'array', items: str },
  },
} as const;

export interface AiCard {
  type: AiCardType;
  front: string;
  back: string;
  note: string;
  text: string;
  extra: string;
  reverse: boolean;
}

export interface AiOutput {
  reply: string;
  action: 'replace' | 'append' | 'none';
  deck: string;
  tags: string[];
  cards: AiCard[];
  suggestions: string[];
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Validates and normalises the model's JSON (structured outputs guarantee shape, this guards the edges). */
export function normalizeOutput(raw: unknown): AiOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const action = o.action === 'replace' || o.action === 'append' || o.action === 'none' ? o.action : null;
  if (!action || !Array.isArray(o.cards)) return null;
  const cards: AiCard[] = o.cards
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      type: (AI_CARD_TYPES as readonly string[]).includes(s(c.type)) ? (s(c.type) as AiCardType) : 'basic',
      front: s(c.front),
      back: s(c.back),
      note: s(c.note),
      text: s(c.text),
      extra: s(c.extra),
      reverse: c.reverse === true,
    }))
    .slice(0, MAX_CARDS_PER_BATCH);
  return {
    reply: s(o.reply),
    action,
    deck: s(o.deck).trim(),
    tags: Array.isArray(o.tags) ? o.tags.map(s).filter(Boolean) : [],
    cards: action === 'none' ? [] : cards,
    suggestions: Array.isArray(o.suggestions) ? o.suggestions.map(s).filter(Boolean).slice(0, 4) : [],
  };
}

export interface DraftLike {
  deck: string;
  tags: string[];
  cards: Array<Pick<AiCard, 'front' | 'back' | 'note' | 'text' | 'extra' | 'reverse'> & { type: string }>;
}

const clip = (v: string, n = 160) => (v.length > n ? `${v.slice(0, n)}…` : v).replace(/\s+/g, ' ');

/** Compact text form of the draft so the model sees the learner's local edits. */
export function describeDraft(d: DraftLike): string {
  if (!d.cards.length) return 'current_draft: empty';
  const lines = d.cards.map((c, i) => {
    const body = c.type === 'cloze' ? `text: ${clip(c.text)}${c.extra ? ` | extra: ${clip(c.extra)}` : ''}` : `front: ${clip(c.front)} | back: ${clip(c.back)}${c.note ? ` | note: ${clip(c.note)}` : ''}`;
    return `${i + 1}. [${c.type}${c.reverse ? '+reverse' : ''}] ${body}`;
  });
  return `current_draft (deck "${d.deck}", tags ${JSON.stringify(d.tags)}, ${d.cards.length} cards):\n${lines.join('\n')}`;
}

/** Text of a user turn: the learner's words plus the volatile app context. */
export function buildUserText(opts: { text: string; language: Language; decks: string[]; draft: string | null; notice?: string }): string {
  const ctx = [`ui_language: ${opts.language === 'th' ? 'Thai' : 'English'}`];
  if (opts.decks.length) ctx.push(`existing_decks: ${opts.decks.slice(0, 200).join(', ')}`);
  if (opts.notice) ctx.push(opts.notice);
  if (opts.draft) ctx.push(opts.draft);
  return `<app_context>\n${ctx.join('\n')}\n</app_context>\n\n${opts.text.trim() || '(see attached images)'}`;
}
