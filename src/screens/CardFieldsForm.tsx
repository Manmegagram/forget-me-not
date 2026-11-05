import { useState } from 'react';
import type { Note, NoteType } from '../db/types';
import { NOTE_TYPES } from '../db/types';
import { fieldNames } from '../cards/noteTypes';
import { renderCard } from '../cards/render';
import { useT, type StringKey } from '../i18n';
import { Segmented, Switch } from '../ui/components';
import { FaceContent } from './CardFace';

/** Type picker, per-type fields and a live preview. Shared by the note editor and the AI draft editor. */
export function CardFieldsForm({
  type,
  onType,
  fields,
  onFields,
  types = NOTE_TYPES,
}: {
  type: NoteType;
  onType: (t: NoteType) => void;
  fields: Record<string, string>;
  onFields: (f: Record<string, string>) => void;
  types?: readonly NoteType[];
}) {
  const { t } = useT();
  const [previewSide, setPreviewSide] = useState<'front' | 'back'>('front');
  const draft: Note = { id: 'preview', deckId: '', type, fields, tags: [], checksum: '', createdAt: 0, updatedAt: 0 };
  const preview = (() => {
    try {
      return renderCard(draft, 0);
    } catch {
      return null;
    }
  })();

  return (
    <>
      <label className="field">
        <span>{t('type')}</span>
        <select className="select" value={type} onChange={(e) => onType(e.target.value as NoteType)}>
          {types.map((nt) => (
            <option key={nt} value={nt}>{t(`type_${nt}` as StringKey)}</option>
          ))}
        </select>
      </label>
      {fieldNames(type).map((f) =>
        f === 'addReverse' ? (
          <div key={f} className="row glass card-pad" style={{ padding: '8px 16px' }}>
            <span className="spacer">{t('field_addReverse')}</span>
            <Switch checked={/^(y|yes|true|1)$/i.test(fields.addReverse ?? '')} onChange={(v) => onFields({ ...fields, addReverse: v ? 'y' : '' })} label={t('field_addReverse')} />
          </div>
        ) : (
          <label key={f} className="field">
            <span>{t(`field_${f}` as StringKey)}</span>
            <textarea
              className={`textarea ${f === 'masks' ? 'mono' : ''}`}
              rows={f === 'note' || f === 'extra' ? 2 : 3}
              value={fields[f] ?? ''}
              onChange={(e) => onFields({ ...fields, [f]: e.target.value })}
            />
          </label>
        ),
      )}
      {preview && (
        <div className="stack">
          <Segmented
            label={t('preview')}
            value={previewSide}
            onChange={setPreviewSide}
            options={[{ value: 'front', label: t('front') }, { value: 'back', label: t('back') }]}
          />
          <div className="glass card-pad">
            <FaceContent rendered={preview} side={previewSide} typed="" />
          </div>
        </div>
      )}
    </>
  );
}
