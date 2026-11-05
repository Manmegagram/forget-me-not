import { useEffect, useRef, useState } from 'react';
import type { Deck } from '../db/types';
import { parseImport, type ParsedImport } from '../db/import';
import { useT, type StringKey } from '../i18n';
import { Sheet } from '../ui/components';
import { ImportReview } from './ImportReview';
import { resolveImportText } from '../db/importLink';

/**
 * Paste or open JSON -> preview table -> resolve duplicates -> import.
 * The AI chat reuses the same ImportReview step for its drafts.
 */
export function ImportSheet({ open, onClose, decks, initialText }: { open: boolean; onClose: () => void; decks: Deck[]; initialText?: string }) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);

  const reset = () => {
    setText('');
    setParsed(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const preview = async (source = text) => {
    // Accepts pasted import links (https://…/#import=…) as well as raw JSON.
    const resolved = await resolveImportText(source);
    if (resolved !== source) setText(resolved);
    setParsed(parseImport(resolved));
  };

  // Opened from an import link: go straight to the preview.
  useEffect(() => {
    if (open && initialText) {
      setText(initialText);
      void preview(initialText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialText]);

  const onFile = async (file: File) => {
    const content = await file.text();
    setText(content);
    await preview(content);
  };

  return (
    <Sheet open={open} onClose={close} title={parsed?.items.length ? t('previewTitle') : t('importTitle')}>
      {!parsed?.items.length ? (
        <>
          <label className="field">
            <span className="row" style={{ justifyContent: 'space-between' }}>
              {t('importPaste')}
              {typeof navigator !== 'undefined' && navigator.clipboard?.readText && (
                <button
                  type="button"
                  className="btn small plain"
                  onClick={async () => {
                    try {
                      const clip = await navigator.clipboard.readText();
                      if (clip) setText(clip);
                    } catch {
                      /* permission denied: the learner can still paste manually */
                    }
                  }}
                >
                  {t('pasteClipboard')}
                </button>
              )}
            </span>
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
        <ImportReview parsed={parsed} decks={decks} onCancel={reset} onImported={close} />
      )}
    </Sheet>
  );
}
