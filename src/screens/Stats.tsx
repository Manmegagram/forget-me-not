import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { studyDayStart } from '../srs';
import { useT } from '../i18n';
import { EmptyState } from '../ui/components';
import { FlowerMark } from '../ui/icons';

/** Phase 1 overview built from the review log. The full analytics page lands in phase 3. */
export function StatsScreen({ dayStartHour }: { dayStartHour: number }) {
  const { t } = useT();
  const data = useLiveQuery(async () => {
    const start = studyDayStart(Date.now(), dayStartHour);
    const [logs, cards] = await Promise.all([db.reviewLogs.where('timestamp').aboveOrEqual(start).toArray(), db.cards.toArray()]);
    const real = logs.filter((l) => l.type !== 'manual');
    const ms = real.reduce((s, l) => s + l.timeTakenMs, 0);
    const correct = real.filter((l) => l.rating > 1).length;
    const states = { new: 0, learning: 0, relearning: 0, young: 0, mature: 0, suspended: 0, leech: 0 };
    for (const c of cards) {
      if (c.leech) states.leech++;
      if (c.suspended) {
        states.suspended++;
        continue;
      }
      if (c.state === 'new') states.new++;
      else if (c.state === 'learning') states.learning++;
      else if (c.state === 'relearning') states.relearning++;
      else if (c.interval >= 21) states.mature++;
      else states.young++;
    }
    const anyLogs = (await db.reviewLogs.count()) > 0;
    return { studied: real.length, ms, correct, states, total: cards.length, anyLogs };
  }, [dayStartHour]);

  if (!data) return <div className="screen" />;

  const fmtTime = (ms: number) => {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return m ? `${m}m ${s}s` : `${s}s`;
  };
  const rows: Array<[string, number, string]> = [
    [t('new'), data.states.new, 'var(--new)'],
    [t('learning'), data.states.learning, 'var(--learn)'],
    [t('relearning'), data.states.relearning, 'var(--orange)'],
    [t('young'), data.states.young, 'color-mix(in srgb, var(--review) 60%, transparent)'],
    [t('mature'), data.states.mature, 'var(--review)'],
    [t('suspendedLabel'), data.states.suspended, 'var(--label-3)'],
  ];
  const max = Math.max(1, ...rows.map((r) => r[1]));

  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="large-title">{t('tabStats')}</h1>
      </header>
      {!data.anyLogs && data.total === 0 ? (
        <EmptyState art={<FlowerMark />} title={t('emptyStatsTitle')} body={t('emptyStatsBody')} />
      ) : (
        <div className="stack">
          <h2 className="section-title">{t('statsToday')}</h2>
          <div className="grid-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div className="glass card-pad"><div className="title-1">{data.studied}</div><div className="footnote secondary">{t('studied')}</div></div>
            <div className="glass card-pad"><div className="title-1">{fmtTime(data.ms)}</div><div className="footnote secondary">{t('timeSpent')}</div></div>
            <div className="glass card-pad"><div className="title-1">{data.studied ? (data.ms / data.studied / 1000).toFixed(1) : '0'}</div><div className="footnote secondary">{t('avgPerCard')}</div></div>
            <div className="glass card-pad"><div className="title-1">{data.studied ? Math.round((data.correct / data.studied) * 100) : 0}%</div><div className="footnote secondary">{t('correctRate')}</div></div>
          </div>

          <h2 className="section-title">{t('cardStates')} · {t('total')} {data.total}</h2>
          <div className="glass card-pad stack" role="list">
            {rows.map(([label, n, color]) => (
              <div key={label} className="row" role="listitem" aria-label={`${label}: ${n}`}>
                <span className="subhead" style={{ width: 96 }}>{label}</span>
                <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--fill)', overflow: 'hidden' }}>
                  <div style={{ width: `${(n / max) * 100}%`, height: '100%', background: color, borderRadius: 5 }} />
                </div>
                <span className="subhead" style={{ width: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
              </div>
            ))}
            <div className="row"><span className="subhead">{t('leech')}</span><span className="spacer" /><span className="subhead">{data.states.leech}</span></div>
          </div>
          <p className="footnote tertiary" style={{ textAlign: 'center' }}>{t('statsMoreSoon')}</p>
        </div>
      )}
    </div>
  );
}
