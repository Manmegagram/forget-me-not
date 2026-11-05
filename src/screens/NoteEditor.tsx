import { useEffect, useState } from 'react';
import type { Note, NoteType } from '../db/types';
import { NOTE_TYPES } from '../db/types';
import { updateNote } from '../db/repo';
import { fieldNames } from '../cards/noteTypes';
import { renderCard } from '../cards/render';
import { useT, type StringKey } from '../i18n';
import { Segmented, Sheet, Switch, useToast } from '../ui/components';
import { FaceContent } from './CardFace';

/** Edits an existing note (cards are created through import / AI chat, not typed one by one). */
export function NoteEditor({ note, onClose, onSaved }: { note: Note | null; onClose: () => void; onSaved?: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [type, setType] = useState<NoteType>('basic');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState('');
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');

  useEffect(() => {
    if (!note) return;
    setType(note.type);
    setFields({ ...note.fields });
    setTags(note.tags.join(' '));
  }, [note]);

  if (!note) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const draft: Note = { ...note, type, fields };
  const preview = (() => {
    try {
      return renderCard(draft, 0);
    } catch {
      return null;
    }
  })();

  const save = async () => {
    await updateNote(note.id, { type, fields, tags: tags.split(/[\s,]+/) });
    toast(t('saved'));
    onSaved?.();
    onClose();
  };

  return (
    <Sheet
      open={!!note}
      onClose={onClose}
      title={t('editCard')}
      actions={<button className="btn small primary" onClick={() => void save()}>{t('save')}</button>}
    >
      <label className="field">
        <span>{t('type')}</span>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as NoteType)}>
          {NOTE_TYPES.map((nt) => (
            <option key={nt} value={nt}>{t(`type_${nt}` as StringKey)}</option>
          ))}
        </select>
      </label>
      {fieldNames(type).map((f) =>
        f === 'addReverse' ? (
          <div key={f} className="row glass card-pad" style={{ padding: '8px 16px' }}>
            <span className="spacer">{t('field_addReverse')}</span>
            <Switch checked={/^(y|yes|true|1)$/i.test(fields.addReverse ?? '')} onChange={(v) => setFields({ ...fields, addReverse: v ? 'y' : '' })} label={t('field_addReverse')} />
          </div>
        ) : (
          <label key={f} className="field">
            <span>{t(`field_${f}` as StringKey)}</span>
            <textarea
              className={`textarea ${f === 'masks' ? 'mono' : ''}`}
              rows={f === 'note' || f === 'extra' ? 2 : 3}
              value={fields[f] ?? ''}
              onChange={(e) => setFields({ ...fields, [f]: e.target.value })}
            />
          </label>
        ),
      )}
      <label className="field">
        <span>{t('tags')} · {t('tagsHint')}</span>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} autoCapitalize="off" />
      </label>
      {preview && (
        <div className="stack">
          <Segmented
            label="Preview"
            value={previewSide}
            onChange={setPreviewSide}
            options={[{ value: 'front', label: t('front') }, { value: 'back', label: t('back') }]}
          />
          <div className="glass card-pad">
            <FaceContent rendered={preview} side={previewSide} typed="" />
          </div>
        </div>
      )}
    </Sheet>
  );
}
