import { useEffect, useState } from 'react';
import type { Note, NoteType } from '../db/types';
import { updateNote } from '../db/repo';
import { useT } from '../i18n';
import { Sheet, useToast } from '../ui/components';
import { CardFieldsForm } from './CardFieldsForm';

/** Edits an existing note (cards are created through import / AI chat, not typed one by one). */
export function NoteEditor({ note, onClose, onSaved }: { note: Note | null; onClose: () => void; onSaved?: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [type, setType] = useState<NoteType>('basic');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (!note) return;
    setType(note.type);
    setFields({ ...note.fields });
    setTags(note.tags.join(' '));
  }, [note]);

  if (!note) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

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
      <CardFieldsForm type={type} onType={setType} fields={fields} onFields={setFields} />
      <label className="field">
        <span>{t('tags')} · {t('tagsHint')}</span>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} autoCapitalize="off" />
      </label>
    </Sheet>
  );
}
