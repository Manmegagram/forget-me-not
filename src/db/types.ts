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
  /** Running estimate of what the AI chat has cost on this device (USD). */
  aiSpentUsd: number;
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
    aiSpentUsd: 0,
  };
}

/* ---------- AI chat ---------- */

export interface ChatImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** Base64 without the data: prefix. */
  data: string;
}

export interface DraftCard {
  id: string;
  type: NoteType;
  front: string;
  back: string;
  note: string;
  text: string;
  extra: string;
  reverse: boolean;
}

export interface ChatDraft {
  deck: string;
  tags: string[];
  cards: DraftCard[];
}

export interface ChatUsage {
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface ChatMessage {
  id: string;
  /** "notice" lines are local only (e.g. "12 cards imported") and are never sent to the API. */
  role: 'user' | 'assistant' | 'notice';
  /** What the learner sees in the bubble. */
  text: string;
  createdAt: number;
  /** user: the exact text sent to the API (learner text + app context). */
  apiText?: string;
  images?: ChatImage[];
  /** assistant: raw content blocks, replayed unchanged so thinking blocks stay valid. */
  content?: unknown[];
  action?: 'replace' | 'append' | 'none';
  cardCount?: number;
  suggestions?: string[];
  usage?: ChatUsage;
  /** assistant: the draft before this turn was applied (used by "regenerate"). */
  prevDraft?: ChatDraft;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  draft: ChatDraft;
  /** Fingerprint of the draft as the model last saw it; context is resent only when it changes. */
  draftSeen: string;
  /** Pending one-off context for the next turn (e.g. that the draft was imported). */
  pendingNotice: string;
  createdAt: number;
  updatedAt: number;
}
