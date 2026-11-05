import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../db/schema';
import type { Note } from '../db/types';
import { deckFullName, deleteCards, resetCards, setSuspended } from '../db/repo';
import { allTags, computeStats, type HardCard, type Period, type StatsScope } from '../db/stats';
import { addStudyDays, normalizeConfig } from '../srs';
import { primaryField } from '../cards/noteTypes';
import { toPlainText } from '../cards/markdown';
import { useT, type StringKey } from '../i18n';
import { ConfirmSheet, EmptyState, Segmented, useToast } from '../ui/components';
import { FlowerMark, IconEdit, IconReset, IconTrash, IconUnsuspend } from '../ui/icons';
import { ChartCard, Columns, Donut, Heatmap, PercentLine, StackedRows, type Series } from '../ui/charts';
import { NoteEditor } from './NoteEditor';

const C = {
  new: 'var(--c-new)',
  learning: 'var(--c-learn)',
  relearning: 'var(--c-relearn)',
  young: 'var(--c-young)',
  mature: 'var(--c-mature)',
  suspended: 'var(--c-muted)',
  again: 'var(--c-again)',
  hard: 'var(--c-hard)',
  good: 'var(--c-good)',
  easy: 'var(--c-easy)',
  one: 'var(--c-1)',
};

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export function StatsScreen({ dayStartHour }: { dayStartHour: number }) {
  const { t, lang } = useT();
  const toast = useToast();
  const [scopeKey, setScopeKey] = useState('all');
  const [period, setPeriod] = useState<Period>('month');
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [editing, setEditing] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState<HardCard | null>(null);
  const [allLeeches, setAllLeeches] = useState(false);

  const raw = useLiveQuery(async () => {
    const [cards, logs, notes, decks, configs] = await Promise.all([
      db.cards.toArray(),
      db.reviewLogs.toArray(),
      db.notes.toArray(),
      db.decks.toArray(),
      db.configs.toArray(),
    ]);
    return { cards, logs, notes, decks, configs: configs.map(normalizeConfig) };
  }, []);

  const scope: StatsScope = scopeKey === 'all' ? { kind: 'all' } : scopeKey.startsWith('d:') ? { kind: 'deck', deckId: scopeKey.slice(2) } : { kind: 'tag', tag: scopeKey.slice(2) };
  const now = Date.now();
  const stats = useMemo(() => (raw ? computeStats({ ...raw, scope, now, dayStartHour }) : null), [raw, scopeKey, dayStartHour]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useMemo(() => (raw ? allTags(raw.notes) : []), [raw]);
  const locale = lang === 'th' ? 'th-TH' : 'en-US';
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }), [locale]);
  const longDate = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), [locale]);
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short' }), [locale]);

  if (!raw || !stats) return <div className="screen" />;

  if (raw.cards.length === 0 && raw.logs.length === 0) {
    return (
      <div className="screen">
        <header className="screen-header"><h1 className="large-title">{t('tabStats')}</h1></header>
        <EmptyState art={<FlowerMark />} title={t('emptyStatsTitle')} body={t('emptyStatsBody')} />
      </div>
    );
  }

  const fmtTime = (ms: number) => {
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m >= 10 ? `${m}m` : m ? `${m}m ${s}s` : `${s}s`;
  };
  const front = (h: HardCard) => (h.note ? toPlainText(primaryField(h.note.type, h.note.fields)).slice(0, 80) : '—');
  const deckName = (id: string) => deckFullName(id, raw.decks);

  // Series definitions
  const stateSegs = [
    { key: 'new', label: t('new'), color: C.new, value: stats.states.new },
    { key: 'learning', label: t('learning'), color: C.learning, value: stats.states.learning },
    { key: 'relearning', label: t('relearning'), color: C.relearning, value: stats.states.relearning },
    { key: 'young', label: t('young'), color: C.young, value: stats.states.young },
    { key: 'mature', label: t('mature'), color: C.mature, value: stats.states.mature },
    { key: 'suspended', label: t('suspendedLabel'), color: C.suspended, value: stats.states.suspended + stats.states.buried },
  ];
  const buttonSeries: Series[] = [
    { key: 'again', label: t('again'), color: C.again },
    { key: 'hard', label: t('hard'), color: C.hard },
    { key: 'good', label: t('good'), color: C.good },
    { key: 'easy', label: t('easy'), color: C.easy },
  ];
  const forecastSeries: Series[] = [
    { key: 'learning', label: t('learning'), color: C.learning },
    { key: 'young', label: t('young'), color: C.young },
    { key: 'mature', label: t('mature'), color: C.mature },
  ];
  const fc = stats.forecast.slice(0, range);
  const fcTotal = fc.reduce((s, d) => s + d.learning + d.young + d.mature, 0);
  const dayLabel = (d: number) => (d === 0 ? t('todayShort') : range === 7 ? dateFmt.format(addStudyDays(now, d, dayStartHour)) : `+${d}`);

  const r = stats.retention[period];
  const bestHour = stats.hours.filter((h) => h.total >= 10).sort((a, b) => b.pass / b.total - a.pass / a.total)[0];
  const forgetDelta = stats.forget.rate !== null && stats.forget.prevRate !== null ? stats.forget.rate - stats.forget.prevRate : null;

  return (
    <div className="screen stats">
      <header className="screen-header">
        <h1 className="large-title">{t('tabStats')}</h1>
      </header>

      <div className="filter-row">
        <select className="select" value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} aria-label={t('statsFilter')}>
          <option value="all">{t('statsAllDecks')}</option>
          <optgroup label={t('decks')}>
            {raw.decks
              .map((d) => ({ d, full: deckName(d.id) }))
              .sort((a, b) => a.full.localeCompare(b.full))
              .map(({ d, full }) => <option key={d.id} value={`d:${d.id}`}>{full}</option>)}
          </optgroup>
          {tags.length > 0 && (
            <optgroup label={t('tags')}>
              {tags.map((tg) => <option key={tg} value={`t:${tg}`}>#{tg}</option>)}
            </optgroup>
          )}
        </select>
      </div>

      {/* Dashboard */}
      <h2 className="section-title">{t('statsToday')}</h2>
      <div className="tiles">
        <div className="glass tile"><div className="title-1 num">{stats.today.studied}</div><div className="footnote secondary">{t('studied')}</div></div>
        <div className="glass tile"><div className="title-1 num">{fmtTime(stats.today.timeMs)}</div><div className="footnote secondary">{t('timeSpent')}</div></div>
        <div className="glass tile"><div className="title-1 num">{stats.today.studied ? (stats.today.timeMs / stats.today.studied / 1000).toFixed(1) : '0'}</div><div className="footnote secondary">{t('avgPerCard')}</div></div>
        <div className="glass tile"><div className="title-1 num">{stats.today.studied ? Math.round((stats.today.correct / stats.today.studied) * 100) : 0}%</div><div className="footnote secondary">{t('correctRate')}</div></div>
        <div className="glass tile"><div className="title-1 num">{stats.today.newLearned}</div><div className="footnote secondary">{t('statsNewToday')}</div></div>
        <div className="glass tile streak">
          <div className="title-1 num">🔥 {stats.streak.current}</div>
          <div className="footnote secondary">{t('statsStreak', { longest: stats.streak.longest })}</div>
        </div>
      </div>
      {!stats.streak.studiedToday && stats.streak.current > 0 && <p className="footnote secondary hint">{t('statsKeepStreak')}</p>}

      {/* Heatmap */}
      <ChartCard
        title={t('statsHeatmap')}
        subtitle={t('statsHeatmapSub', { days: stats.streak.daysStudied, reviews: stats.totalReviews })}
        table={{
          headers: [t('date'), t('statsReviews')],
          rows: [...stats.heatmap.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 365).map(([k, v]) => [k, v]),
        }}
      >
        <Heatmap
          start={stats.heatmapStart}
          days={365}
          valueAt={(i) => stats.heatmap.get(keyAt(stats.heatmapStart, i, dayStartHour)) ?? 0}
          labelAt={(i) => {
            const ts = addStudyDays(stats.heatmapStart, i, dayStartHour);
            return t('statsHeatTip', { date: longDate.format(ts), count: stats.heatmap.get(keyAt(stats.heatmapStart, i, dayStartHour)) ?? 0 });
          }}
          monthLabel={(i) => {
            const d = new Date(addStudyDays(stats.heatmapStart, i, dayStartHour));
            return d.getDate() <= 7 && d.getDay() === 0 ? monthFmt.format(d) : null;
          }}
        />
      </ChartCard>

      {/* States */}
      <ChartCard
        title={t('cardStates')}
        subtitle={`${t('total')} ${stats.states.total}`}
        table={{ headers: [t('status'), t('statsCards'), '%'], rows: stateSegs.map((s) => [s.label, s.value, stats.states.total ? `${Math.round((s.value / stats.states.total) * 100)}%` : '0%']) }}
      >
        <Donut segments={stateSegs} centerLabel={t('statsCards')} centerValue={String(stats.states.total)} />
        <p className="footnote secondary" style={{ margin: 0 }}>
          {t('statsAverages', { ease: stats.avgEase ? Math.round(stats.avgEase * 100) : '—', ivl: stats.avgInterval ? Math.round(stats.avgInterval) : '—' })}
        </p>
      </ChartCard>

      {/* Retention */}
      <section className="glass chart-card" aria-label={t('statsRetention')}>
        <div className="chart-head"><h3 className="headline" style={{ flex: 1 }}>{t('statsRetention')}</h3></div>
        <Segmented<Period>
          label={t('statsPeriod')}
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'today', label: t('todayShort') },
            { value: 'week', label: t('statsWeek') },
            { value: 'month', label: t('statsMonth') },
            { value: 'year', label: t('statsYear') },
          ]}
        />
        <div className="retention-grid">
          {([['young', r.young], ['mature', r.mature], ['statsAll', r.all]] as const).map(([k, v]) => (
            <div key={k} className="ret-tile">
              <div className="title-2 num">{pct(v.rate)}</div>
              <div className="footnote secondary">{t(k as StringKey)}</div>
              <div className="caption tertiary">{t('statsPassOf', { pass: v.pass, total: v.total })}</div>
            </div>
          ))}
        </div>
        <p className="footnote secondary" style={{ margin: 0 }}>{t('statsRetentionHelp')}</p>
      </section>

      <ChartCard
        title={t('statsWeekly')}
        subtitle={t('statsWeeklySub')}
        table={{ headers: [t('statsWeekOf'), t('statsRetention'), t('statsReviews')], rows: stats.weekly.map((w) => [dateFmt.format(w.weekStart), pct(w.rate), w.total]) }}
      >
        {stats.weekly.some((w) => w.rate !== null) ? (
          <PercentLine
            labels={stats.weekly.map((w) => dateFmt.format(w.weekStart))}
            values={stats.weekly.map((w) => w.rate)}
            color={C.one}
            ariaLabel={t('statsWeekly')}
            tip={(i) => (
              <>
                <b>{t('statsWeekOf')} {dateFmt.format(stats.weekly[i].weekStart)}</b>
                <span>{pct(stats.weekly[i].rate)} · {t('statsReviewsCount', { count: stats.weekly[i].total })}</span>
              </>
            )}
          />
        ) : (
          <p className="subhead secondary">{t('statsNoReviewsYet')}</p>
        )}
      </ChartCard>

      <section className="glass chart-card" aria-label={t('statsForget')}>
        <div className="chart-head"><h3 className="headline" style={{ flex: 1 }}>{t('statsForget')}</h3></div>
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="title-1 num">{pct(stats.forget.rate)}</span>
          {forgetDelta !== null && (
            <span className={`footnote ${forgetDelta > 0 ? 'delta-bad' : 'delta-good'}`}>
              {forgetDelta > 0 ? '▲' : '▼'} {Math.abs(Math.round(forgetDelta * 100))} {t('statsPoints')}
            </span>
          )}
        </div>
        <p className="footnote secondary" style={{ margin: 0 }}>{t('statsForgetSub', { lapses: stats.forget.lapses, reviews: stats.forget.reviews })}</p>
      </section>

      {/* Forecast */}
      <ChartCard
        title={t('statsForecast')}
        subtitle={t('statsForecastSub', { total: fcTotal, avg: (fcTotal / range).toFixed(1) })}
        legend={forecastSeries}
        table={{ headers: [t('date'), t('learning'), t('young'), t('mature')], rows: fc.map((d) => [dateFmt.format(addStudyDays(now, d.day, dayStartHour)), d.learning, d.young, d.mature]) }}
      >
        <Segmented<'7' | '30' | '90'>
          label={t('statsRange')}
          value={String(range) as '7' | '30' | '90'}
          onChange={(v) => setRange(Number(v) as 7 | 30 | 90)}
          options={[{ value: '7', label: t('statsDays', { n: 7 }) }, { value: '30', label: t('statsDays', { n: 30 }) }, { value: '90', label: t('statsDays', { n: 90 }) }]}
        />
        <Columns
          labels={fc.map((d) => dayLabel(d.day))}
          series={forecastSeries}
          values={[fc.map((d) => d.learning), fc.map((d) => d.young), fc.map((d) => d.mature)]}
          labelEvery={range === 7 ? 1 : range === 30 ? 7 : 15}
          ariaLabel={t('statsForecast')}
          tip={(i) => (
            <>
              <b>{longDate.format(addStudyDays(now, fc[i].day, dayStartHour))}</b>
              <span>{t('statsDueCount', { count: fc[i].learning + fc[i].young + fc[i].mature })}</span>
              <span className="secondary">{t('learning')} {fc[i].learning} · {t('young')} {fc[i].young} · {t('mature')} {fc[i].mature}</span>
            </>
          )}
        />
      </ChartCard>

      {/* Buttons */}
      <ChartCard
        title={t('statsButtons')}
        subtitle={t('statsLast30')}
        legend={buttonSeries}
        table={{
          headers: ['', t('again'), t('hard'), t('good'), t('easy')],
          rows: (['learn', 'young', 'mature'] as const).map((k) => [t(k === 'learn' ? 'learning' : k), ...stats.buttons[k]]),
        }}
      >
        <StackedRows
          series={buttonSeries}
          rows={[
            { label: t('statsLearnCards'), values: stats.buttons.learn },
            { label: t('young'), values: stats.buttons.young },
            { label: t('mature'), values: stats.buttons.mature },
          ]}
        />
      </ChartCard>

      {/* Hours */}
      <ChartCard
        title={t('statsHours')}
        subtitle={bestHour ? t('statsBestHour', { hour: `${String(bestHour.hour).padStart(2, '0')}:00`, rate: pct(bestHour.pass / bestHour.total) }) : t('statsLast30')}
        table={{ headers: [t('statsHour'), t('statsReviews'), t('correctRate')], rows: stats.hours.map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.total, h.total ? pct(h.pass / h.total) : '—']) }}
      >
        <Columns
          labels={stats.hours.map((h) => String(h.hour))}
          series={[{ key: 'reviews', label: t('statsReviews'), color: C.one }]}
          values={[stats.hours.map((h) => h.total)]}
          labelEvery={6}
          ariaLabel={t('statsHours')}
          tip={(i) => (
            <>
              <b>{String(i).padStart(2, '0')}:00–{String(i).padStart(2, '0')}:59</b>
              <span>{t('statsReviewsCount', { count: stats.hours[i].total })}</span>
              <span className="secondary">{t('correctRate')} {stats.hours[i].total ? pct(stats.hours[i].pass / stats.hours[i].total) : '—'}</span>
            </>
          )}
        />
      </ChartCard>

      {/* Histograms */}
      <ChartCard
        title={t('statsIntervals')}
        subtitle={t('statsIntervalsSub')}
        table={{ headers: [t('statsInterval'), t('statsCards')], rows: stats.intervals.map((b) => [b.label, b.count]) }}
      >
        <Columns
          labels={stats.intervals.map((b) => b.label)}
          series={[{ key: 'cards', label: t('statsCards'), color: C.one }]}
          values={[stats.intervals.map((b) => b.count)]}
          labelEvery={2}
          ariaLabel={t('statsIntervals')}
          tip={(i) => <><b>{stats.intervals[i].label}</b><span>{t('statsCardsCount', { count: stats.intervals[i].count })}</span></>}
        />
      </ChartCard>
      <ChartCard
        title={t('statsEase')}
        subtitle={t('statsEaseSub')}
        table={{ headers: [t('statsEaseCol'), t('statsCards')], rows: stats.eases.map((b) => [b.label, b.count]) }}
      >
        <Columns
          labels={stats.eases.map((b) => b.label.replace('%', '').split('–')[0])}
          series={[{ key: 'cards', label: t('statsCards'), color: C.one }]}
          values={[stats.eases.map((b) => b.count)]}
          ariaLabel={t('statsEase')}
          tip={(i) => <><b>{stats.eases[i].label}</b><span>{t('statsCardsCount', { count: stats.eases[i].count })}</span></>}
        />
      </ChartCard>

      {/* Decks */}
      {stats.decks.length > 0 && (
        <section className="glass chart-card" aria-label={t('statsDeckProgress')}>
          <div className="chart-head"><h3 className="headline" style={{ flex: 1 }}>{t('statsDeckProgress')}</h3></div>
          <div className="stack" style={{ gap: 16 }}>
            {stats.decks.map((d) => {
              const learnedPct = d.total ? d.learned / d.total : 0;
              const maturePct = d.total ? d.mature / d.total : 0;
              return (
                <div key={d.deck.id} className="deck-progress">
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <span className="subhead" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deckName(d.deck.id)}</span>
                    <span className="footnote secondary num">{d.learned}/{d.total}</span>
                  </div>
                  <div className="progress" role="img" aria-label={t('statsDeckAria', { learned: Math.round(learnedPct * 100), mature: Math.round(maturePct * 100) })}>
                    <span style={{ width: `${maturePct * 100}%`, background: C.mature }} />
                    <span style={{ width: `${Math.max(0, learnedPct - maturePct) * 100}%`, background: C.young }} />
                  </div>
                  <div className="footnote secondary">
                    {t('statsDeckLine', { mature: Math.round(maturePct * 100), learned: Math.round(learnedPct * 100) })}
                    {' · '}
                    {d.finishDate
                      ? t('statsEta', { n: d.newLeft, days: d.daysLeft, date: dateFmt.format(d.finishDate), perDay: d.newPerDay })
                      : t('statsAllIntroduced')}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="legend" role="list">
            <span role="listitem" className="legend-item footnote"><i style={{ background: C.mature }} />{t('mature')}</span>
            <span role="listitem" className="legend-item footnote"><i style={{ background: C.young }} />{t('statsLearnedNotMature')}</span>
          </div>
        </section>
      )}

      {/* Hardest */}
      <section className="glass chart-card" aria-label={t('statsHardest')}>
        <div className="chart-head">
          <div style={{ flex: 1 }}>
            <h3 className="headline">{t('statsHardest')}</h3>
            <p className="footnote secondary" style={{ margin: 0 }}>{t('statsHardestSub')}</p>
          </div>
        </div>
        {stats.hardest.length === 0 ? (
          <p className="subhead secondary" style={{ margin: 0 }}>{t('statsNoHard')}</p>
        ) : (
          <ol className="hard-list">
            {stats.hardest.map((h) => (
              <li key={h.card.id}>
                <button className="hard-row" onClick={() => h.note && setEditing(h.note)}>
                  <span className="subhead hard-front">{front(h)}</span>
                  <span className="footnote secondary num">{t('statsLapses', { n: h.lapses })} · {t('statsAgainRate', { rate: pct(h.againRate) })} · {t('statsEaseShort', { ease: Math.round(h.card.ease * 100) })}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Leeches */}
      <section className="glass chart-card" aria-label={t('statsLeeches')}>
        <div className="chart-head">
          <div style={{ flex: 1 }}>
            <h3 className="headline">{t('statsLeeches')} · {stats.leeches.length}</h3>
            <p className="footnote secondary" style={{ margin: 0 }}>{t('statsLeechSub')}</p>
          </div>
        </div>
        {stats.leeches.length === 0 ? (
          <p className="subhead secondary" style={{ margin: 0 }}>{t('statsNoLeech')}</p>
        ) : (
          <ul className="hard-list">
            {(allLeeches ? stats.leeches : stats.leeches.slice(0, 10)).map((h) => (
              <li key={h.card.id} className="leech-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="subhead hard-front">{front(h)}</div>
                  <div className="footnote secondary">
                    {deckName(h.card.deckId)} · {t('statsLapses', { n: h.lapses })}
                    {h.card.suspended && ` · ${t('suspendedLabel')}`}
                  </div>
                </div>
                <div className="leech-actions">
                  <button className="icon-btn small" aria-label={`${t('edit')}: ${front(h)}`} onClick={() => h.note && setEditing(h.note)}><IconEdit size={18} /></button>
                  {h.card.suspended && (
                    <button className="icon-btn small" aria-label={`${t('unsuspend')}: ${front(h)}`} onClick={async () => { await setSuspended([h.card.id], false); toast(t('unsuspended')); }}><IconUnsuspend size={18} /></button>
                  )}
                  <button className="icon-btn small" aria-label={`${t('resetCard')}: ${front(h)}`} onClick={async () => { await resetCards([h.card.id]); toast(t('cardReset')); }}><IconReset size={18} /></button>
                  <button className="icon-btn small danger" aria-label={`${t('delete')}: ${front(h)}`} onClick={() => setDeleting(h)}><IconTrash size={18} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {stats.leeches.length > 10 && (
          <button className="btn small plain" onClick={() => setAllLeeches((v) => !v)}>
            {allLeeches ? t('showLess') : t('showAll', { count: stats.leeches.length })}
          </button>
        )}
      </section>

      <NoteEditor note={editing} onClose={() => setEditing(null)} />
      <ConfirmSheet
        open={!!deleting}
        title={t('delete')}
        message={deleting ? t('statsDeleteCard', { front: front(deleting) }) : ''}
        confirmLabel={t('delete')}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteCards([deleting.card.id]);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function keyAt(start: number, i: number, dayStartHour: number): string {
  const d = new Date(addStudyDays(start, i, dayStartHour));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
