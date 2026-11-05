/**
 * Core SRS types. This module has no dependency on storage or UI so the
 * scheduling algorithm can be tested in isolation and swapped (e.g. FSRS).
 */

export type CardState = 'new' | 'learning' | 'review' | 'relearning';

/** 1 = Again, 2 = Hard, 3 = Good, 4 = Easy */
export type Rating = 1 | 2 | 3 | 4;

export type ReviewKind = 'learn' | 'review' | 'relearn' | 'cram' | 'manual';

export type NewReviewOrder = 'reviewsFirst' | 'newFirst' | 'mixed';

/** The scheduling-relevant part of a card. */
export interface SchedulingInfo {
  state: CardState;
  /** Epoch ms. For review cards this is the start of the due day. */
  due: number;
  /** Days. 0 for new / learning cards that never graduated. */
  interval: number;
  /** Ease factor as a ratio, e.g. 2.5 = 250%. */
  ease: number;
  reps: number;
  lapses: number;
  /** Index into learn/relearn steps; -1 when not in a step. */
  learningStep: number;
}

export interface DeckConfig {
  id: string;
  name: string;
  /** Minutes. */
  learnSteps: number[];
  /** Days. */
  graduatingInterval: number;
  /** Days. */
  easyInterval: number;
  /** Minutes. */
  relearnSteps: number[];
  /** Days. Minimum interval after a lapse. */
  minLapseInterval: number;
  /** Multiplier applied to the old interval on lapse (Anki "New interval", default 0). */
  lapseIntervalMultiplier: number;
  startingEase: number;
  easyBonus: number;
  hardIntervalFactor: number;
  intervalModifier: number;
  maxInterval: number;
  easeAgainDelta: number;
  easeHardDelta: number;
  easeEasyDelta: number;
  minEase: number;
  newPerDay: number;
  reviewsPerDay: number;
  leechThreshold: number;
  leechAction: 'suspend' | 'tagOnly';
  fuzz: boolean;
  newReviewOrder: NewReviewOrder;
  /** Show learning cards before everything else. */
  learningFirst: boolean;
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
  /** Minutes: learning cards due within this window are shown early when nothing else is left. */
  learnAheadMinutes: number;
}

export interface AnswerResult {
  card: SchedulingInfo;
  /** Days, 0 if the card is (re)learning. */
  newInterval: number;
  kind: ReviewKind;
  /** True when the card just crossed the leech threshold. */
  becameLeech: boolean;
}

/** Context needed to schedule an answer. Kept explicit for testability. */
export interface ScheduleContext {
  now: number;
  /** Hour of the local day when a new study day begins (default 4). */
  dayStartHour: number;
  /** Stable seed so the preview shown on buttons equals the applied interval. */
  fuzzSeed: string;
}

/** Pluggable algorithm interface so FSRS can be added later. */
export interface Scheduler {
  readonly id: string;
  answer(card: SchedulingInfo, rating: Rating, config: DeckConfig, ctx: ScheduleContext): AnswerResult;
  /** Delay in ms until the card would next be shown, for each button. */
  preview(card: SchedulingInfo, config: DeckConfig, ctx: ScheduleContext): Record<Rating, number>;
}
