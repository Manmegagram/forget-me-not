import type { CardState, Rating, ReviewKind, SchedulingInfo } from '../srs/types';

export type NoteType = 'basic' | 'reverse' | 'optionalReverse' | 'typein' | 'cloze' | 'imageOcclusion';

export const NOTE_TYPES: NoteType[] = ['basic', 'reverse', 'optionalReverse', 'typein', 'cloze', 'imageOcclusion'];

/**
 * Field names per note type:
 * - basic / reverse / optionalReverse / typein: front, back, note (+ addReverse = "y" for optionalReverse)
 * - cloze: text, extra
 * - imageOcclusion: image (URL or data URL), masks (JSON), header, extra
 */
export type NoteFields = Record<string, string>;

export interface Deck {
  id: string;
  name: string;
  parentId: string | null;
  configId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  deckId: string;
  type: NoteType;
  fields: NoteFields;
  tags: string[];
  /** Normalised first field, used for duplicate detection. */
  checksum: string;
  createdAt: number;
  updatedAt: number;
}

/** 0 = none, 1 red, 2 orange, 3 green, 4 blue, 5 pink, 6 turquoise, 7 purple (Anki colours). */
export type Flag = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Card extends SchedulingInfo {
  id: string;
  noteId: string;
  deckId: string;
  /** Which card of the note (reverse = 1, cloze c3 = 2, ...). */
  ord: number;
  flag: Flag;
  suspended: boolean;
  /** Epoch ms; card is hidden until then. 0 = not buried. */
  buriedUntil: number;
  leech: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  deckId: string;
  timestamp: number;
  rating: Rating;
  prevInterval: number;
  newInterval: number;
  prevEase: number;
  newEase: number;
  prevState: CardState;
  newState: CardState;
  timeTakenMs: number;
  type: ReviewKind;
  /** Full card before the answer, used for undo. */
  snapshot: Card;
  /** Siblings buried as a side effect of this answer (restored on undo). */
  buriedSiblings: string[];
  /** True when this answer added the leech tag. */
  leechAdded: boolean;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type Language = 'th' | 'en';

export interface Settings {
  key: 'app';
  language: Language;
  theme: ThemePref;
  dayStartHour: number;
  ttsVoiceFront: string;
  ttsVoiceBack: string;
  ttsRate: number;
  ttsAutoPlay: boolean;
  apiKey: string;
  aiModel: string;
  onboardingDone: boolean;
  lastBackupAt: number;
}

export function defaultSettings(): Settings {
  return {
    key: 'app',
    language: 'th',
    theme: 'system',
    dayStartHour: 4,
    ttsVoiceFront: '',
    ttsVoiceBack: '',
    ttsRate: 1,
    ttsAutoPlay: false,
    apiKey: '',
    aiModel: 'claude-sonnet-5-5',
    onboardingDone: false,
    lastBackupAt: 0,
  };
}
