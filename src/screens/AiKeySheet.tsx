import { useEffect, useState } from 'react';
import { updateSettings } from '../db/repo';
import { useSettings } from '../state';
import { useT, type StringKey } from '../i18n';
import { Sheet, useToast } from '../ui/components';
import { AI_MODELS, getAiModel } from '../ai/models';

export const CONSOLE_KEYS_URL = 'https://platform.claude.com/settings/keys';

export function maskKey(k: string): string {
  return k ? `••••${k.slice(-4)}` : '';
}

/** Step-by-step API key setup with a connection test. */
export function AiKeySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const settings = useSettings();
  const [key, setKey] = useState('');
  const [model, setModel] = useState(settings.aiModel);
  const [show, setShow] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; msg?: string }>({ kind: 'idle' });

  useEffect(() => {
    if (!open) return;
    setKey(settings.apiKey);
    setModel(getAiModel(settings.aiModel).id);
    setState({ kind: 'idle' });
    setShow(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const saveAndTest = async () => {
    const trimmed = key.trim();
    setState({ kind: 'testing' });
    try {
      const { testApiKey } = await import('../ai/client');
      await testApiKey(trimmed, model);
      await updateSettings({ apiKey: trimmed, aiModel: model });
      setState({ kind: 'ok' });
      toast(t('aiKeyOk'));
      onClose();
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'api';
      setState({ kind: 'error', msg: t(`aiErr_${code}` as StringKey) });
    }
  };

  const remove = async () => {
    await updateSettings({ apiKey: '' });
    setKey('');
    toast(t('aiKeyRemoved'));
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('aiKeyTitle')}>
      <ol className="steps">
        <li>
          {t('aiKeyStep1')}{' '}
          <a href={CONSOLE_KEYS_URL} target="_blank" rel="noreferrer">platform.claude.com</a>
        </li>
        <li>{t('aiKeyStep2')}</li>
        <li>{t('aiKeyStep3')}</li>
        <li>{t('aiKeyStep4')}</li>
      </ol>
      <label className="field">
        <span>API key</span>
        <div className="row">
          <input
            className="input mono"
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button type="button" className="btn small" onClick={() => setShow((v) => !v)} aria-pressed={show}>
            {show ? t('hide') : t('show')}
          </button>
        </div>
      </label>
      <label className="field">
        <span>{t('aiModel')}</span>
        <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label.replace('Claude ', '')} · ${m.input}/${m.output}
            </option>
          ))}
        </select>
      </label>
      <p className="footnote secondary" style={{ margin: 0 }}>{t('aiPriceNote')} {t(`aiModelHint_${model.replace(/-/g, '_')}` as StringKey)}</p>
      <p className="footnote secondary" style={{ margin: 0 }}>🔒 {t('aiKeyPrivacy')}</p>
      {state.kind === 'error' && (
        <p className="subhead" role="alert" style={{ color: 'var(--red)', margin: 0 }}>{state.msg}</p>
      )}
      <button className="btn primary block" disabled={!key.trim() || state.kind === 'testing'} onClick={() => void saveAndTest()}>
        {state.kind === 'testing' ? t('aiTesting') : t('aiSaveTest')}
      </button>
      {settings.apiKey && (
        <button className="btn block danger" onClick={() => void remove()}>{t('aiKeyRemove')}</button>
      )}
    </Sheet>
  );
}
