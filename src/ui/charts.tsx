/**
 * Small hand-built SVG charts (no chart library): thin marks, 2px surface gaps, one axis,
 * hover/tap tooltips, and a table view for every chart.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';

export interface Series {
  key: string;
  label: string;
  color: string;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtNum = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString());

/** Clean axis maximum and 3-4 tick values. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Card frame: title, optional legend, chart, and a "table" toggle with the same numbers. */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: Series[];
  table?: { headers: string[]; rows: Array<Array<string | number>> };
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useT();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="glass chart-card" aria-label={title}>
      <div className="chart-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="headline">{title}</h3>
          {subtitle && <p className="footnote secondary" style={{ margin: 0 }}>{subtitle}</p>}
        </div>
        {actions}
        {table && (
          <button className="btn small plain" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? t('chartView') : t('tableView')}
          </button>
        )}
      </div>
      {legend && legend.length > 1 && !asTable && (
        <div className="legend" role="list">
          {legend.map((s) => (
            <span key={s.key} role="listitem" className="legend-item footnote">
              <i style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </div>
      )}
      {asTable && table ? (
        <div className="table-scroll">
          <table className="preview-table data-table">
            <thead>
              <tr>{table.headers.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div className="chart-tip" style={{ left, top: y }} role="status">
      {children}
    </div>
  );
}

/**
 * Columns along a category axis, optionally stacked. One y-axis, gridlines hairline, 4px rounded tops.
 */
export function Columns({
  labels,
  series,
  values,
  height = 160,
  labelEvery = 1,
  tip,
  ariaLabel,
}: {
  labels: string[];
  series: Series[];
  /** values[seriesIndex][categoryIndex] */
  values: number[][];
  height?: number;
  labelEvery?: number;
  tip?: (i: number) => ReactNode;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const totals = labels.map((_, i) => values.reduce((s, v) => s + (v[i] ?? 0), 0));
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] || 1;
  const padL = 34;
  const padB = 20;
  const plotW = width - padL - 4;
  const plotH = height - padB - 8;
  const band = plotW / Math.max(1, n);
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => 8 + plotH - (v / top) * plotH;

  const pick = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.floor((clientX - rect.left - padL) / band);
    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div
      ref={ref}
      className="chart"
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={padL} x2={width - 4} y1={y(tk)} y2={y(tk)} className="grid" />
            <text x={padL - 6} y={y(tk) + 4} textAnchor="end" className="axis">{fmtNum(tk)}</text>
          </g>
        ))}
        {labels.map((lab, i) => {
          const cx = padL + band * i + band / 2;
          let acc = 0;
          const segs = series.map((s, si) => {
            const v = values[si][i] ?? 0;
            const y0 = y(acc);
            acc += v;
            const y1 = y(acc);
            return { s, v, y0, y1, si };
          });
          const visible = segs.filter((sg) => sg.v > 0);
          return (
            <g key={i} opacity={hover === null || hover === i ? 1 : 0.45}>
              {visible.map((sg, k) => {
                const isTop = k === visible.length - 1;
                // 2px surface gap between stacked segments.
                const h = Math.max(0, sg.y0 - sg.y1 - (k > 0 ? 2 : 0));
                const yTop = sg.y1;
                return isTop ? (
                  <path key={sg.s.key} d={roundedTop(cx - barW / 2, yTop, barW, h, Math.min(4, barW / 2, h))} fill={sg.s.color} />
                ) : (
                  <rect key={sg.s.key} x={cx - barW / 2} y={yTop} width={barW} height={h} fill={sg.s.color} />
                );
              })}
              {i % labelEvery === 0 && (
                <text x={cx} y={height - 5} textAnchor="middle" className="axis">{lab}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && tip && (
        <Tooltip x={padL + band * hover + band / 2} y={Math.max(0, y(totals[hover]) - 8)} width={width}>
          {tip(hover)}
        </Tooltip>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.max(0, Math.min(r, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Single-series line (values 0..1 as percentages), crosshair tooltip, gaps for missing weeks. */
export function PercentLine({
  labels,
  values,
  color,
  height = 150,
  tip,
  ariaLabel,
  floor,
}: {
  labels: string[];
  values: Array<number | null>;
  color: string;
  height?: number;
  tip?: (i: number) => ReactNode;
  ariaLabel: string;
  /** Lower bound of the y-axis (e.g. 0.5 to zoom on retention). */
  floor?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const present = values.filter((v): v is number => v !== null);
  const lo = floor ?? Math.max(0, Math.floor(((present.length ? Math.min(...present) : 0.5) - 0.05) * 10) / 10);
  const ticks = [lo, (lo + 1) / 2, 1];
  const padL = 40;
  const padB = 20;
  const plotW = width - padL - 10;
  const plotH = height - padB - 10;
  const n = labels.length;
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const y = (v: number) => 10 + plotH - ((v - lo) / (1 - lo || 1)) * plotH;
  const segments: string[] = [];
  let cur = '';
  values.forEach((v, i) => {
    if (v === null) {
      if (cur) segments.push(cur);
      cur = '';
      return;
    }
    cur += `${cur ? 'L' : 'M'}${x(i)},${y(Math.max(lo, v))}`;
  });
  if (cur) segments.push(cur);

  const pick = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const i = Math.round(((clientX - rect.left - padL) / plotW) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  const lastIdx = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();

  return (
    <div ref={ref} className="chart" onPointerMove={(e) => pick(e.clientX)} onPointerDown={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.12" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={padL} x2={width - 10} y1={y(tk)} y2={y(tk)} className="grid" />
            <text x={padL - 6} y={y(tk) + 4} textAnchor="end" className="axis">{Math.round(tk * 100)}%</text>
          </g>
        ))}
        {segments.map((d, i) => (
          <g key={i}>
            <path d={`${d}V${y(lo)}H${d.split(',')[0].slice(1)}Z`} fill={`url(#${gid})`} />
            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {values.map((v, i) =>
          v === null ? null : (
            <circle key={i} cx={x(i)} cy={y(Math.max(lo, v))} r={i === hover || i === lastIdx ? 4.5 : 0} fill={color} className="dot" />
          ),
        )}
        {lastIdx !== undefined && values[lastIdx] !== null && (
          <text x={Math.min(x(lastIdx), width - 14)} y={y(Math.max(lo, values[lastIdx]!)) - 10} textAnchor="end" className="value-label">
            {Math.round(values[lastIdx]! * 100)}%
          </text>
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={10} y2={10 + plotH} className="crosshair" />}
        {labels.map((lab, i) =>
          (n - 1 - i) % Math.max(1, Math.ceil(n / 5)) === 0 ? (
            <text key={i} x={x(i)} y={height - 5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="axis">{lab}</text>
          ) : null,
        )}
      </svg>
      {hover !== null && tip && (
        <Tooltip x={x(hover)} y={0} width={width}>
          {tip(hover)}
        </Tooltip>
      )}
    </div>
  );
}

/** Donut with the legend (labels + values) beside it, so identity never relies on color alone. */
export function Donut({ segments, centerLabel, centerValue }: { segments: Array<Series & { value: number }>; centerLabel: string; centerValue: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 62;
  const r = 44;
  const C = 2 * Math.PI * ((R + r) / 2);
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 2 : 0;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg width={140} height={140} viewBox="0 0 140 140" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
        <circle cx={70} cy={70} r={(R + r) / 2} fill="none" stroke="var(--fill)" strokeWidth={R - r} />
        {total > 0 &&
          segments.map((s) => {
            if (!s.value) return null;
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.key}
                cx={70}
                cy={70}
                r={(R + r) / 2}
                fill="none"
                stroke={s.color}
                strokeWidth={hover === s.key ? R - r + 4 : R - r}
                strokeDasharray={`${Math.max(0.5, len - gap)} ${C}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 70 70)"
                onPointerEnter={() => setHover(s.key)}
                onPointerLeave={() => setHover(null)}
              />
            );
            acc += len;
            return el;
          })}
        <text x={70} y={68} textAnchor="middle" className="donut-value">{hover ? segments.find((s) => s.key === hover)?.value : centerValue}</text>
        <text x={70} y={86} textAnchor="middle" className="axis">{hover ? segments.find((s) => s.key === hover)?.label : centerLabel}</text>
      </svg>
      <ul className="donut-legend">
        {segments.map((s) => (
          <li key={s.key} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
            <i style={{ background: s.color }} aria-hidden="true" />
            <span className="subhead">{s.label}</span>
            <span className="subhead num">{s.value}</span>
            <span className="footnote tertiary num">{total ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 100% stacked horizontal bar per row (answer buttons). */
export function StackedRows({ rows, series }: { rows: Array<{ label: string; values: number[] }>; series: Series[] }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="stack" style={{ gap: 14 }}>
      {rows.map((row) => {
        const total = row.values.reduce((s, v) => s + v, 0);
        return (
          <div key={row.label}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="subhead">{row.label}</span>
              <span className="footnote secondary">{total}</span>
            </div>
            <div className="hbar" role="img" aria-label={`${row.label}: ${series.map((s, i) => `${s.label} ${row.values[i]}`).join(', ')}`}>
              {total === 0 ? (
                <span className="hbar-empty" />
              ) : (
                row.values.map((v, i) =>
                  v ? (
                    <span
                      key={series[i].key}
                      style={{ flexGrow: v, background: series[i].color }}
                      onPointerEnter={() => setHover(`${row.label}:${i}`)}
                      onPointerDown={() => setHover(`${row.label}:${i}`)}
                      onPointerLeave={() => setHover(null)}
                    />
                  ) : null,
                )
              )}
            </div>
            <div className="hbar-values footnote secondary">
              {series.map((s, i) => (
                <span key={s.key} className={hover === `${row.label}:${i}` ? 'active' : ''}>
                  {s.label} {total ? Math.round((row.values[i] / total) * 100) : 0}%
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One-year calendar heatmap: weeks as columns, sequential one-hue ramp. Scrolls to today. */
export function Heatmap({
  start,
  days,
  valueAt,
  labelAt,
  monthLabel,
}: {
  start: number;
  days: number;
  valueAt: (i: number) => number;
  labelAt: (i: number) => string;
  monthLabel: (i: number) => string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const startDow = new Date(start).getDay();
  const cell = 12;
  const gap = 3;
  const cols = Math.ceil((days + startDow) / 7);
  const values = Array.from({ length: days }, (_, i) => valueAt(i));
  const max = Math.max(...values, 0);
  const level = (v: number) => (v === 0 ? 0 : max <= 4 ? Math.min(4, v) : Math.min(4, 1 + Math.floor((v / max) * 3.999)));
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const width = cols * (cell + gap) + 4;
  return (
    <div className="heatmap">
      <div className="heatmap-scroll" ref={scroller}>
        <svg width={width} height={7 * (cell + gap) + 18} role="img" aria-label={labelAt(days - 1)}>
          {values.map((v, i) => {
            const pos = i + startDow;
            const cx = Math.floor(pos / 7) * (cell + gap);
            const cy = (pos % 7) * (cell + gap) + 16;
            const m = monthLabel(i);
            return (
              <g key={i}>
                {m && <text x={cx} y={10} className="axis">{m}</text>}
                <rect
                  x={cx}
                  y={cy}
                  width={cell}
                  height={cell}
                  rx={3}
                  className={`heat-${level(v)}${hover === i ? ' heat-hover' : ''}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="row heatmap-foot">
        <span className="footnote secondary" style={{ flex: 1 }} aria-live="polite">{hover !== null ? labelAt(hover) : ' '}</span>
        <span className="heat-scale" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heat-${l}`} />)}
        </span>
      </div>
    </div>
  );
}
