/**
 * Scoring for vision-language-model runs. Pure functions shared by scripts/eval-models.ts (Node) and the
 * Models workspace (browser), so a result file is summarised identically wherever it is opened.
 */
import { wilson, type Acc } from './evaluator';

export interface ModelEvalItem {
  sample_id: string;
  split: string;
  task_type: string;
  relation: string | null;
  reference_frame: string;
  env: string;
  difficulty: string;
  theta_deg: number | null;
  ood_factors: string[];
  image_paths: string[];
  prompt: string;
  options: string[];
  gold: string;
  answerable: boolean;
  /** Raw model text, untouched. */
  raw: string;
  /** Parsed option, or null when the reply names no single admissible option. */
  pred: string | null;
  correct: boolean;
  latency_ms: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
}

export interface ModelEvalFile {
  format: 'egoversa.model-eval';
  version: 1;
  run_id: string;
  model: { id: string; label: string; role: string; hf_id: string; runtime: string; tag: string; revision: string | null; quantization: string | null; params_millions: number; license: string; track: string; size_bytes: number | null };
  dataset: { name: string; version: string; splits: string[]; lock_sha256: string | null; limit: number | null };
  generation: { temperature: number; max_new_tokens: number; seed: number; thinking: boolean };
  hardware: { cpu: string; cores: number; ram_gb: number; platform: string; accelerator: string };
  started_at: string;
  finished_at: string;
  /** Resident size of the loaded model reported by the runtime after the run, if available. */
  runtime_model_bytes: number | null;
  items: ModelEvalItem[];
}

export interface LatencyStats {
  n: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  /** Excludes the first item, which usually pays the model load. */
  warm_mean_ms: number;
  first_ms: number;
  mean_prompt_tokens: number;
}

export interface ModelEvalSummary {
  n: number;
  overall: Acc;
  byTask: Record<string, Acc>;
  bySplit: Record<string, Acc>;
  byFrame: Record<string, Acc>;
  byDifficulty: Record<string, Acc>;
  /** Observer-frame tasks, binned by camera/observer heading offset (0, 30, ..., 180). */
  byTheta: Record<string, Record<number, Acc>>;
  /** Per task: gold label -> predicted label (or "unparseable") -> count. */
  confusion: Record<string, Record<string, Record<string, number>>>;
  /** Replies that named no single admissible option. Scored as wrong. */
  unparseable: Acc;
  /** Among items whose answer IS determinable and where "unknown" was offered: how often the model abstained anyway. */
  overAbstention: Acc;
  /** Among items whose answer is NOT determinable: how often the model correctly said "unknown". */
  abstentionRecall: Acc;
  /** 1 - abstentionRecall among parseable replies: the model asserted a relation about a hidden object. */
  hiddenHallucination: Acc;
  /** Left/right tasks only: share of parseable replies that are the exact opposite side. */
  leftRightInversion: Acc;
  latency: LatencyStats;
}

const quantile = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : NaN);

export function summarizeModelEval(items: ModelEvalItem[]): ModelEvalSummary {
  const tally = new Map<string, [number, number]>();
  const add = (k: string, ok: boolean) => {
    const t = tally.get(k) ?? [0, 0];
    t[0]++;
    if (ok) t[1]++;
    tally.set(k, t);
  };
  const confusion: ModelEvalSummary['confusion'] = {};
  for (const it of items) {
    add('all', it.correct);
    add(`task|${it.task_type}`, it.correct);
    add(`split|${it.split}`, it.correct);
    add(`frame|${it.reference_frame}`, it.correct);
    add(`diff|${it.difficulty}`, it.correct);
    add('unparseable', it.pred === null);
    if (it.theta_deg !== null && (it.task_type === 'obs_lateral' || it.task_type === 'obs_frontback')) add(`theta|${it.task_type}|${Math.round(it.theta_deg / 30) * 30}`, it.correct);
    if (it.answerable && it.options.includes('unknown')) add('overAbstention', it.pred === 'unknown');
    if (!it.answerable) {
      add('abstentionRecall', it.pred === 'unknown');
      if (it.pred !== null) add('hiddenHallucination', it.pred !== 'unknown');
    }
    if (it.answerable && (it.gold === 'left' || it.gold === 'right') && it.pred !== null) add('lrInversion', (it.pred === 'left' || it.pred === 'right') && it.pred !== it.gold);
    const row = ((confusion[it.task_type] ??= {})[it.gold] ??= {});
    const p = it.pred ?? 'unparseable';
    row[p] = (row[p] ?? 0) + 1;
  }
  const acc = (k: string): Acc => {
    const t = tally.get(k) ?? [0, 0];
    return wilson(t[1], t[0]);
  };
  const group = (prefix: string) => Object.fromEntries([...tally.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => [k.slice(prefix.length), acc(k)]));
  const byTheta: ModelEvalSummary['byTheta'] = {};
  for (const k of tally.keys()) {
    if (!k.startsWith('theta|')) continue;
    const [, task, bin] = k.split('|');
    (byTheta[task] ??= {})[Number(bin)] = acc(k);
  }
  const lat = items.map((i) => i.latency_ms);
  const sorted = [...lat].sort((a, b) => a - b);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  return {
    n: items.length,
    overall: acc('all'),
    byTask: group('task|'),
    bySplit: group('split|'),
    byFrame: group('frame|'),
    byDifficulty: group('diff|'),
    byTheta,
    confusion,
    unparseable: acc('unparseable'),
    overAbstention: acc('overAbstention'),
    abstentionRecall: acc('abstentionRecall'),
    hiddenHallucination: acc('hiddenHallucination'),
    leftRightInversion: acc('lrInversion'),
    latency: {
      n: lat.length,
      mean_ms: mean(lat),
      p50_ms: quantile(sorted, 0.5),
      p95_ms: quantile(sorted, 0.95),
      warm_mean_ms: mean(lat.slice(1)),
      first_ms: lat[0] ?? NaN,
      mean_prompt_tokens: mean(items.map((i) => i.prompt_tokens ?? NaN).filter(Number.isFinite)),
    },
  };
}

/** Accuracy expected from answering uniformly at random among the offered options, per task. */
export function chanceByTask(items: ModelEvalItem[]): Record<string, number> {
  const sum: Record<string, [number, number]> = {};
  for (const it of items) {
    const s = (sum[it.task_type] ??= [0, 0]);
    s[0] += 1 / it.options.length;
    s[1]++;
  }
  return Object.fromEntries(Object.entries(sum).map(([k, [a, n]]) => [k, a / n]));
}

/**
 * Accuracy of always giving the most common correct answer of each task (computed from the gold labels).
 * This is the floor that matters for a model that collapses to one reply; uniform chance is not.
 */
export function majorityByTask(items: ModelEvalItem[]): Record<string, number> {
  const c: Record<string, Record<string, number>> = {};
  for (const it of items) {
    const t = (c[it.task_type] ??= {});
    t[it.gold] = (t[it.gold] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(c).map(([k, v]) => {
    const n = Object.values(v).reduce((a, b) => a + b, 0);
    return [k, Math.max(...Object.values(v)) / n];
  }));
}

/** Share of a model's replies on one task taken by its single most frequent answer (1 = always the same answer). */
export function answerCollapse(items: ModelEvalItem[]): Record<string, number> {
  const c: Record<string, Record<string, number>> = {};
  for (const it of items) {
    const t = (c[it.task_type] ??= {});
    const p = it.pred ?? 'unparseable';
    t[p] = (t[p] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.max(...Object.values(v)) / Object.values(v).reduce((a, b) => a + b, 0)]));
}
