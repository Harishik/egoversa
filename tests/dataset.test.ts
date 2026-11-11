import { describe, expect, it } from 'vitest';
import cases from './fixtures/parse_cases.json';
import { normalizeAnswer } from '../src/evaluation/parse';
import { summarizeModelEval, type ModelEvalItem } from '../src/evaluation/modelEval';
import { box, sph } from '../src/scenes/catalog';
import { generateScene } from '../src/scenes/generate';
import { buildPairItems, buildViewItems, modelPrompt, TASK_TYPES } from '../src/tasks/dataset';
import { makeObject, makeScene } from './helpers';

describe('answer parsing (shared vectors with the Python tooling)', () => {
  for (const c of cases as { raw: string; options: string[]; expected: string | null }[]) {
    it(`${JSON.stringify(c.raw)} -> ${c.expected}`, () => expect(normalizeAnswer(c.raw, c.options)).toBe(c.expected));
  }
});

const opts = { templates: [0, 1] as (0 | 1 | 2)[], salt: 'train' };
const spec = { env: 'tabletop' as const, seed: 'ds', objectCount: 8, occlusion: 0.8, distractors: 1, jitter: 0.6, agents: 2 };

describe('dataset items', () => {
  it('abstention: a pair question about a fully hidden object has the answer "unknown"', () => {
    const target = makeObject('target', 'target', [0, 0, 0], [sph(0.3, 0.3, 0.3, 0, 0.15, 0, '#fff')]);
    const wall = makeObject('wall', 'wall', [0, 0, 1], [box(1.2, 1.2, 0.1, 0, 0.6, 0, '#fff')]);
    const other = makeObject('other', 'other', [1.4, 0, 1.5], [sph(0.3, 0.3, 0.3, 0, 0.15, 0, '#fff')]);
    const scene = makeScene([target, wall, other]);
    const { items } = buildViewItems(scene, { azimuthDeg: 0, height: 0.5, distance: 4 }, opts);
    const abst = items.filter((i) => i.taskType === 'abstain');
    expect(abst.length).toBeGreaterThan(0);
    for (const a of abst) {
      expect(a.answer).toBe('unknown');
      expect(a.answerable).toBe(false);
      expect(a.options).toContain('unknown');
      expect(a.objectIds).toContain('target');
    }
    // From the other side the same object is visible, so nothing about it is an abstention any more.
    const back = buildViewItems(scene, { azimuthDeg: 180, height: 0.5, distance: 4 }, opts).items;
    expect(back.filter((i) => i.taskType === 'abstain' && i.objectIds.includes('target')).length).toBe(0);
  });

  it('every answer is one of the offered options and prompts carry no oracle data', () => {
    const scene = generateScene(spec);
    const poseA = { azimuthDeg: 20, ...scene.defaultViewer };
    const poseB = { azimuthDeg: 85, ...scene.defaultViewer };
    const A = buildViewItems(scene, poseA, opts);
    const B = buildViewItems(scene, poseB, opts);
    const all = [...A.items, ...B.items, ...buildPairItems(scene, poseA, poseB, A.set, B.set, opts)];
    expect(all.length).toBeGreaterThan(20);
    for (const it of all) {
      expect(TASK_TYPES).toContain(it.taskType);
      expect(it.options).toContain(it.answer);
      expect([0, 1]).toContain(it.templateId);
      const prompt = modelPrompt(it);
      expect(prompt).toContain(it.question);
      // no digits (coordinates, angles, fractions, seeds), no fingerprint, no explanation text
      expect(prompt).not.toMatch(/\d/);
      expect(prompt).not.toContain(scene.fingerprint);
      expect(prompt).not.toContain(it.explanation);
      expect(prompt.toLowerCase()).not.toMatch(/gold|oracle|azimuth|seed/);
    }
  });

  it('two-view items: camera motion sign and best view follow the geometry', () => {
    const scene = generateScene(spec);
    const p0 = { azimuthDeg: 10, ...scene.defaultViewer };
    const run = (az: number) => {
      const p1 = { ...p0, azimuthDeg: az };
      const A = buildViewItems(scene, p0, opts);
      const B = buildViewItems(scene, p1, opts);
      return { items: buildPairItems(scene, p0, p1, A.set, B.set, opts), A, B };
    };
    expect(run(70).items.find((i) => i.taskType === 'mv_camera_motion')!.answer).toBe('right');
    expect(run(-50).items.find((i) => i.taskType === 'mv_camera_motion')!.answer).toBe('left');
    expect(run(15).items.some((i) => i.taskType === 'mv_camera_motion')).toBe(false); // too small to ask
    const r = run(95);
    for (const it of r.items.filter((i) => i.taskType === 'mv_best_view')) {
      const fa = r.A.set.visibility.get(it.objectIds[0])!.visibleFraction;
      const fb = r.B.set.visibility.get(it.objectIds[0])!.visibleFraction;
      expect(it.answer).toBe(fa > fb ? 'first' : 'second');
      expect(Math.abs(fa - fb)).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('the OOD template family is disjoint from the training families', () => {
    const scene = generateScene(spec);
    const pose = { azimuthDeg: 20, ...scene.defaultViewer };
    const train = new Set(buildViewItems(scene, pose, opts).items.map((i) => i.question));
    const ood = buildViewItems(scene, pose, { templates: [2], salt: 'test_ood' }).items;
    expect(ood.length).toBeGreaterThan(0);
    for (const it of ood) expect(train.has(it.question)).toBe(false);
  });
});

describe('model evaluation summary', () => {
  const mk = (o: Partial<ModelEvalItem>): ModelEvalItem => ({
    sample_id: 'x', split: 'test_iid', task_type: 'lateral', relation: 'lateral', reference_frame: 'camera', env: 'room', difficulty: 'easy', theta_deg: null, ood_factors: [],
    image_paths: [], prompt: '', options: ['left', 'right', 'unknown'], gold: 'left', answerable: true, raw: '', pred: 'left', correct: true, latency_ms: 100, prompt_tokens: 200, output_tokens: 2, ...o,
  });
  it('separates inversion, over-abstention, abstention recall and unparseable replies', () => {
    const s = summarizeModelEval([
      mk({}),
      mk({ pred: 'right', correct: false }),
      mk({ pred: 'unknown', correct: false }),
      mk({ pred: null, correct: false }),
      mk({ task_type: 'abstain', gold: 'unknown', answerable: false, pred: 'unknown', correct: true }),
      mk({ task_type: 'abstain', gold: 'unknown', answerable: false, pred: 'left', correct: false }),
      mk({ task_type: 'obs_lateral', theta_deg: 172, pred: 'right', correct: false }),
    ]);
    expect(s.n).toBe(7);
    expect(s.overall.correct).toBe(2);
    expect(s.unparseable.correct).toBe(1);
    expect(s.overAbstention).toMatchObject({ n: 5, correct: 1 });
    expect(s.abstentionRecall).toMatchObject({ n: 2, correct: 1 });
    expect(s.hiddenHallucination).toMatchObject({ n: 2, correct: 1 });
    expect(s.leftRightInversion).toMatchObject({ n: 4, correct: 2 });
    expect(s.byTheta.obs_lateral[180].n).toBe(1);
    expect(s.confusion.lateral.left.unparseable).toBe(1);
  });
});
