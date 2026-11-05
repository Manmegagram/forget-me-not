import type { DeckConfig } from './types';

export const DEFAULT_CONFIG_ID = 'default';

/** Defaults follow the spec (Anki-style SM-2). */
export function defaultDeckConfig(id = DEFAULT_CONFIG_ID, name = 'Default'): DeckConfig {
  return {
    id,
    name,
    learnSteps: [1, 10],
    graduatingInterval: 1,
    easyInterval: 4,
    relearnSteps: [10],
    minLapseInterval: 1,
    lapseIntervalMultiplier: 0,
    startingEase: 2.5,
    easyBonus: 1.3,
    hardIntervalFactor: 1.2,
    intervalModifier: 1.0,
    maxInterval: 36500,
    easeAgainDelta: -0.2,
    easeHardDelta: -0.15,
    easeEasyDelta: 0.15,
    minEase: 1.3,
    newPerDay: 20,
    reviewsPerDay: 200,
    leechThreshold: 8,
    leechAction: 'suspend',
    fuzz: true,
    newReviewOrder: 'reviewsFirst',
    learningFirst: true,
    buryNewSiblings: true,
    buryReviewSiblings: true,
    learnAheadMinutes: 20,
  };
}

/** Fill any missing keys (e.g. after an app update adds a new option). */
export function normalizeConfig(partial: Partial<DeckConfig> & { id: string }): DeckConfig {
  return { ...defaultDeckConfig(partial.id, partial.name ?? 'Preset'), ...partial };
}
