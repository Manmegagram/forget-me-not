import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from './db/schema';
import { defaultSettings, type Deck, type Settings } from './db/types';
import { gatherQueue, type DeckCounts } from './db/queue';
import { normalizeConfig, type DeckConfig } from './srs';

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('app'), []);
  return { ...defaultSettings(), ...s };
}

export function useDecks(): Deck[] | undefined {
  return useLiveQuery(() => db.decks.toArray(), []);
}

export function useConfigs(): DeckConfig[] {
  return useLiveQuery(async () => (await db.configs.toArray()).map(normalizeConfig), []) ?? [];
}

/** Re-renders every `ms` so time-based values (due counts) stay fresh. */
export function useTick(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    const onVis = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms]);
  return now;
}

/** Due counts for every deck (live: updates when cards or logs change). */
export function useDeckCounts(dayStartHour: number): Map<string, DeckCounts> | undefined {
  const now = useTick();
  return useLiveQuery(
    async () => (await gatherQueue({ now: Date.now(), dayStartHour, rootDeckId: null })).counts,
    [dayStartHour, now],
  );
}

/** Applies theme + reports the app badge (iOS 16.4+ Home Screen apps support it). */
export function applyTheme(theme: Settings['theme']) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#070b1a' : '#e9f1ff');
}

export function setAppBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) void nav.setAppBadge?.(count);
    else void nav.clearAppBadge?.();
  } catch {
    /* unsupported */
  }
}
