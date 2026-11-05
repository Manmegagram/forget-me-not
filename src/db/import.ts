/**
 * JSON import: parse + validate -> detect duplicates -> commit.
 * Standard format:
 * { "deck": "TOEIC Finance", "tags": ["toeic"], "cards": [{ "front": "...", "back": "...", "note": "..." }] }
 * Optional per payload or per card: "type" (basic | reverse | optionalReverse | typein | cloze | imageOcclusion),
 * "reverse": true, "tags": [...]. Cloze cards use "text" (+ "extra"), image occlusion uses
 * "image", "masks" ([{x,y,w,h,label}] as fractions), "header", "extra".
 */
import { db } from './schema';
import { buildNote, cleanTags, ensureDeckPath, updateNote } from './repo';
import type { Card, Note, NoteFields, NoteType } from './types';
import { NOTE_TYPES } from './types';
import { cardOrds, clozeNumbers, noteChecksum } from '../cards/noteTypes';

export interface ImportItem {
  index: number;
  type: NoteType;
  fields: NoteFields;
  tags: string[];
  checksum: string;
  /** Problems that make this row unusable. */
  error?: string;
}

export interface ParsedImport {
  deck: string;
  tags: string[];
  items: ImportItem[];
  errors: string[];
}

type Json = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' ? v.split(/[,\s]+/).filter(Boolean) : [];

/** Pulls the first JSON object/array out of text (AI replies often wrap it in prose or ```json fences). */
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) return fenced[1].trim();
  const start = text.search(/[[{]/);
  if (start < 0) return text.trim();
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start).trim();
}

function inferType(card: Json, payloadType: NoteType | undefined, payloadReverse: boolean): NoteType {
  const t = str(card.type);
  if ((NOTE_TYPES as string[]).includes(t)) return t as NoteType;
  if (str(card.text) && clozeNumbers(str(card.text)).length) return 'cloze';
  if (str(card.image) && card.masks) return 'imageOcclusion';
  if (payloadType) return payloadType;
  if (card.reverse === true || payloadReverse) return 'reverse';
  return 'basic';
}

function fieldsFor(type: NoteType, card: Json): NoteFields {
  switch (type) {
    case 'cloze':
      return { text: str(card.text) || str(card.front), extra: str(card.extra) || str(card.note) || str(card.back) };
    case 'imageOcclusion':
      return {
        image: str(card.image),
        masks: typeof card.masks === 'string' ? card.masks : JSON.stringify(card.masks ?? []),
        header: str(card.header) || str(card.front),
        extra: str(card.extra) || str(card.note),
      };
    case 'optionalReverse':
      return { front: str(card.front), back: str(card.back), note: str(card.note), addReverse: card.reverse === false ? '' : 'y' };
    default:
      return { front: str(card.front), back: str(card.back), note: str(card.note) };
  }
}

function validate(type: NoteType, fields: NoteFields): string | undefined {
  if (type === 'cloze') return clozeNumbers(fields.text ?? '').length ? undefined : 'cloze_missing';
  if (type === 'imageOcclusion') return fields.image && cardOrds(type, fields).length ? undefined : 'occlusion_missing';
  if (!fields.front?.trim()) return 'front_missing';
  if (!fields.back?.trim()) return 'back_missing';
  return undefined;
}

/** Parses one payload object or an array of payloads (merged; first deck name wins). */
export function parseImport(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(extractJson(text));
  } catch {
    return { deck: '', tags: [], items: [], errors: ['invalid_json'] };
  }
  const payloads: Json[] = Array.isArray(data)
    ? data.every((d) => d && typeof d === 'object' && 'cards' in (d as Json))
      ? (data as Json[])
      : [{ cards: data }]
    : data && typeof data === 'object'
      ? [data as Json]
      : [];
  if (!payloads.length) return { deck: '', tags: [], items: [], errors: ['invalid_format'] };

  const items: ImportItem[] = [];
  const errors: string[] = [];
  let deck = '';
  let tags: string[] = [];
  for (const p of payloads) {
    if (!deck) deck = str(p.deck);
    if (!tags.length) tags = strArr(p.tags);
    const pType = (NOTE_TYPES as string[]).includes(str(p.type)) ? (str(p.type) as NoteType) : undefined;
    const cards = Array.isArray(p.cards) ? (p.cards as unknown[]) : [];
    if (!cards.length) errors.push('no_cards');
    for (const raw of cards) {
      if (!raw || typeof raw !== 'object') continue;
      const card = raw as Json;
      const type = inferType(card, pType, p.reverse === true);
      const fields = fieldsFor(type, card);
      const cardTags = cleanTags([...strArr(p.tags), ...strArr(card.tags)]);
      items.push({ index: items.length, type, fields, tags: cardTags, checksum: noteChecksum(type, fields), error: validate(type, fields) });
    }
  }
  return { deck: deck || 'Imported', tags: cleanTags(tags), items, errors };
}

export type DuplicateKind = 'none' | 'existing' | 'inBatch';

export interface DuplicateInfo {
  kind: DuplicateKind;
  existing?: Note;
}

export async function findDuplicates(items: ImportItem[]): Promise<DuplicateInfo[]> {
  const sums = [...new Set(items.map((i) => i.checksum).filter(Boolean))];
  const existing = sums.length ? await db.notes.where('checksum').anyOf(sums).toArray() : [];
  const byChecksum = new Map(existing.map((n) => [n.checksum, n]));
  const seen = new Set<string>();
  return items.map((i) => {
    const ex = byChecksum.get(i.checksum);
    if (ex) return { kind: 'existing', existing: ex };
    if (i.checksum && seen.has(i.checksum)) return { kind: 'inBatch' };
    seen.add(i.checksum);
    return { kind: 'none' };
  });
}

export type ImportDecision = 'add' | 'skip' | 'overwrite';

export interface CommitResult {
  deckId: string;
  added: number;
  updated: number;
  skipped: number;
  cards: number;
}

export async function commitImport(
  items: ImportItem[],
  decisions: ImportDecision[],
  dups: DuplicateInfo[],
  target: { deckId?: string; deckPath?: string },
): Promise<CommitResult> {
  const deckId = target.deckId ?? (await ensureDeckPath(target.deckPath ?? 'Imported')).id;
  const now = Date.now();
  const notes: Note[] = [];
  const cards: Card[] = [];
  const overwrites: Array<{ note: Note; item: ImportItem }> = [];
  let skipped = 0;
  items.forEach((item, i) => {
    const decision = item.error ? 'skip' : decisions[i] ?? 'add';
    if (decision === 'skip') {
      skipped++;
      return;
    }
    const dup = dups[i];
    if (decision === 'overwrite' && dup?.existing) {
      overwrites.push({ note: dup.existing, item });
      return;
    }
    const built = buildNote(deckId, { type: item.type, fields: item.fields, tags: item.tags }, now, i);
    notes.push(built.note);
    cards.push(...built.cards);
  });

  await db.transaction('rw', db.notes, db.cards, async () => {
    if (notes.length) await db.notes.bulkAdd(notes);
    if (cards.length) await db.cards.bulkAdd(cards);
  });
  for (const { note, item } of overwrites) {
    await updateNote(note.id, { fields: item.fields, type: item.type, tags: [...new Set([...note.tags, ...item.tags])] });
  }
  return { deckId, added: notes.length, updated: overwrites.length, skipped, cards: cards.length };
}
