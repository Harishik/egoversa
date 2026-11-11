/**
 * Batch evaluator. Everything here is deterministic given a BatchConfig:
 * the browser UI and `npm run benchmark` produce identical numbers.
 */
import { cameraFrame, wrapDeg, type ViewerPose } from '../geometry/camera';
import { RNG } from '../geometry/rng';
import { generateScene } from '../scenes/generate';
import { clampViewer } from '../scenes/scenario';
import type { EnvId, SceneSpec } from '../scenes/types';
import { generateQuestions, scaledTolerances, type RelationCounts } from '../tasks/generator';
import { RELATIONS, type Label, type Relation } from '../tasks/types';
import { buildContext, REASONERS, type ReasonerId } from './reasoners';

export const ENGINE_VERSION = 'egoversa-0.1.0';

export interface BatchConfig {
  baseSeed: string;
  envs: EnvId[];
  scenariosPerEnv: number;
  /** Viewpoint shifts from the canonical front view, degrees (magnitudes; sign is seeded). */
  shiftsDeg: number[];
  objectCount: number;
  occlusion: number;
  distractors: number;
  jitter: number;
  /** Oriented agent figures per scene (0..2); they enable observer-frame questions. */
  agents: number;
  /** Ambiguity knob: multiplies every tie tolerance (1 = default conventions). */
  toleranceScale: number;
  /** Scored questions kept per relation and view. */
  perRelation: number;
  /** Camera perturbation: ± fraction of the allowed height / distance range, seeded per view. */
  poseJitter: number;
}

export const DEFAULT_BATCH: BatchConfig = {
  baseSeed: 'egoversa-baseline',
  envs: ['tabletop', 'room', 'workbench'],
  scenariosPerEnv: 12,
  shiftsDeg: [0, 30, 60, 90, 120, 150, 180],
  objectCount: 8,
  occlusion: 0.5,
  distractors: 1,
  jitter: 0.5,
  agents: 1,
  toleranceScale: 1,
  perRelation: 6,
  poseJitter: 0.15,
};

export interface EvalItem {
  idx: number;
  env: EnvId;
  scenarioIndex: number;
  spec: SceneSpec;
  shiftDeg: number;
  viewer: ViewerPose;
  qid: string;
  relation: Relation;
  text: string;
  aName: string;
  bName?: string;
  gold: Label;
  margin: number;
  note: string;
  /** Observer-frame items: camera/observer heading offset in degrees. */
  thetaDeg?: number;
  preds: Record<ReasonerId, Label>;
}

export interface ViewRecord {
  env: EnvId;
  scenarioIndex: number;
  shiftDeg: number;
  candidates: Record<Relation, RelationCounts>;
}

export interface BatchResult {
  engine: string;
  config: BatchConfig;
  startedAt: string;
  durationMs: number;
  views: ViewRecord[];
  items: EvalItem[];
}

export function scenarioSpec(config: BatchConfig, env: EnvId, index: number): SceneSpec {
  return {
    env,
    seed: `${config.baseSeed}/${env}/${index}`,
    objectCount: config.objectCount,
    occlusion: config.occlusion,
    distractors: config.distractors,
    jitter: config.jitter,
    agents: config.agents ?? 0,
  };
}

/** Evaluate one scenario at every configured viewpoint shift. Synchronous and pure. */
export function evaluateScenario(config: BatchConfig, env: EnvId, index: number): { views: ViewRecord[]; items: EvalItem[] } {
  const spec = scenarioSpec(config, env, index);
  const scene = generateScene(spec);
  const tolerances = scaledTolerances(config.toleranceScale);
  const views: ViewRecord[] = [];
  const items: EvalItem[] = [];
  const { limits, defaultViewer } = scene;
  for (const shift of config.shiftsDeg) {
    const rng = new RNG(`${spec.seed}|view|${shift}`);
    const sign = shift === 0 || shift === 180 ? 1 : rng.chance(0.5) ? 1 : -1;
    const viewer = clampViewer(
      {
        azimuthDeg: wrapDeg(sign * shift),
        height: defaultViewer.height + rng.range(-1, 1) * config.poseJitter * (limits.maxHeight - limits.minHeight),
        distance: defaultViewer.distance + rng.range(-1, 1) * config.poseJitter * (limits.maxDistance - limits.minDistance),
      },
      scene,
    );
    const qs = generateQuestions(scene, viewer, { tolerances, perRelation: config.perRelation });
    views.push({ env, scenarioIndex: index, shiftDeg: shift, candidates: qs.stats });
    const viewKey = `${spec.seed}|${shift}`;
    const ctx = buildContext(scene, cameraFrame(viewer, scene.focus), viewKey);
    for (const q of qs.questions) {
      const preds = {} as Record<ReasonerId, Label>;
      for (const r of REASONERS) preds[r.id] = r.predict(q, ctx);
      items.push({
        idx: 0,
        env,
        scenarioIndex: index,
        spec: scene.spec,
        shiftDeg: shift,
        viewer,
        qid: q.id,
        relation: q.relation,
        text: q.text,
        aName: q.aName,
        bName: q.bName,
        gold: q.gold!,
        margin: q.evidence.margin,
        note: q.evidence.note,
        thetaDeg: q.thetaDeg,
        preds,
      });
    }
  }
  return { views, items };
}

export interface Progress {
  done: number;
  total: number;
}

function validate(config: BatchConfig): void {
  if (!config.envs.length) throw new Error('Select at least one environment.');
  if (!config.shiftsDeg.length) throw new Error('Select at least one viewpoint shift.');
  if (config.scenariosPerEnv < 1) throw new Error('Need at least one scenario per environment.');
}

function finish(config: BatchConfig, startedAt: string, t0: number, views: ViewRecord[], items: EvalItem[]): BatchResult {
  items.forEach((it, i) => (it.idx = i));
  return { engine: ENGINE_VERSION, config, startedAt, durationMs: Math.round(now() - t0), views, items };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Blocking run (Node script, tests). */
export function runBatchSync(config: BatchConfig): BatchResult {
  validate(config);
  const startedAt = new Date().toISOString();
  const t0 = now();
  const views: ViewRecord[] = [];
  const items: EvalItem[] = [];
  for (const env of config.envs)
    for (let i = 0; i < config.scenariosPerEnv; i++) {
      const r = evaluateScenario(config, env, i);
      views.push(...r.views);
      items.push(...r.items);
    }
  return finish(config, startedAt, t0, views, items);
}

/** Cooperative run for the UI: yields to the event loop between scenarios. */
export async function runBatch(config: BatchConfig, onProgress?: (p: Progress) => void, shouldCancel?: () => boolean): Promise<BatchResult> {
  validate(config);
  const startedAt = new Date().toISOString();
  const t0 = now();
  const views: ViewRecord[] = [];
  const items: EvalItem[] = [];
  const total = config.envs.length * config.scenariosPerEnv;
  let done = 0;
  for (const env of config.envs)
    for (let i = 0; i < config.scenariosPerEnv; i++) {
      if (shouldCancel?.()) throw new Error('cancelled');
      const r = evaluateScenario(config, env, i);
      views.push(...r.views);
      items.push(...r.items);
      done++;
      onProgress?.({ done, total });
      await new Promise((res) => setTimeout(res, 0));
    }
  return finish(config, startedAt, t0, views, items);
}

/* ------------------------------ aggregation ------------------------------ */

export interface Acc {
  n: number;
  correct: number;
  acc: number;
  /** 95% Wilson score interval. */
  lo: number;
  hi: number;
}

export function wilson(correct: number, n: number): Acc {
  if (n === 0) return { n: 0, correct: 0, acc: NaN, lo: NaN, hi: NaN };
  const z = 1.959964;
  const p = correct / n;
  const den = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { n, correct, acc: p, lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

export type RelationKey = Relation | 'all';
export const THETA_BINS = [0, 30, 60, 90, 120, 150, 180];

export interface Summary {
  nItems: number;
  nViews: number;
  shifts: number[];
  overall: Record<ReasonerId, Acc>;
  byRelation: Record<ReasonerId, Record<Relation, Acc>>;
  /** byShift[reasoner][relation|'all'][shift] */
  byShift: Record<ReasonerId, Record<RelationKey, Record<number, Acc>>>;
  byEnv: Record<ReasonerId, Partial<Record<EnvId, Acc>>>;
  /** Observer-frame relations by heading offset θ, in 30° bins (0, 30, ..., 180). byTheta[reasoner][relation][bin] */
  byTheta: Record<ReasonerId, Partial<Record<Relation, Record<number, Acc>>>>;
  /** confusion[reasoner][relation][gold][pred] = count */
  confusion: Record<ReasonerId, Record<Relation, Record<string, Record<string, number>>>>;
  candidates: Record<Relation, RelationCounts>;
  goldCounts: Record<Relation, Record<string, number>>;
}

class Tally {
  n = 0;
  c = 0;
  add(ok: boolean) {
    this.n++;
    if (ok) this.c++;
  }
  acc(): Acc {
    return wilson(this.c, this.n);
  }
}

export function summarize(result: Pick<BatchResult, 'items' | 'views'>): Summary {
  const ids = REASONERS.map((r) => r.id);
  const shifts = [...new Set(result.views.map((v) => v.shiftDeg))].sort((a, b) => a - b);
  const overall = new Map<string, Tally>();
  const get = (k: string) => {
    let t = overall.get(k);
    if (!t) overall.set(k, (t = new Tally()));
    return t;
  };
  const confusion = {} as Summary['confusion'];
  for (const id of ids) {
    confusion[id] = {} as Summary['confusion'][ReasonerId];
    for (const r of RELATIONS) confusion[id][r] = {};
  }
  const goldCounts = Object.fromEntries(RELATIONS.map((r) => [r, {}])) as Summary['goldCounts'];
  for (const it of result.items) {
    goldCounts[it.relation][it.gold] = (goldCounts[it.relation][it.gold] ?? 0) + 1;
    for (const id of ids) {
      const ok = it.preds[id] === it.gold;
      get(`${id}`).add(ok);
      get(`${id}|r|${it.relation}`).add(ok);
      get(`${id}|s|all|${it.shiftDeg}`).add(ok);
      get(`${id}|s|${it.relation}|${it.shiftDeg}`).add(ok);
      get(`${id}|e|${it.env}`).add(ok);
      if (it.thetaDeg !== undefined && it.relation !== 'facing') get(`${id}|t|${it.relation}|${Math.round(it.thetaDeg / 30) * 30}`).add(ok);
      const row = (confusion[id][it.relation][it.gold] ??= {});
      row[it.preds[id]] = (row[it.preds[id]] ?? 0) + 1;
    }
  }
  const acc = (k: string) => (overall.get(k) ?? new Tally()).acc();
  const envs = [...new Set(result.items.map((i) => i.env))];
  const candidates = Object.fromEntries(RELATIONS.map((r) => [r, { scored: 0, ambiguous: 0, unaskable: 0 }])) as Summary['candidates'];
  for (const v of result.views)
    for (const r of RELATIONS) {
      candidates[r].scored += v.candidates[r].scored;
      candidates[r].ambiguous += v.candidates[r].ambiguous;
      candidates[r].unaskable += v.candidates[r].unaskable;
    }
  const s: Summary = {
    nItems: result.items.length,
    nViews: result.views.length,
    shifts,
    overall: {} as Summary['overall'],
    byRelation: {} as Summary['byRelation'],
    byShift: {} as Summary['byShift'],
    byEnv: {} as Summary['byEnv'],
    byTheta: {} as Summary['byTheta'],
    confusion,
    candidates,
    goldCounts,
  };
  for (const id of ids) {
    s.overall[id] = acc(id);
    s.byRelation[id] = Object.fromEntries(RELATIONS.map((r) => [r, acc(`${id}|r|${r}`)])) as Record<Relation, Acc>;
    s.byShift[id] = Object.fromEntries(
      (['all', ...RELATIONS] as RelationKey[]).map((r) => [r, Object.fromEntries(shifts.map((sh) => [sh, acc(`${id}|s|${r}|${sh}`)]))]),
    ) as Record<RelationKey, Record<number, Acc>>;
    s.byEnv[id] = Object.fromEntries(envs.map((e) => [e, acc(`${id}|e|${e}`)]));
    s.byTheta[id] = Object.fromEntries(
      (['obs_lateral', 'obs_frontback'] as Relation[]).map((r) => [r, Object.fromEntries(THETA_BINS.map((b) => [b, acc(`${id}|t|${r}|${b}`)]))]),
    );
  }
  return s;
}
