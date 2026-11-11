import { useState } from 'react';
import { THETA_BINS, type Acc, type RelationKey, type Summary } from '../../evaluation/evaluator';
import { REASONERS, type ReasonerId } from '../../evaluation/reasoners';
import { RELATION_INFO, RELATIONS, type Relation } from '../../tasks/types';

const INK = '#E9ECFF';
const MUTED = '#A0A8D4';
const GRID = '#1C2450';
const pc = (v: number, d = 0) => `${(100 * v).toFixed(d)}%`;

export interface LineSeries {
  id: string;
  name: string;
  color: string;
  /** Reference lines (oracle, chance) are drawn dashed, thinner and without markers. */
  reference?: boolean;
  caption?: string;
  points: { x: number; a: Acc }[];
}

/** Accuracy (0..1) against an ordered numeric x axis. One y axis, hover crosshair, direct end labels, legend. */
export function LineChart({ xs, series, xLabel, ariaLabel, chance }: { xs: number[]; series: LineSeries[]; xLabel: string; ariaLabel: string; chance?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 680;
  const H = 300;
  const m = { l: 44, r: 104, t: 16, b: 38 };
  const x = (s: number) => m.l + (xs.length > 1 ? (s - xs[0]) / (xs[xs.length - 1] - xs[0]) : 0.5) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - v) * (H - m.t - m.b);
  const live = series.map((s) => ({ ...s, points: s.points.filter((p) => p.a && p.a.n > 0) }));
  const nearest = (clientX: number, el: SVGSVGElement) => {
    const rect = el.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    xs.forEach((s, i) => {
      if (Math.abs(x(s) - px) < Math.abs(x(xs[best]) - px)) best = i;
    });
    return best;
  };
  // Spread end labels so they never collide.
  const ends = live.filter((s) => s.points.length).map((s) => ({ id: s.id, name: s.name, yy: y(s.points[s.points.length - 1].a.acc) })).sort((a, b) => a.yy - b.yy);
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 13) ends[i].yy = ends[i - 1].yy + 13;
  const hs = hover === null ? null : xs[hover];
  if (!live.some((s) => s.points.length)) return <p className="rounded-xl border border-dashed border-night-600 px-4 py-8 text-center text-[13px] text-muted">No items fall on this axis for the current selection.</p>;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel} onMouseMove={(e) => setHover(nearest(e.clientX, e.currentTarget))} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={MUTED} className="num">{pc(v)}</text>
          </g>
        ))}
        {chance !== undefined && <line x1={m.l} x2={W - m.r} y1={y(chance)} y2={y(chance)} stroke="#7F8BC4" strokeWidth={1.2} strokeDasharray="2 5" />}
        {chance !== undefined && <text x={W - m.r + 10} y={y(chance) + 4} fontSize="11" fill={MUTED}>chance</text>}
        {xs.map((s) => (
          <text key={s} x={x(s)} y={H - m.b + 18} textAnchor="middle" fontSize="11" fill={MUTED} className="num">{s}°</text>
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill={MUTED}>{xLabel}</text>
        {hs !== null && <line x1={x(hs)} x2={x(hs)} y1={m.t} y2={H - m.b} stroke="#3A4585" strokeWidth={1} />}
        {live.map((s) => {
          const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.a.acc).toFixed(1)}`).join(' ');
          return (
            <g key={s.id}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.reference ? 1.5 : 2} strokeDasharray={s.reference ? '4 4' : undefined} opacity={s.reference ? 0.7 : 1} strokeLinejoin="round" />
              {!s.reference && s.points.map((p) => <circle key={p.x} cx={x(p.x)} cy={y(p.a.acc)} r={hs === p.x ? 5 : 4} fill={s.color} stroke="#0E1330" strokeWidth={2} />)}
            </g>
          );
        })}
        {ends.map((e) => (
          <text key={e.id} x={W - m.r + 10} y={e.yy + 4} fontSize="11.5" fontWeight="600" fill={INK}>{e.name}</text>
        ))}
      </svg>
      {hs !== null && (
        <div className="pointer-events-none absolute top-2 z-10 rounded-lg border border-night-500 bg-night-700 px-3 py-2 text-[12px] shadow-xl" style={{ left: `${(x(hs) / W) * 100}%`, transform: `translateX(${hover! > xs.length / 2 ? 'calc(-100% - 12px)' : '12px'})` }}>
          <p className="num mb-1 font-semibold text-ink">{hs}°</p>
          {series.map((s) => {
            const a = s.points.find((p) => p.x === hs)?.a;
            return (
              <p key={s.id} className="flex items-center gap-2 whitespace-nowrap text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
                <span className="num ml-auto pl-3 text-ink">{a && a.n ? pc(a.acc, 1) : 'n/a'}</span>
                <span className="num text-dim">n={a?.n ?? 0}</span>
              </p>
            );
          })}
        </div>
      )}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden><line x1="0" y1="4" x2="18" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.reference ? '4 3' : undefined} /></svg>
            {s.name}
            {s.caption && <span className="text-dim">({s.caption})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const reasonerSeries = (pick: (id: ReasonerId) => Record<number, Acc> | undefined, xs: number[]): LineSeries[] =>
  REASONERS.map((r) => ({ id: r.id, name: r.short, color: r.color, reference: r.kind !== 'heuristic', caption: r.kind, points: xs.map((x) => ({ x, a: pick(r.id)?.[x] as Acc })).filter((p) => p.a) }));

/** Accuracy against camera azimuth shift, one line per built-in reasoner. */
export function ShiftChart({ summary, relation }: { summary: Summary; relation: RelationKey }) {
  return (
    <LineChart
      xs={summary.shifts}
      series={reasonerSeries((id) => summary.byShift[id][relation], summary.shifts)}
      xLabel="Camera azimuth shift from the canonical front view"
      ariaLabel={`Accuracy by viewpoint shift for ${relation === 'all' ? 'all relations' : RELATION_INFO[relation].title}`}
    />
  );
}

/** Observer-frame accuracy against the heading offset θ between the camera and the reference viewer. */
export function ThetaChart({ summary, relation }: { summary: Summary; relation: Relation }) {
  return (
    <LineChart
      xs={THETA_BINS}
      series={reasonerSeries((id) => summary.byTheta[id]?.[relation], THETA_BINS)}
      xLabel="Heading offset θ between the camera and the observer (0° = same direction, 180° = facing the camera)"
      ariaLabel={`Accuracy by observer heading offset for ${RELATION_INFO[relation].title}`}
    />
  );
}

function cellBg(a: Acc): string {
  if (!a.n) return 'transparent';
  return `rgba(124,135,255,${(0.06 + 0.5 * a.acc).toFixed(3)})`;
}

/** Reasoner x relation accuracy, single-hue sequential shading, values always printed. */
export function AccuracyTable({ summary }: { summary: Summary }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-separate border-spacing-1 text-[12.5px]">
        <thead>
          <tr className="text-left text-muted">
            <th className="px-2 py-1 font-semibold">Reasoner</th>
            {RELATIONS.map((r) => <th key={r} className="px-2 py-1 text-right font-semibold">{RELATION_INFO[r].short}</th>)}
            <th className="px-2 py-1 text-right font-semibold">Overall</th>
          </tr>
        </thead>
        <tbody>
          {REASONERS.map((r) => (
            <tr key={r.id}>
              <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-semibold text-ink">
                <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.name}
                <span className="ml-2 font-medium text-dim">{r.kind}</span>
              </th>
              {[...RELATIONS.map((rel) => summary.byRelation[r.id][rel]), summary.overall[r.id]].map((a, i) => (
                <td key={i} className="num rounded-md px-2 py-1.5 text-right text-ink" style={{ background: cellBg(a) }} title={a.n ? `${a.correct}/${a.n} correct, 95% CI ${pc(a.lo, 1)}–${pc(a.hi, 1)}` : 'no items'}>
                  {a.n ? pc(a.acc, 1) : 'n/a'}
                  <span className="ml-1.5 text-[10.5px] text-muted">±{a.n ? ((a.hi - a.lo) * 50).toFixed(1) : '0'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ConfusionMatrix({ summary, reasoner, relation }: { summary: Summary; reasoner: ReasonerId; relation: Relation }) {
  const [a, b] = RELATION_INFO[relation].options;
  const m = summary.confusion[reasoner][relation];
  const g = (x: string, yy: string) => m[x]?.[yy] ?? 0;
  const rows = [a, b].map((gold) => ({ gold, cells: [a, b].map((pred) => g(gold, pred)), total: g(gold, a) + g(gold, b) }));
  return (
    <figure className="rounded-xl border hairline bg-night-900/60 p-3">
      <figcaption className="mb-2 text-[12.5px] font-semibold text-ink">{RELATION_INFO[relation].title}</figcaption>
      <table className="w-full border-separate border-spacing-1 text-[12px]">
        <thead>
          <tr className="text-muted">
            <th className="text-left font-medium">truth ↓ / predicted</th>
            <th className="font-semibold">{a}</th>
            <th className="font-semibold">{b}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.gold}>
              <th scope="row" className="text-left font-semibold text-muted">{row.gold}</th>
              {row.cells.map((n, j) => {
                const share = row.total ? n / row.total : 0;
                const correct = i === j;
                return (
                  <td key={j} className="num rounded-md px-2 py-2 text-center text-ink" style={{ background: correct ? `rgba(124,135,255,${0.08 + 0.5 * share})` : `rgba(255,122,144,${0.04 + 0.45 * share})` }} title={`${n} of ${row.total} items whose ground truth is "${row.gold}"`}>
                    {n}
                    <span className="block text-[10.5px] text-muted">{row.total ? pc(share) : 'n/a'}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** How many candidate questions were scored vs. excluded as ties or unaskable. */
export function Composition({ summary }: { summary: Summary }) {
  const parts = [
    { key: 'scored', label: 'Scored', color: '#7C87FF' },
    { key: 'ambiguous', label: 'Ambiguous (tie)', color: '#8A93BF' },
    { key: 'unaskable', label: 'Unaskable from the image', color: '#3A4585' },
  ] as const;
  return (
    <div>
      <div className="space-y-2">
        {RELATIONS.map((r) => {
          const c = summary.candidates[r];
          const total = c.scored + c.ambiguous + c.unaskable || 1;
          return (
            <div key={r} className="grid grid-cols-[110px_1fr] items-center gap-3 text-[12.5px]">
              <span className="font-medium text-muted">{RELATION_INFO[r].short}</span>
              <div className="flex h-5 gap-0.5" role="img" aria-label={`${RELATION_INFO[r].title}: ${c.scored} scored, ${c.ambiguous} ambiguous, ${c.unaskable} unaskable`}>
                {parts.map((p) => {
                  const n = c[p.key];
                  const share = n / total;
                  if (!n) return null;
                  return (
                    <div key={p.key} className="num grid place-items-center overflow-hidden rounded-[4px] text-[10.5px] font-semibold" style={{ width: `${share * 100}%`, background: p.color, color: p.key === 'unaskable' ? INK : '#0A0E22' }} title={`${p.label}: ${n} (${pc(share, 1)})`}>
                      {share > 0.09 ? pc(share) : ''}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />{p.label}</li>
        ))}
      </ul>
    </div>
  );
}
