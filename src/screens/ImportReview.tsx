import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Deck } from '../db/types';
import { commitImport, findDuplicates, type DuplicateInfo, type ImportDecision, type ParsedImport } from '../db/import';
import { cardOrds } from '../cards/noteTypes';
import { toPlainText } from '../cards/markdown';
import { deckFullName } from '../db/repo';
import { useT, type StringKey } from '../i18n';
import { useToast } from '../ui/components';

const NEW_DECK = '__new__';

export interface ImportOutcome {
  deckId: string;
  deckName: string;
  added: number;
  updated: number;
  skipped: number;
  cards: number;
}

/**
 * Preview table + target deck + tags + per-row duplicate decisions + import.
 * Shared by the JSON import sheet and the AI chat draft review.
 */
export function ImportReview({
  parsed,
  decks,
  onCancel,
  cancelLabel,
  onImported,
  rowActions,
  afterTable,
}: {
  parsed: ParsedImport;
  decks: Deck[];
  onCancel: () => void;
  cancelLabel?: string;
  onImported: (r: ImportOutcome) => void;
  /** Extra controls per row (edit / delete in the chat review). */
  rowActions?: (index: number) => ReactNode;
  afterTable?: ReactNode;
}) {
  const { t } = useT();
  const toast = useToast();
  const [dups, setDups] = useState<DuplicateInfo[]>([]);
  const [decisions, setDecisions] = useState<ImportDecision[]>([]);
  const [target, setTarget] = useState(NEW_DECK);
  const [newDeckName, setNewDeckName] = useState('');
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  const deckKey = useRef<string | null>(null);

  // Target deck and tags follow the payload's suggestion only when that suggestion changes.
  useEffect(() => {
    const key = `${parsed.deck}\u0000${parsed.tags.join(' ')}`;
    if (deckKey.current === key) return;
    deckKey.current = key;
    const existing = decks.find((dk) => deckFullName(dk.id, decks).toLowerCase() === parsed.deck.toLowerCase());
    setTarget(existing ? existing.id : NEW_DECK);
    setNewDeckName(parsed.deck);
    setTagText(parsed.tags.join(' '));
  }, [parsed.deck, parsed.tags, decks]);

  // Duplicates are re-checked whenever the rows change (edits in the chat review).
  const rowsKey = parsed.items.map((i) => i.checksum).join('\u0001');
  useEffect(() => {
    let alive = true;
    void findDuplicates(parsed.items).then((d) => {
      if (!alive) return;
      setDups(d);
      setDecisions(d.map((x) => (x.kind === 'none' ? 'add' : 'skip')));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey]);

  const stats = useMemo(() => {
    let notes = 0;
    let cards = 0;
    parsed.items.forEach((it, i) => {
      if (it.error || decisions[i] === 'skip') return;
      notes++;
      cards += cardOrds(it.type, it.fields).length;
    });
    return { notes, cards, dupCount: dups.filter((d) => d.kind !== 'none').length };
  }, [parsed, decisions, dups]);

  const ready = dups.length === parsed.items.length;

  const run = async () => {
    setBusy(true);
    try {
      const extraTags = tagText.split(/[\s,]+/).filter(Boolean);
      const origTags = new Set(parsed.tags);
      const items = parsed.items.map((it) => ({
        ...it,
        tags: [...new Set([...it.tags.filter((x) => !origTags.has(x)), ...extraTags])],
      }));
      const res = await commitImport(items, decisions, dups, target === NEW_DECK ? { deckPath: newDeckName || parsed.deck } : { deckId: target });
      toast(t('importDone', { added: res.added, updated: res.updated, skipped: res.skipped }));
      const all = [...decks];
      const deckName = target === NEW_DECK ? newDeckName || parsed.deck : deckFullName(target, all);
      onImported({ ...res, deckName });
    } finally {
      setBusy(false);
    }
  };

  const setAllDup = (d: ImportDecision) =>
    setDecisions((prev) => prev.map((cur, i) => (dups[i]?.kind === 'existing' ? d : dups[i]?.kind === 'inBatch' && d === 'overwrite' ? 'skip' : cur)));

  const front = (i: number) => {
    const it = parsed.items[i];
    return toPlainText(it.type === 'cloze' ? it.fields.text : it.type === 'imageOcclusion' ? it.fields.header || it.fields.image : it.fields.front);
  };
  const back = (i: number) => {
    const it = parsed.items[i];
    return toPlainText(it.type === 'cloze' ? '' : it.type === 'imageOcclusion' ? `${cardOrds(it.type, it.fields).length} masks` : it.fields.back);
  };
  const extra = (i: number) => {
    const it = parsed.items[i];
    return toPlainText(it.fields.note ?? it.fields.extra ?? '');
  };
  const setDecision = (i: number, v: ImportDecision) => setDecisions((d) => d.map((x, j) => (j === i ? v : x)));

  return (
    <>
      <p className="headline" style={{ margin: 0 }}>{t('previewSummary', { count: stats.notes, cards: stats.cards })}</p>
      <label className="field">
        <span>{t('targetDeck')}</span>
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value={NEW_DECK}>{t('newDeckNamed', { name: newDeckName || parsed.deck })}</option>
          {decks
            .map((d) => ({ d, full: deckFullName(d.id, decks) }))
            .sort((a, b) => a.full.localeCompare(b.full))
            .map(({ d, full }) => (
              <option key={d.id} value={d.id}>{full}</option>
            ))}
        </select>
      </label>
      {target === NEW_DECK && (
        <label className="field">
          <span>{t('deckName')} (A::B = sub-deck)</span>
          <input className="input" value={newDeckName} onChange={(e) => setNewDeckName(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>{t('tags')}</span>
        <input className="input" value={tagText} onChange={(e) => setTagText(e.target.value)} autoCapitalize="off" />
      </label>

      {stats.dupCount > 0 && (
        <div className="row glass card-pad" style={{ padding: '10px 14px', flexWrap: 'wrap' }}>
          <span className="badge warn">{t('duplicatesFound', { count: stats.dupCount })}</span>
          <span className="spacer" />
          <button className="btn small" onClick={() => setAllDup('skip')}>{t('skipAll')}</button>
          <button className="btn small" onClick={() => setAllDup('overwrite')}>{t('overwriteAll')}</button>
        </div>
      )}

      <div className="table-scroll">
        <table className="preview-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('front')}</th>
              <th>{t('back')}</th>
              <th>{t('status')}</th>
              {rowActions && <th aria-label={t('options')} />}
            </tr>
          </thead>
          <tbody>
            {parsed.items.map((it, i) => (
              <tr key={i} style={{ opacity: it.error || decisions[i] === 'skip' ? 0.5 : 1 }}>
                <td className="idx">{i + 1}</td>
                <td>{front(i)}{it.type !== 'basic' && <div><span className="badge">{t(`type_${it.type}` as StringKey)}</span></div>}</td>
                <td>
                  {back(i)}
                  {extra(i) && <div className="footnote secondary cell-note">{extra(i)}</div>}
                </td>
                <td>
                  {it.error ? (
                    <span className="badge err">{t(`err_${it.error}` as StringKey)}</span>
                  ) : dups[i]?.kind === 'existing' ? (
                    <select
                      className="select"
                      style={{ minHeight: 36, padding: '4px 8px', fontSize: 13 }}
                      value={decisions[i]}
                      aria-label={`${t('dupExisting')} ${i + 1}`}
                      onChange={(e) => setDecision(i, e.target.value as ImportDecision)}
                    >
                      <option value="skip">{t('dupExisting')}: {t('skip')}</option>
                      <option value="overwrite">{t('overwrite')}</option>
                      <option value="add">{t('add')}</option>
                    </select>
                  ) : dups[i]?.kind === 'inBatch' ? (
                    <select
                      className="select"
                      style={{ minHeight: 36, padding: '4px 8px', fontSize: 13 }}
                      value={decisions[i]}
                      aria-label={`${t('dupInBatch')} ${i + 1}`}
                      onChange={(e) => setDecision(i, e.target.value as ImportDecision)}
                    >
                      <option value="skip">{t('dupInBatch')}: {t('skip')}</option>
                      <option value="add">{t('add')}</option>
                    </select>
                  ) : (
                    <span className="badge ok">{t('ok')}</span>
                  )}
                </td>
                {rowActions && <td className="row-actions">{rowActions(i)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {afterTable}
      <div className="row">
        <button className="btn block" onClick={onCancel}>{cancelLabel ?? t('cancel')}</button>
        <button className="btn primary block" disabled={busy || !ready || (stats.notes === 0 && !decisions.includes('overwrite'))} onClick={() => void run()}>
          {t('importConfirm', { count: stats.notes })}
        </button>
      </div>
    </>
  );
}
