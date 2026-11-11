import { describe, expect, it } from 'vitest';
import { cameraFrame } from '../src/geometry/camera';
import { DEFAULT_BATCH, runBatchSync, summarize, wilson, type BatchConfig } from '../src/evaluation/evaluator';
import { toCSV, toJSON, toMarkdownReport } from '../src/evaluation/export';
import { buildContext, REASONERS, REASONER_BY_ID } from '../src/evaluation/reasoners';
import { buildPredictRequest } from '../src/evaluation/adapters';
import { generateScene } from '../src/scenes/generate';
import { generateQuestions } from '../src/tasks/generator';

const small: BatchConfig = { ...DEFAULT_BATCH, scenariosPerEnv: 4, baseSeed: 'unit-test' };

describe('batch evaluator', () => {
  const result = runBatchSync(small);
  const s = summarize(result);

  it('is reproducible from its configuration', () => {
    const again = runBatchSync(small);
    expect(JSON.stringify(again.items)).toBe(JSON.stringify(result.items));
    expect(JSON.stringify(again.views)).toBe(JSON.stringify(result.views));
  });

  it('covers every env x scenario x shift view and only emits scored items', () => {
    expect(result.views.length).toBe(3 * 4 * small.shiftsDeg.length);
    expect(result.items.length).toBeGreaterThan(200);
    for (const it of result.items) {
      expect(it.gold).toBeTruthy();
      for (const r of REASONERS) expect(it.preds[r.id]).toBeTruthy();
    }
  });

  it('the oracle reproduces the ground truth exactly (it is the reference, by construction)', () => {
    expect(s.overall.oracle.acc).toBe(1);
  });

  it('counts are internally consistent', () => {
    for (const r of REASONERS) {
      const sumRel = Object.values(s.byRelation[r.id]).reduce((a, b) => a + b.n, 0);
      expect(sumRel).toBe(s.nItems);
      const sumShift = Object.values(s.byShift[r.id].all).reduce((a, b) => a + b.n, 0);
      expect(sumShift).toBe(s.nItems);
      const conf = Object.values(s.confusion[r.id]).flatMap((m) => Object.values(m).flatMap((row) => Object.values(row))).reduce((a, b) => a + b, 0);
      expect(conf).toBe(s.nItems);
    }
  });

  it('the world-axis heuristic is viewpoint-sensitive on left/right and invariant on above/below', () => {
    const lat = s.byShift.world.lateral;
    expect(lat[0].acc).toBeGreaterThan(0.9);
    expect(lat[180].acc).toBeLessThan(0.1);
    expect(s.byRelation.world.vertical.acc).toBe(1);
  });

  it('the image-plane heuristic gets left/right right but not everything else', () => {
    expect(s.byRelation.image.lateral.acc).toBeGreaterThan(0.97);
    expect(s.byRelation.image.depth.acc).toBeLessThan(0.97);
    expect(s.overall.image.acc).toBeLessThan(1);
  });

  it('exports CSV / JSON / Markdown from the measured items', () => {
    const csv = toCSV(result).trim().split('\n');
    expect(csv.length).toBe(result.items.length + 1);
    expect(csv[0]).toContain('pred_world');
    const json = JSON.parse(toJSON(result));
    expect(json.items.length).toBe(result.items.length);
    expect(json.summary.overall.oracle.acc).toBe(1);
    const md = toMarkdownReport(result);
    expect(md).toContain('No vision-language model was evaluated');
    expect(md).toContain(`${s.nItems} scored questions`);
  });

  it('wilson interval behaves', () => {
    const w = wilson(50, 100);
    expect(w.lo).toBeLessThan(0.5);
    expect(w.hi).toBeGreaterThan(0.5);
    expect(w.hi - w.lo).toBeLessThan(0.2);
    expect(Number.isNaN(wilson(0, 0).acc)).toBe(true);
  });
});

describe('reasoner inputs', () => {
  it('heuristic contexts expose only world centres and 2D boxes', () => {
    const scene = generateScene({ env: 'tabletop', seed: 'ctx', objectCount: 6, occlusion: 0, distractors: 0, jitter: 0 });
    const pose = { azimuthDeg: 0, ...scene.defaultViewer };
    const ctx = buildContext(scene, cameraFrame(pose, scene.focus), 'k');
    expect(Object.keys(ctx).sort()).toEqual(['image', 'viewKey', 'world']);
    expect(Object.keys([...ctx.world.values()][0]).sort()).toEqual(['x', 'y', 'z']);
    expect(Object.keys([...ctx.image.values()][0]).sort()).toEqual(['x0', 'x1', 'y0', 'y1']);
    const q = generateQuestions(scene, pose).questions[0];
    expect(REASONER_BY_ID.chance.predict(q, ctx)).toBe(REASONER_BY_ID.chance.predict(q, ctx));
  });
});

describe('model adapter contract', () => {
  it('requests carry a model id, images, a question and options — nothing else', () => {
    const req = buildPredictRequest('qwen3.5-0.8b-base', ['data:image/png;base64,AAAA'], 'Is the red mug left or right of the blue book?', ['left', 'right', 'unknown']);
    expect(Object.keys(req).sort()).toEqual(['images', 'model', 'options', 'question']);
    expect(JSON.stringify(req)).not.toMatch(/gold|seed|azimuth|center|visibleFraction|fingerprint/);
  });
});

describe('observer-frame benchmark', () => {
  const r = runBatchSync({ ...DEFAULT_BATCH, scenariosPerEnv: 6, baseSeed: 'unit-observer', agents: 2 });
  const s = summarize(r);
  it('produces observer and facing items with a heading offset', () => {
    expect(s.byRelation.oracle.obs_lateral.n).toBeGreaterThan(50);
    expect(s.byRelation.oracle.facing.n).toBeGreaterThan(10);
    expect(r.items.filter((i) => i.relation === 'obs_lateral').every((i) => i.thetaDeg !== undefined && i.thetaDeg >= 0 && i.thetaDeg <= 180)).toBe(true);
    expect(s.byRelation.oracle.obs_lateral.acc).toBe(1);
  });
  it('the camera-egocentric shortcut is right when the observer looks the same way as the camera and wrong when it faces it', () => {
    const t = s.byTheta.image.obs_lateral!;
    expect(t[0].n + t[30].n).toBeGreaterThan(5);
    expect((t[0].correct + t[30].correct) / (t[0].n + t[30].n)).toBeGreaterThan(0.85);
    expect((t[150].correct + t[180].correct) / (t[150].n + t[180].n)).toBeLessThan(0.15);
  });
});
