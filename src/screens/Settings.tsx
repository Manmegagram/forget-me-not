import { useEffect, useState } from 'react';
import { db } from '../db/schema';
import { updateSettings } from '../db/repo';
import type { Language, ThemePref } from '../db/types';
import { useConfigs, useDecks, useSettings } from '../state';
import { useT } from '../i18n';
import { ConfirmSheet, Segmented } from '../ui/components';
import { IconChevron } from '../ui/icons';
import { DeckOptionsSheet } from './DeckOptions';
import { createConfig } from '../db/repo';
import { defaultDeckConfig } from '../srs';

export function SettingsScreen() {
  const { t } = useT();
  const settings = useSettings();
  const configs = useConfigs();
  const decks = useDecks() ?? [];
  const [presetId, setPresetId] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [wipe, setWipe] = useState(false);

  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(false));
  }, []);

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="large-title">{t('tabSettings')}</h1>
      </header>

      <h2 className="section-title">{t('general')}</h2>
      <div className="glass list">
        <div className="list-item" style={{ flexWrap: 'wrap' }}>
          <span className="label">{t('language')}</span>
          <div style={{ width: 200 }}>
            <Segmented<Language>
              label={t('language')}
              value={settings.language}
              onChange={(v) => void updateSettings({ language: v })}
              options={[{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }]}
            />
          </div>
        </div>
        <div className="list-item" style={{ flexWrap: 'wrap' }}>
          <span className="label">{t('theme')}</span>
          <div style={{ width: 240 }}>
            <Segmented<ThemePref>
              label={t('theme')}
              value={settings.theme}
              onChange={(v) => void updateSettings({ theme: v })}
              options={[
                { value: 'system', label: t('themeSystem') },
                { value: 'light', label: t('themeLight') },
                { value: 'dark', label: t('themeDark') },
              ]}
            />
          </div>
        </div>
        <label className="list-item">
          <span className="label">{t('dayStart')}</span>
          <select
            className="select"
            style={{ width: 110, minHeight: 36 }}
            value={settings.dayStartHour}
            onChange={(e) => void updateSettings({ dayStartHour: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
        </label>
      </div>

      <h2 className="section-title">{t('presets')}</h2>
      <div className="glass list">
        {configs.map((c) => (
          <button key={c.id} className="list-item button" onClick={() => setPresetId(c.id)}>
            <span className="label">{c.name}</span>
            <span className="value footnote">{t('usedByDecks', { count: decks.filter((d) => d.configId === c.id).length })}</span>
            <IconChevron className="chevron" />
          </button>
        ))}
        <button
          className="list-item button"
          style={{ color: 'var(--blue)' }}
          onClick={async () => {
            const c = await createConfig(`Preset ${configs.length + 1}`, defaultDeckConfig());
            setPresetId(c.id);
          }}
        >
          + {t('addPreset')}
        </button>
      </div>

      <h2 className="section-title">{t('dataStorage')}</h2>
      <div className="glass list">
        <div className="list-item">
          <span className="label footnote secondary">{persisted ? t('storagePersisted') : t('storageNotPersisted')}</span>
        </div>
        <button className="list-item button" style={{ color: 'var(--red)' }} onClick={() => setWipe(true)}>
          {t('deleteAll')}
        </button>
      </div>

      <h2 className="section-title">{t('about')}</h2>
      <div className="glass list">
        <div className="list-item">
          <span className="label">{t('version')}</span>
          <span className="value">{__APP_VERSION__}</span>
        </div>
      </div>

      <DeckOptionsSheet deck={null} presetId={presetId} onClose={() => setPresetId(null)} decks={decks} />
      <ConfirmSheet
        open={wipe}
        title={t('deleteAll')}
        message={t('deleteAllConfirm')}
        confirmLabel={t('delete')}
        danger
        onCancel={() => setWipe(false)}
        onConfirm={async () => {
          await db.transaction('rw', [db.decks, db.notes, db.cards, db.reviewLogs], async () => {
            await Promise.all([db.decks.clear(), db.notes.clear(), db.cards.clear(), db.reviewLogs.clear()]);
          });
          setWipe(false);
        }}
      />
    </div>
  );
}
