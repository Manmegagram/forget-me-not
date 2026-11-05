import { createContext, useContext, type ReactNode } from 'react';
import type { Language } from '../db/types';
import { en, th, type StringKey } from './strings';

export type Translate = (key: StringKey, vars?: Record<string, string | number>) => string;

export function makeT(lang: Language): Translate {
  const dict: Record<StringKey, string> = lang === 'th' ? th : en;
  return (key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

const I18nContext = createContext<{ lang: Language; t: Translate }>({ lang: 'th', t: makeT('th') });

export function I18nProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  return <I18nContext.Provider value={{ lang, t: makeT(lang) }}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}

export type { StringKey };
