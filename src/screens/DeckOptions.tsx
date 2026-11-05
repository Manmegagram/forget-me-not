import { useEffect, useState } from 'react';
import type { Deck } from '../db/types';
import { createConfig, deleteConfig, getConfig, saveConfig, setDeckConfig } from '../db/repo';
import { defaultDeckConfig, DEFAULT_CONFIG_ID, type DeckConfig, type NewReviewOrder } from '../srs';
import { useConfigs } from '../state';
import { useT, type StringKey } from '../i18n';
import { Sheet, Switch, useToast } from '../ui/components';

/** "1 10 1d 3h" -> minutes [1, 10, 1440, 180] */
export function parseSteps(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((tok) => {
      const m = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(tok);
      if (!m) return NaN;
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      return unit === 's' ? n / 60 : unit === 'h' ? n * 60 : unit === 'd' ? n * 1440 : n;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function formatSteps(steps: number[]): string {
  return steps
    .map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${m}`))
    .join(' ');
}

/**
 * Edits a preset. Opened from a deck (choose preset + edit) or from Settings (edit a preset).
 */
export function DeckOptionsSheet({
  deck,
  presetId,
  onClose,
  decks,
}: {
  deck: Deck | null;
  presetId?: string | null;
  onClose: () => void;
  decks: Deck[];
}) {
  const { t } = useT();
  const toast = useToast();
  const configs = useConfigs();
  const open = !!deck || !!presetId;
  const [cfg, setCfg] = useState<DeckConfig | null>(null);
  const [learnText, setLearnText] = useState('');
  const [relearnText, setRelearnText] = useState('');
  const [applyChildren, setApplyChildren] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = deck?.configId ?? presetId ?? DEFAULT_CONFIG_ID;
    void getConfig(id).then((c) => {
      setCfg(c);
      setLearnText(formatSteps(c.learnSteps));
      setRelearnText(formatSteps(c.relearnSteps));
    });
  }, [open, deck, presetId]);

  const choosePreset = async (id: string) => {
    if (id === '__new__') {
      const created = await createConfig(`${deck?.name ?? 'Preset'}`, cfg ?? undefined);
      id = created.id;
    }
    const c = await getConfig(id);
    setCfg(c);
    setLearnText(formatSteps(c.learnSteps));
    setRelearnText(formatSteps(c.relearnSteps));
  };

  const save = async () => {
    if (!cfg) return;
    const next = { ...cfg, learnSteps: parseSteps(learnText), relearnSteps: parseSteps(relearnText) };
    await saveConfig(next);
    if (deck) await setDeckConfig(deck.id, next.id, applyChildren);
    toast(t('saved'));
    onClose();
  };

  const num = (key: keyof DeckConfig, label: StringKey, opts: { pct?: boolean; delta?: boolean; min?: number; step?: number } = {}) => {
    if (!cfg) return null;
    const raw = cfg[key] as number;
    const shown = opts.pct ? Math.round(raw * 100) : raw;
    return (
      <label className="list-item" key={key}>
        <span className="label subhead">{t(label)}</span>
        <input
          className="input"
          style={{ width: 96, minHeight: 36, textAlign: 'right' }}
          type="number"
          inputMode="decimal"
          step={opts.step ?? 1}
          min={opts.delta ? undefined : opts.min ?? 0}
          value={Number.isFinite(shown) ? shown : 0}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            setCfg({ ...cfg, [key]: opts.pct ? v / 100 : v });
          }}
        />
      </label>
    );
  };
  const toggle = (key: keyof DeckConfig, label: StringKey) =>
    cfg && (
      <div className="list-item" key={key}>
        <span className="label subhead">{t(label)}</span>
        <Switch checked={!!cfg[key]} onChange={(v) => setCfg({ ...cfg, [key]: v })} label={t(label)} />
      </div>
    );

  const usedBy = cfg ? decks.filter((d) => d.configId === cfg.id).length : 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={deck ? `${t('deckOptions')} · ${deck.name}` : t('presets')}
      actions={<button className="btn small primary" onClick={() => void save()}>{t('save')}</button>}
    >
      {cfg && (
        <>
          {deck && (
            <label className="field">
              <span>{t('presetFor')}</span>
              <select className="select" value={cfg.id} onChange={(e) => void choosePreset(e.target.value)}>
                {configs.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value="__new__">+ {t('addPreset')}</option>
              </select>
            </label>
          )}
          <label className="field">
            <span>{t('presetName')} · {t('usedByDecks', { count: usedBy })}</span>
            <input className="input" value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} />
          </label>
          {deck && decks.some((d) => d.parentId === deck.id) && (
            <div className="row glass card-pad" style={{ padding: '8px 16px' }}>
              <span className="spacer subhead">{t('applyToSubdecks')}</span>
              <Switch checked={applyChildren} onChange={setApplyChildren} label={t('applyToSubdecks')} />
            </div>
          )}

          <h3 className="section-title">{t('dailyLimits')}</h3>
          <div className="glass list">
            {num('newPerDay', 'newPerDay')}
            {num('reviewsPerDay', 'reviewsPerDay')}
          </div>

          <h3 className="section-title">{t('newCardsSection')}</h3>
          <div className="glass list">
            <label className="list-item" style={{ flexWrap: 'wrap' }}>
              <span className="label subhead">{t('learnSteps')}</span>
              <input className="input mono" style={{ width: 140, minHeight: 36 }} value={learnText} onChange={(e) => setLearnText(e.target.value)} aria-describedby="steps-hint" />
            </label>
            {num('graduatingInterval', 'graduatingInterval', { min: 1 })}
            {num('easyInterval', 'easyInterval', { min: 1 })}
            {num('startingEase', 'startingEase', { pct: true, min: 130 })}
          </div>
          <p id="steps-hint" className="footnote tertiary" style={{ margin: '0 8px' }}>{t('stepsHint')}</p>

          <h3 className="section-title">{t('lapsesSection')}</h3>
          <div className="glass list">
            <label className="list-item">
              <span className="label subhead">{t('relearnSteps')}</span>
              <input className="input mono" style={{ width: 140, minHeight: 36 }} value={relearnText} onChange={(e) => setRelearnText(e.target.value)} />
            </label>
            {num('minLapseInterval', 'minLapseInterval', { min: 1 })}
            {num('lapseIntervalMultiplier', 'lapseMultiplier', { pct: true })}
            {num('leechThreshold', 'leechThreshold', { min: 1 })}
            <label className="list-item">
              <span className="label subhead">{t('leechAction')}</span>
              <select className="select" style={{ width: 160, minHeight: 36 }} value={cfg.leechAction} onChange={(e) => setCfg({ ...cfg, leechAction: e.target.value as DeckConfig['leechAction'] })}>
                <option value="suspend">{t('leechSuspend')}</option>
                <option value="tagOnly">{t('leechTag')}</option>
              </select>
            </label>
          </div>

          <h3 className="section-title">{t('displayOrder')}</h3>
          <div className="glass list">
            <label className="list-item">
              <span className="label subhead">{t('displayOrder')}</span>
              <select className="select" style={{ width: 190, minHeight: 36 }} value={cfg.newReviewOrder} onChange={(e) => setCfg({ ...cfg, newReviewOrder: e.target.value as NewReviewOrder })}>
                <option value="reviewsFirst">{t('orderReviewsFirst')}</option>
                <option value="newFirst">{t('orderNewFirst')}</option>
                <option value="mixed">{t('orderMixed')}</option>
              </select>
            </label>
            {toggle('learningFirst', 'learningFirst')}
            {num('learnAheadMinutes', 'learnAhead')}
          </div>

          <h3 className="section-title">{t('burySection')}</h3>
          <div className="glass list">
            {toggle('buryNewSiblings', 'buryNew')}
            {toggle('buryReviewSiblings', 'buryReview')}
          </div>

          <h3 className="section-title">{t('advanced')}</h3>
          <div className="glass list">
            {num('maxInterval', 'maxInterval', { min: 1 })}
            {num('easyBonus', 'easyBonus', { pct: true, min: 100 })}
            {num('hardIntervalFactor', 'hardInterval', { pct: true })}
            {num('intervalModifier', 'intervalModifier', { pct: true, min: 10 })}
            {num('easeAgainDelta', 'easeAgain', { pct: true, delta: true })}
            {num('easeHardDelta', 'easeHard', { pct: true, delta: true })}
            {num('easeEasyDelta', 'easeEasy', { pct: true, delta: true })}
            {num('minEase', 'minEase', { pct: true, min: 100 })}
            {toggle('fuzz', 'fuzz')}
          </div>

          <div className="row">
            <button
              className="btn block"
              onClick={() => {
                const d = defaultDeckConfig(cfg.id, cfg.name);
                setCfg(d);
                setLearnText(formatSteps(d.learnSteps));
                setRelearnText(formatSteps(d.relearnSteps));
              }}
            >
              {t('resetDefaults')}
            </button>
            {cfg.id !== DEFAULT_CONFIG_ID && !deck && (
              <button className="btn block danger" onClick={async () => { await deleteConfig(cfg.id); onClose(); }}>{t('deletePreset')}</button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
