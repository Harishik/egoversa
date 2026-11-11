/**
 * Runs the built-in baseline benchmark headlessly and writes real results to reports/.
 *   npm run benchmark                # default configuration
 *   npm run benchmark -- --scenarios 30 --seed my-seed --name my-run
 *   flags: --occlusion 0..1  --tolerance 0.5..2.5  --full (also write per-item JSON)  --no-csv
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_BATCH, runBatchSync, summarize, type BatchConfig } from '../src/evaluation/evaluator';
import { pct, toCSV, toJSON, toMarkdownReport } from '../src/evaluation/export';
import { REASONERS } from '../src/evaluation/reasoners';

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const config: BatchConfig = {
  ...DEFAULT_BATCH,
  scenariosPerEnv: Number(arg('scenarios') ?? 40),
  baseSeed: arg('seed') ?? DEFAULT_BATCH.baseSeed,
  occlusion: Number(arg('occlusion') ?? DEFAULT_BATCH.occlusion),
  toleranceScale: Number(arg('tolerance') ?? DEFAULT_BATCH.toleranceScale),
};
const name = arg('name') ?? 'baseline-v0.1';

const result = runBatchSync(config);
const summary = summarize(result);
const dir = resolve(process.cwd(), 'reports');
mkdirSync(dir, { recursive: true });
const full = args.includes('--full');
const noCsv = args.includes('--no-csv');
// The summary is small and diff-friendly; the per-item JSON (tens of MB) is opt-in with --full.
writeFileSync(
  resolve(dir, `${name}.summary.json`),
  JSON.stringify({ format: 'egoversa.evaluation.summary', version: 1, engine: result.engine, config: result.config, startedAt: result.startedAt, summary }, null, 2),
);
if (full) writeFileSync(resolve(dir, `${name}.json`), toJSON(result));
if (!noCsv) writeFileSync(resolve(dir, `${name}.csv`), toCSV(result));
writeFileSync(resolve(dir, `${name}.md`), toMarkdownReport(result));

console.log(`views=${summary.nViews} scored_questions=${summary.nItems} time=${result.durationMs}ms`);
for (const r of REASONERS) {
  const rel = Object.entries(summary.byRelation[r.id]).map(([k, a]) => `${k}=${pct(a)}`).join(' ');
  console.log(`${r.name.padEnd(24)} overall=${pct(summary.overall[r.id]).padEnd(7)} ${rel}`);
}
console.log(`wrote reports/${name}.md, ${name}.summary.json${noCsv ? '' : `, ${name}.csv`}${full ? `, ${name}.json` : ''}`);
