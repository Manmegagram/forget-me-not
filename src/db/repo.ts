/**
 * Data access and mutations. All writes that touch several tables run in a
 * single Dexie transaction so the collection never ends up half-updated.
 */
import { db, uid } from './schema';
import type { Card, Deck, Flag, Note, NoteFields, NoteType, ReviewLog, Settings } from './types';
import { defaultSettings } from './types';
import { cardOrds, noteChecksum } from '../cards/noteTypes';
import {
  addStudyDays,
  DEFAULT_CONFIG_ID,
  defaultDeckConfig,
  getScheduler,
  newSchedulingInfo,
  normalizeConfig,
  type DeckConfig,
  type Rating,
} from '../srs';

// ---------- settings & configs ----------

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app');
  return { ...defaultSettings(), ...s };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, key: 'app' });
}

export async function getConfig(id: string): Promise<DeckConfig> {
  const c = await db.configs.get(id);
  if (c) return normalizeConfig(c);
  const d = await db.configs.get(DEFAULT_CONFIG_ID);
  return d ? normalizeConfig(d) : defaultDeckConfig();
}

export async function saveConfig(config: DeckConfig): Promise<void> {
  await db.configs.put(config);
}

export async function createConfig(name: string, base?: DeckConfig): Promise<DeckConfig> {
  const cfg = { ...(base ?? defaultDeckConfig()), id: uid(), name };
  await db.configs.add(cfg);
  return cfg;
}

export async function deleteConfig(id: string): Promise<void> {
  if (id === DEFAULT_CONFIG_ID) return;
  await db.transaction('rw', db.configs, db.decks, async () => {
    await db.decks.where('id').above('').modify((d) => {
      if (d.configId === id) d.configId = DEFAULT_CONFIG_ID;
    });
    await db.configs.delete(id);
  });
}

// ---------- decks ----------

export const DECK_SEPARATOR = '::';

/** Finds or creates a deck by full path, e.g. "English::TOEIC::Finance". */
export async function ensureDeckPath(path: string): Promise<Deck> {
  const parts = path.split(DECK_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) parts.push('Default');
  let parentId: string | null = null;
  let deck: Deck | undefined;
  for (const name of parts) {
    const siblings: Deck[] = await db.decks.where('name').equals(name).toArray();
    deck = siblings.find((d) => d.parentId === parentId);
    if (!deck) {
      const now = Date.now();
      deck = { id: uid(), name, parentId, configId: DEFAULT_CONFIG_ID, createdAt: now, updatedAt: now };
      await db.decks.add(deck);
    }
    parentId = deck.id;
  }
  return deck!;
}

export async function createDeck(name: string, parentId: string | null = null): Promise<Deck> {
  const now = Date.now();
  let configId = DEFAULT_CONFIG_ID;
  if (parentId) configId = (await db.decks.get(parentId))?.configId ?? DEFAULT_CONFIG_ID;
  const deck: Deck = { id: uid(), name: name.trim() || 'Deck', parentId, configId, createdAt: now, updatedAt: now };
  await db.decks.add(deck);
  return deck;
}

export async function renameDeck(id: string, name: string): Promise<void> {
  await db.decks.update(id, { name: name.trim(), updatedAt: Date.now() });
}

export async function moveDeck(id: string, parentId: string | null): Promise<void> {
  if (id === parentId) return;
  // Prevent moving a deck under its own descendant.
  if (parentId && (await descendantDeckIds(id)).includes(parentId)) return;
  await db.decks.update(id, { parentId, updatedAt: Date.now() });
}

export async function setDeckConfig(id: string, configId: string, includeChildren = false): Promise<void> {
  const ids = includeChildren ? await descendantDeckIds(id) : [id];
  await db.decks.where('id').anyOf(ids).modify({ configId });
}

/** The deck itself plus every sub-deck. */
export async function descendantDeckIds(id: string): Promise<string[]> {
  const all = await db.decks.toArray();
  return collectDescendants(id, all);
}

export function collectDescendants(id: string, all: Deck[]): string[] {
  const byParent = new Map<string | null, Deck[]>();
  for (const d of all) {
    const list = byParent.get(d.parentId) ?? [];
    list.push(d);
    byParent.set(d.parentId, list);
  }
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const child of byParent.get(cur) ?? []) stack.push(child.id);
  }
  return out;
}

export function deckFullName(id: string, all: Deck[]): string {
  const byId = new Map(all.map((d) => [d.id, d]));
  const parts: string[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 50) {
    parts.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parts.join(DECK_SEPARATOR);
}

export async function deleteDeck(id: string): Promise<void> {
  const ids = await descendantDeckIds(id);
  await db.transaction('rw', [db.decks, db.notes, db.cards, db.reviewLogs], async () => {
    const cardIds = await db.cards.where('deckId').anyOf(ids).primaryKeys();
    await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
    await db.cards.where('deckId').anyOf(ids).delete();
    await db.notes.where('deckId').anyOf(ids).delete();
    await db.decks.bulkDelete(ids);
  });
}

// ---------- notes & cards ----------

export interface NewNoteInput {
  type: NoteType;
  fields: NoteFields;
  tags: string[];
}

function makeCard(noteId: string, deckId: string, ord: number, now: number): Card {
  return {
    ...newSchedulingInfo(now),
    id: uid(),
    noteId,
    deckId,
    ord,
    flag: 0,
    suspended: false,
    buriedUntil: 0,
    leech: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().replace(/\s+/g, '_').toLowerCase()).filter(Boolean))];
}

/** Builds note + cards without writing them (used by bulk import). */
export function buildNote(deckId: string, input: NewNoteInput, now: number, offset = 0): { note: Note; cards: Card[] } {
  const note: Note = {
    id: uid(),
    deckId,
    type: input.type,
    fields: input.fields,
    tags: cleanTags(input.tags),
    checksum: noteChecksum(input.type, input.fields),
    createdAt: now + offset,
    updatedAt: now + offset,
  };
  // createdAt offset keeps the import order for new-card ordering.
  const cards = cardOrds(input.type, input.fields).map((ord) => makeCard(note.id, deckId, ord, now + offset));
  return { note, cards };
}

export async function addNote(deckId: string, input: NewNoteInput): Promise<Note> {
  const { note, cards } = buildNote(deckId, input, Date.now());
  await db.transaction('rw', db.notes, db.cards, async () => {
    await db.notes.add(note);
    await db.cards.bulkAdd(cards);
  });
  return note;
}

/** Updates a note and adds/removes cards when ordinals change (e.g. a new cloze). */
export async function updateNote(noteId: string, patch: { fields?: NoteFields; tags?: string[]; type?: NoteType; deckId?: string }): Promise<void> {
  await db.transaction('rw', db.notes, db.cards, db.reviewLogs, async () => {
    const note = await db.notes.get(noteId);
    if (!note) return;
    const now = Date.now();
    const next: Note = {
      ...note,
      ...patch,
      fields: patch.fields ?? note.fields,
      tags: patch.tags ? cleanTags(patch.tags) : note.tags,
      updatedAt: now,
    };
    next.checksum = noteChecksum(next.type, next.fields);
    await db.notes.put(next);

    const existing = await db.cards.where('noteId').equals(noteId).toArray();
    const wanted = new Set(cardOrds(next.type, next.fields));
    const have = new Set(existing.map((c) => c.ord));
    const toAdd = [...wanted].filter((o) => !have.has(o)).map((o) => makeCard(noteId, next.deckId, o, now));
    const toRemove = existing.filter((c) => !wanted.has(c.ord)).map((c) => c.id);
    if (toAdd.length) await db.cards.bulkAdd(toAdd);
    if (toRemove.length) {
      await db.reviewLogs.where('cardId').anyOf(toRemove).delete();
      await db.cards.bulkDelete(toRemove);
    }
    if (patch.deckId && patch.deckId !== note.deckId) {
      await db.cards.where('noteId').equals(noteId).modify({ deckId: patch.deckId, updatedAt: now });
    }
  });
}

export async function deleteNote(noteId: string): Promise<void> {
  await db.transaction('rw', db.notes, db.cards, db.reviewLogs, async () => {
    const cardIds = await db.cards.where('noteId').equals(noteId).primaryKeys();
    await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
    await db.cards.bulkDelete(cardIds);
    await db.notes.delete(noteId);
  });
}

export async function setSuspended(cardIds: string[], suspended: boolean): Promise<void> {
  await db.cards.where('id').anyOf(cardIds).modify({ suspended, updatedAt: Date.now() });
}

export async function buryCards(cardIds: string[], dayStartHour: number): Promise<void> {
  const until = addStudyDays(Date.now(), 1, dayStartHour);
  await db.cards.where('id').anyOf(cardIds).modify({ buriedUntil: until, updatedAt: Date.now() });
}

export async function unburyCards(cardIds: string[]): Promise<void> {
  await db.cards.where('id').anyOf(cardIds).modify({ buriedUntil: 0, updatedAt: Date.now() });
}

export async function setFlag(cardIds: string[], flag: Flag): Promise<void> {
  await db.cards.where('id').anyOf(cardIds).modify({ flag, updatedAt: Date.now() });
}

/** Back to a brand-new card. Review history is kept for statistics. */
export async function resetCards(cardIds: string[]): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.cards, db.notes, async () => {
    const cards = await db.cards.where('id').anyOf(cardIds).toArray();
    await db.cards.bulkPut(
      cards.map((c) => ({ ...c, ...newSchedulingInfo(now), suspended: false, buriedUntil: 0, leech: false, updatedAt: now })),
    );
    const noteIds = [...new Set(cards.map((c) => c.noteId))];
    await db.notes.where('id').anyOf(noteIds).modify((n) => {
      n.tags = n.tags.filter((t) => t !== 'leech');
    });
  });
}

/** Set cards due in `days` days as review cards (Anki "Set due date"). */
export async function rescheduleCards(cardIds: string[], days: number, dayStartHour: number): Promise<void> {
  const now = Date.now();
  const due = addStudyDays(now, Math.max(0, Math.round(days)), dayStartHour);
  await db.cards.where('id').anyOf(cardIds).modify((c) => {
    if (c.state === 'new' || c.ease === 0) c.ease = 2.5;
    c.state = 'review';
    c.learningStep = -1;
    c.interval = Math.max(1, Math.round(days));
    c.due = due;
    c.updatedAt = now;
  });
}

export async function deleteCards(cardIds: string[]): Promise<void> {
  await db.transaction('rw', db.cards, db.notes, db.reviewLogs, async () => {
    const cards = await db.cards.where('id').anyOf(cardIds).toArray();
    await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
    await db.cards.bulkDelete(cardIds);
    // Remove notes that no longer have any card.
    for (const noteId of new Set(cards.map((c) => c.noteId))) {
      if ((await db.cards.where('noteId').equals(noteId).count()) === 0) await db.notes.delete(noteId);
    }
  });
}

// ---------- answering ----------

export interface AnswerOptions {
  card: Card;
  rating: Rating;
  timeTakenMs: number;
  config: DeckConfig;
  dayStartHour: number;
  /** Cram / preview: log the answer but do not change scheduling. */
  cram?: boolean;
  now?: number;
}

export async function answerCard(opts: AnswerOptions): Promise<{ card: Card; log: ReviewLog }> {
  const now = opts.now ?? Date.now();
  const { card, rating, config } = opts;

  if (opts.cram) {
    const log: ReviewLog = {
      id: uid(), cardId: card.id, deckId: card.deckId, timestamp: now, rating,
      prevInterval: card.interval, newInterval: card.interval, prevEase: card.ease, newEase: card.ease,
      prevState: card.state, newState: card.state, timeTakenMs: opts.timeTakenMs, type: 'cram',
      snapshot: card, buriedSiblings: [], leechAdded: false,
    };
    await db.reviewLogs.add(log);
    return { card, log };
  }

  const result = getScheduler().answer(card, rating, config, { now, dayStartHour: opts.dayStartHour, fuzzSeed: card.id });
  const updated: Card = { ...card, ...result.card, updatedAt: now };
  let leechAdded = false;

  return db.transaction('rw', db.cards, db.notes, db.reviewLogs, async () => {
    if (result.becameLeech) {
      updated.leech = true;
      if (config.leechAction === 'suspend') updated.suspended = true;
      const note = await db.notes.get(card.noteId);
      if (note && !note.tags.includes('leech')) {
        await db.notes.update(note.id, { tags: [...note.tags, 'leech'], updatedAt: now });
        leechAdded = true;
      }
    }
    await db.cards.put(updated);

    // Bury siblings until tomorrow (Anki behaviour).
    const buried: string[] = [];
    if (config.buryNewSiblings || config.buryReviewSiblings) {
      const until = addStudyDays(now, 1, opts.dayStartHour);
      const siblings = await db.cards.where('noteId').equals(card.noteId).toArray();
      for (const s of siblings) {
        if (s.id === card.id || s.suspended || s.buriedUntil > now) continue;
        const isNew = s.state === 'new';
        const isReviewDue = s.state === 'review' && s.due < until;
        if ((isNew && config.buryNewSiblings) || (isReviewDue && config.buryReviewSiblings)) {
          buried.push(s.id);
        }
      }
      if (buried.length) await db.cards.where('id').anyOf(buried).modify({ buriedUntil: until });
    }

    const log: ReviewLog = {
      id: uid(),
      cardId: card.id,
      deckId: card.deckId,
      timestamp: now,
      rating,
      prevInterval: card.interval,
      newInterval: result.newInterval,
      prevEase: card.ease,
      newEase: updated.ease,
      prevState: card.state,
      newState: updated.state,
      timeTakenMs: Math.min(opts.timeTakenMs, 60_000 * 5),
      type: result.kind,
      snapshot: card,
      buriedSiblings: buried,
      leechAdded,
    };
    await db.reviewLogs.add(log);
    return { card: updated, log };
  });
}

/** Reverts an answer: restores the card, un-buries siblings, removes the log. */
export async function undoAnswer(logId: string): Promise<Card | null> {
  return db.transaction('rw', db.cards, db.notes, db.reviewLogs, async () => {
    const log = await db.reviewLogs.get(logId);
    if (!log) return null;
    if (log.type !== 'cram') await db.cards.put(log.snapshot);
    if (log.buriedSiblings.length) await db.cards.where('id').anyOf(log.buriedSiblings).modify({ buriedUntil: 0 });
    if (log.leechAdded) {
      const note = await db.notes.get(log.snapshot.noteId);
      if (note) await db.notes.update(note.id, { tags: note.tags.filter((t) => t !== 'leech') });
    }
    await db.reviewLogs.delete(logId);
    return log.snapshot;
  });
}
