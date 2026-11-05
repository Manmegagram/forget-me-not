import { useState, type ReactNode } from 'react';
import type { Deck } from '../db/types';
import type { DeckCounts } from '../db/queue';
import { IconChevron } from '../ui/icons';
import { useT } from '../i18n';

const COLLAPSE_KEY = 'fmn.collapsed';

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function Counts({ c }: { c?: DeckCounts }) {
  const { t } = useT();
  const v = c ?? { new: 0, learn: 0, review: 0 };
  return (
    <span className="counts" aria-label={`${t('new')} ${v.new}, ${t('learning')} ${v.learn}, ${t('review')} ${v.review}`}>
      <span className={v.new ? 'c-new' : 'c-zero'}>{v.new}</span>
      <span className={v.learn ? 'c-learn' : 'c-zero'}>{v.learn}</span>
      <span className={v.review ? 'c-review' : 'c-zero'}>{v.review}</span>
    </span>
  );
}

export function DeckTree({
  decks,
  counts,
  onOpen,
  trailing,
}: {
  decks: Deck[];
  counts?: Map<string, DeckCounts>;
  onOpen: (deck: Deck) => void;
  trailing?: (deck: Deck) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const children = new Map<string | null, Deck[]>();
  for (const d of decks) {
    const list = children.get(d.parentId) ?? [];
    list.push(d);
    children.set(d.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  };

  const rows: ReactNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const d of children.get(parent) ?? []) {
      const kids = children.get(d.id) ?? [];
      const open = !collapsed.has(d.id);
      rows.push(
        <div key={d.id} className="deck-row" style={{ paddingLeft: 8 + depth * 18 }}>
          {kids.length ? (
            <button className="disclosure" aria-expanded={open} aria-label={d.name} onClick={() => toggle(d.id)}>
              <IconChevron />
            </button>
          ) : (
            <span style={{ width: 32, flex: 'none' }} />
          )}
          <button className="deck-name" onClick={() => onOpen(d)}>{d.name}</button>
          <Counts c={counts?.get(d.id)} />
          {trailing?.(d)}
        </div>,
      );
      if (kids.length && open) walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return <div className="glass list" role="list">{rows}</div>;
}
