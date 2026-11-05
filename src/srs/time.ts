export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Start (epoch ms) of the study day that contains `ts`, in local time.
 * A study day begins at `dayStartHour` (e.g. 04:00), like Anki.
 */
export function studyDayStart(ts: number, dayStartHour: number): number {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayStartHour, 0, 0, 0);
  if (d.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
  return start.getTime();
}

/** Start of the study day `days` after the day containing `ts` (DST-safe). */
export function addStudyDays(ts: number, days: number, dayStartHour: number): number {
  const start = new Date(studyDayStart(ts, dayStartHour));
  start.setDate(start.getDate() + days);
  return start.getTime();
}

/** Whole study days between the days containing `a` and `b` (b - a). */
export function studyDaysBetween(a: number, b: number, dayStartHour: number): number {
  const da = new Date(studyDayStart(a, dayStartHour));
  const db = new Date(studyDayStart(b, dayStartHour));
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / DAY);
}

/** Stable key like "2026-11-05" for the study day containing `ts`. */
export function studyDayKey(ts: number, dayStartHour: number): string {
  const d = new Date(studyDayStart(ts, dayStartHour));
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Compact Anki-like label for a delay: 45s, 10m, 3h, 4d, 1.5mo, 2.1y */
export function formatDelay(ms: number): string {
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${trim(ms / HOUR)}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${trim(days / 30)}mo`;
  return `${trim(days / 365)}y`;
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
