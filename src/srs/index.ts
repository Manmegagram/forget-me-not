import { sm2Scheduler } from './sm2';
import type { Scheduler } from './types';

export * from './types';
export * from './time';
export * from './config';
export { sm2Scheduler, newSchedulingInfo, applyFuzz, fuzzRange, reviewIntervals } from './sm2';

/** Registry so another algorithm (e.g. FSRS) can be plugged in later. */
const schedulers: Record<string, Scheduler> = { sm2: sm2Scheduler };

export function getScheduler(id = 'sm2'): Scheduler {
  return schedulers[id] ?? sm2Scheduler;
}
