import { ENVIRONMENTS } from '../scenes/environments';
import { RELATION_INFO, RELATIONS } from '../tasks/types';
import { summarize, type Acc, type BatchResult } from './evaluator';
import { REASONERS, type ReasonerId } from './reasoners';

const esc = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(result: BatchResult): string {
  const ids = REASONERS.map((r) => r.id);
  const head = [
    'idx', 'env', 'seed', 'shift_deg', 'viewer_azimuth_deg', 'viewer_height_m', 'viewer_distance_m',
    'relation', 'question', 'object_a', 'object_b', 'gold', 'margin',
    ...ids.map((i) => `pred_${i}`), ...ids.map((i) => `correct_${i}`), 'evidence',
  ];
  const rows = result.items.map((it) =>
    [
      it.idx, it.env, it.spec.seed, it.shiftDeg, it.viewer.azimuthDeg.toFixed(2), it.viewer.height.toFixed(3), it.viewer.distance.toFixed(3),
      it.relation, it.text, it.aName, it.bName ?? '', it.gold, Number.isFinite(it.margin) ? it.margin.toFixed(3) : '',
      ...ids.map((i) => it.preds[i]), ...ids.map((i) => (it.preds[i] === it.gold ? 1 : 0)), it.note,
    ].map(esc).join(','),
  );
  return [head.join(','), ...rows].join('\n') + '\n';
}

export function toJSON(result: BatchResult): string {
  return JSON.stringify({ format: 'egoversa.evaluation', version: 1, ...result, summary: summarize(result) }, null, 2);
}

export const pct = (a: Acc | undefined, digits = 1): string => (!a || a.n === 0 ? 'n/a' : `${(100 * a.acc).toFixed(digits)}%`);
const ci = (a: Acc): string => (a.n === 0 ? '' : ` [${(100 * a.lo).toFixed(1)}, ${(100 * a.hi).toFixed(1)}]`);

/** Markdown report built only from measured values in `result`. */
export function toMarkdownReport(result: BatchResult): string {
  const s = summarize(result);
  const c = result.config;
  const L: string[] = [];
  L.push('# EGOVERSA baseline benchmark report', '');
  L.push(
    `Engine \`${result.engine}\`. Generated ${result.startedAt}. ${s.nViews} views, ${s.nItems} scored questions, computed in ${result.durationMs} ms.`,
    '',
    '> Every number below is measured by running the built-in reasoners on procedurally generated scenes.',
    '> The reasoners are a geometric reference oracle, two hand-written heuristics and a seeded coin flip.',
    '> **No vision-language model was evaluated**; nothing here is a claim about any learned model.',
    '',
  );
  L.push('## Configuration', '', '```json', JSON.stringify(c, null, 2), '```', '');
  L.push(`Environments: ${c.envs.map((e) => ENVIRONMENTS[e].label).join(', ')}. Scenario seeds follow \`${c.baseSeed}/<env>/<index>\` for index 0..${c.scenariosPerEnv - 1}.`, '');

  L.push('## Dataset composition', '', '| Relation | Candidates | Scored | Ambiguous (tie) | Unaskable | Evaluated | Gold label balance |', '|---|---:|---:|---:|---:|---:|---|');
  for (const r of RELATIONS) {
    const k = s.candidates[r];
    const tot = k.scored + k.ambiguous + k.unaskable;
    const p = (n: number) => `${n} (${tot ? ((100 * n) / tot).toFixed(1) : '0.0'}%)`;
    const gold = Object.entries(s.goldCounts[r]).map(([g, n]) => `${g} ${n}`).join(' / ');
    const evaluated = Object.values(s.goldCounts[r]).reduce((a, b) => a + b, 0);
    L.push(`| ${RELATION_INFO[r].title} | ${tot} | ${p(k.scored)} | ${p(k.ambiguous)} | ${p(k.unaskable)} | ${evaluated} | ${gold} |`);
  }
  L.push('', `"Evaluated" is at most ${c.perRelation} scored questions per relation and view, chosen by a seeded, viewpoint-independent priority.`, '');

  L.push('## Accuracy by relation (95% Wilson interval)', '', `| Reasoner | Kind | Overall | ${RELATIONS.map((r) => RELATION_INFO[r].title).join(' | ')} |`, `|---|---|---:|${RELATIONS.map(() => '---:').join('|')}|`);
  for (const r of REASONERS) {
    L.push(`| ${r.name} | ${r.kind} | ${pct(s.overall[r.id])}${ci(s.overall[r.id])} | ${RELATIONS.map((rel) => pct(s.byRelation[r.id][rel]) + ci(s.byRelation[r.id][rel])).join(' | ')} |`);
  }
  L.push('');

  for (const rel of ['all', ...RELATIONS] as const) {
    L.push(`## Accuracy by viewpoint shift — ${rel === 'all' ? 'all relations' : RELATION_INFO[rel].title}`, '', `| Reasoner | ${s.shifts.map((x) => `${x}°`).join(' | ')} |`, `|---|${s.shifts.map(() => '---:').join('|')}|`);
    for (const r of REASONERS) L.push(`| ${r.name} | ${s.shifts.map((x) => pct(s.byShift[r.id][rel][x])).join(' | ')} |`);
    L.push(`| n | ${s.shifts.map((x) => s.byShift.oracle[rel][x].n).join(' | ')} |`, '');
  }

  L.push('## Accuracy by environment', '', `| Reasoner | ${c.envs.map((e) => ENVIRONMENTS[e].label).join(' | ')} |`, `|---|${c.envs.map(() => '---:').join('|')}|`);
  for (const r of REASONERS) L.push(`| ${r.name} | ${c.envs.map((e) => pct(s.byEnv[r.id][e])).join(' | ')} |`);
  L.push('');

  L.push('## Confusion matrices (rows = geometric ground truth, columns = prediction)', '');
  for (const id of ['world', 'image'] as ReasonerId[]) {
    const r = REASONERS.find((x) => x.id === id)!;
    L.push(`### ${r.name}`, '');
    for (const rel of RELATIONS) {
      const [a, b] = RELATION_INFO[rel].options;
      const m = s.confusion[id][rel];
      const g = (x: string, y: string) => m[x]?.[y] ?? 0;
      L.push(`${RELATION_INFO[rel].title}`, '', `| gold \\ pred | ${a} | ${b} |`, '|---|---:|---:|', `| ${a} | ${g(a, a)} | ${g(a, b)} |`, `| ${b} | ${g(b, a)} | ${g(b, b)} |`, '');
    }
  }
  L.push('## Reasoner inputs', '');
  for (const r of REASONERS) L.push(`- **${r.name}** (${r.kind}). Sees: ${r.input.replace(/\.$/, '')}. ${r.description}`);
  L.push('');
  return L.join('\n');
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
