import { useMemo, useRef, useState } from 'react';
import type { Deck } from '../db/types';
import { commitImport, findDuplicates, parseImport, type DuplicateInfo, type ImportDecision, type ParsedImport } from '../db/import';
import { cardOrds } from '../cards/noteTypes';
import { toPlainText } from '../cards/markdown';
import { deckFullName } from '../db/repo';
import { useT, type StringKey } from '../i18n';
import { Sheet, useToast } from '../ui/components';

const NEW_DECK = '__new__';

/**
 * Paste or open JSON -> preview table -> resolve duplicates -> import.
 * The chat workflow (phase 2) reuses this preview/approve step.
 */
export function ImportSheet({ open, onClose, decks }: { open: boolean; onClose: () => void; decks: Deck[] }) {
  const { t } = useT();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [dups, setDups] = useState<DuplicateInfo[]>([]);
  const [decisions, setDecisions] = useState<ImportDecision[]>([]);
  const [target, setTarget] = useState(NEW_DECK);
  const [newDeckName, setNewDeckName] = useState('');
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setText('');
    setParsed(null);
    setDups([]);
    setDecisions([]);
  };
  const close = () => {
    reset();
    onClose();
  };

  const preview = async (source = text) => {
    const p = parseImport(source);
    setParsed(p);
    if (!p.items.length) return;
    const d = await findDuplicates(p.items);
    setDups(d);
    setDecisions(d.map((x) => (x.kind === 'none' ? 'add' : 'skip')));
    const existing = decks.find((dk) => deckFullName(dk.id, decks).toLowerCase() === p.deck.toLowerCase());
    setTarget(existing ? existing.id : NEW_DECK);
    setNewDeckName(p.deck);
    setTagText(p.tags.join(' '));
  };

  const onFile = async (file: File) => {
    const content = await file.text();
    setText(content);
    await preview(content);
  };

  const stats = useMemo(() => {
    if (!parsed) return { notes: 0, cards: 0, dupCount: 0 };
    let notes = 0;
    let cards = 0;
    parsed.items.forEach((it, i) => {
      if (it.error || decisions[i] === 'skip') return;
      notes++;
      cards += cardOrds(it.type, it.fields).length;
    });
    return { notes, cards, dupCount: dups.filter((d) => d.kind !== 'none').length };
  }, [parsed, decisions, dups]);

  const run = async () => {
    if (!parsed) return;
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
      close();
    } finally {
      setBusy(false);
    }
  };

  const setAllDup = (d: ImportDecision) =>
    setDecisions((prev) => prev.map((cur, i) => (dups[i]?.kind === 'existing' ? d : dups[i]?.kind === 'inBatch' && d === 'overwrite' ? 'skip' : cur)));

  const front = (i: number) => {
    const it = parsed!.items[i];
    return toPlainText(it.type === 'cloze' ? it.fields.text : it.type === 'imageOcclusion' ? it.fields.header || it.fields.image : it.fields.front);
  };
  const back = (i: number) => {
    const it = parsed!.items[i];
    return toPlainText(it.type === 'cloze' ? '' : it.type === 'imageOcclusion' ? `${cardOrds(it.type, it.fields).length} masks` : it.fields.back);
  };
  const extra = (i: number) => {
    const it = parsed!.items[i];
    return toPlainText(it.fields.note ?? it.fields.extra ?? '');
  };

  return (
    <Sheet open={open} onClose={close} title={parsed?.items.length ? t('previewTitle') : t('importTitle')}>
      {!parsed?.items.length ? (
        <>
          <label className="field">
            <span>{t('importPaste')}</span>
            <textarea className="textarea mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </label>
          <p className="footnote tertiary mono" style={{ margin: 0 }}>{t('importFormatHelp')}</p>
          {parsed?.errors.length ? (
            <p className="subhead" style={{ color: 'var(--red)', margin: 0 }} role="alert">
              {parsed.errors.map((e) => t(`err_${e}` as StringKey)).join(' ')}
            </p>
          ) : null}
          <div className="row">
            <input ref={fileRef} type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
            <button className="btn block" onClick={() => fileRef.current?.click()}>{t('importFile')}</button>
            <button className="btn primary block" disabled={!text.trim()} onClick={() => void preview()}>{t('importParse')}</button>
          </div>
        </>
      ) : (
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
                  <th>{t('note')}</th>
                  <th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {parsed.items.map((it, i) => (
                  <tr key={i} style={{ opacity: it.error || decisions[i] === 'skip' ? 0.5 : 1 }}>
                    <td className="idx">{i + 1}</td>
                    <td>{front(i)}{it.type !== 'basic' && <div><span className="badge">{t(`type_${it.type}` as StringKey)}</span></div>}</td>
                    <td>{back(i)}</td>
                    <td className="secondary">{extra(i)}</td>
                    <td>
                      {it.error ? (
                        <span className="badge err">{t(`err_${it.error}` as StringKey)}</span>
                      ) : dups[i]?.kind === 'existing' ? (
                        <select
                          className="select"
                          style={{ minHeight: 36, padding: '4px 8px', fontSize: 13 }}
                          value={decisions[i]}
                          aria-label={`${t('dupExisting')} ${i + 1}`}
                          onChange={(e) => setDecisions((d) => d.map((v, j) => (j === i ? (e.target.value as ImportDecision) : v)))}
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
                          onChange={(e) => setDecisions((d) => d.map((v, j) => (j === i ? (e.target.value as ImportDecision) : v)))}
                        >
                          <option value="skip">{t('dupInBatch')}: {t('skip')}</option>
                          <option value="add">{t('add')}</option>
                        </select>
                      ) : (
                        <span className="badge ok">{t('ok')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="btn block" onClick={reset}>{t('cancel')}</button>
            <button className="btn primary block" disabled={busy || (stats.notes === 0 && !decisions.includes('overwrite'))} onClick={() => void run()}>
              {t('importConfirm', { count: stats.notes })}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
