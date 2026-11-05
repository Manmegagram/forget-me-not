import Dexie, { type Table } from 'dexie';
import type { DeckConfig } from '../srs/types';
import { defaultDeckConfig } from '../srs/config';
import type { Card, Deck, Note, ReviewLog, Settings } from './types';
import { defaultSettings } from './types';

export class ForgetMeNotDB extends Dexie {
  decks!: Table<Deck, string>;
  notes!: Table<Note, string>;
  cards!: Table<Card, string>;
  reviewLogs!: Table<ReviewLog, string>;
  configs!: Table<DeckConfig, string>;
  settings!: Table<Settings, string>;

  constructor(name = 'forget-me-not') {
    super(name);
    this.version(1).stores({
      decks: 'id, parentId, name',
      notes: 'id, deckId, checksum, *tags',
      cards: 'id, noteId, deckId, state, due, [deckId+state]',
      reviewLogs: 'id, cardId, deckId, timestamp',
      configs: 'id',
      settings: 'key',
    });
    this.on('populate', (tx) => {
      tx.table('configs').add(defaultDeckConfig());
      tx.table('settings').add(defaultSettings());
    });
  }
}

export const db = new ForgetMeNotDB();

/** Ask the browser not to evict our data (important on iOS). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
