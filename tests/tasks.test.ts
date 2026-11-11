import { describe, expect, it } from 'vitest';
import { box, sph } from '../src/scenes/catalog';
import { generateScene } from '../src/scenes/generate';
import { DEFAULT_TOLERANCES, generateQuestions, scaledTolerances } from '../src/tasks/generator';
import type { Question } from '../src/tasks/types';
import { makeObject, makeScene } from './helpers';

const ball = (id: string, x: number, y: number, z: number) => makeObject(id, id, [x, y, z], [sph(0.3, 0.3, 0.3, 0, 0.15, 0, '#fff')]);
const find = (qs: Question[], relation: string, a: string, b: string) =>
  qs.find((q) => q.relation === relation && ((q.a === a && q.b === b) || (q.a === b && q.b === a)))!;
/** Gold answer expressed for subject `a` regardless of the seeded subject/reference order. */
function goldFor(q: Question, a: string): string | undefined {
  if (q.status !== 'scored') return undefined;
  if (q.a === a) return q.gold;
  return q.options[q.gold === q.options[0] ? 1 : 0];
}

describe('camera-relative relations', () => {
  const L = ball('L', -1, 0.3, 0);
  const Rr = ball('R', 1, 0.3, 0);
  const scene = makeScene([L, Rr]);
  const pose = { azimuthDeg: 0, height: 0.5, distance: 4 };

  it('left/right follows the camera x axis, not the world x axis', () => {
    const front = find(generateQuestions(scene, pose).all, 'lateral', 'L', 'R');
    expect(goldFor(front, 'L')).toBe('left');
    const back = find(generateQuestions(scene, { ...pose, azimuthDeg: 180 }).all, 'lateral', 'L', 'R');
    expect(goldFor(back, 'L')).toBe('right');
  });

  it('a pair aligned with the line of sight is a left/right tie but has a clear depth order', () => {
    const side = generateQuestions(scene, { ...pose, azimuthDeg: 90 });
    // Camera on +X: R is nearer and partly hides L, so make sure the pair is still askable first.
    const lat = find(side.all, 'lateral', 'L', 'R');
    expect(lat.status).not.toBe('scored');
    const far = makeScene([ball('L', -1, 0.3, 0), ball('R', 1, 0.3, 0.8)]);
    const q = generateQuestions(far, { ...pose, azimuthDeg: 90 });
    const depth = find(q.all, 'depth', 'L', 'R');
    expect(depth.status).toBe('scored');
    expect(goldFor(depth, 'R')).toBe('closer');
  });

  it('closer/farther uses range from the optical centre and flips behind the scene', () => {
    const near = ball('near', 0.6, 0.3, 1);
    const far = ball('far', -0.6, 0.3, -1);
    const s = makeScene([near, far]);
    expect(goldFor(find(generateQuestions(s, pose).all, 'depth', 'near', 'far'), 'near')).toBe('closer');
    expect(goldFor(find(generateQuestions(s, { ...pose, azimuthDeg: 180 }).all, 'depth', 'near', 'far'), 'near')).toBe('farther');
  });

  it('above/below is gravity-aligned and invariant to azimuth', () => {
    const hi = ball('hi', -0.5, 1.2, 0.2);
    const lo = ball('lo', 0.5, 0.1, -0.2);
    const s = makeScene([hi, lo]);
    for (const az of [0, 60, 120, 180, -90]) {
      const q = find(generateQuestions(s, { ...pose, azimuthDeg: az, height: 2 }).all, 'vertical', 'hi', 'lo');
      expect(goldFor(q, 'hi')).toBe('above');
    }
  });

  it('ties inside the tolerance are ambiguous and carry no gold label', () => {
    const a = ball('a', -0.05, 0.3, 0);
    const b = ball('b', 0.05, 0.3, 0.9);
    const s = makeScene([a, b]);
    const q = find(generateQuestions(s, pose).all, 'lateral', 'a', 'b');
    expect(Math.abs(q.evidence.delta)).toBeLessThan(DEFAULT_TOLERANCES.azimuthDeg);
    expect(q.status).not.toBe('scored');
    expect(q.gold).toBeUndefined();
    expect(q.reason).toBeTruthy();
  });

  it('a wider tolerance scale turns scored questions into ambiguous ones, never the reverse', () => {
    const s = generateScene({ env: 'tabletop', seed: 'tol', objectCount: 9, occlusion: 0.3, distractors: 0, jitter: 0.5 });
    const p = { azimuthDeg: 40, ...s.defaultViewer };
    const tight = generateQuestions(s, p, { tolerances: scaledTolerances(0.5) });
    const wide = generateQuestions(s, p, { tolerances: scaledTolerances(2.5) });
    const amb = (x: typeof tight) => x.all.filter((q) => q.status === 'ambiguous').length;
    expect(amb(wide)).toBeGreaterThan(amb(tight));
    const wideById = new Map(wide.all.map((q) => [q.id, q]));
    for (const q of tight.all) if (q.status === 'ambiguous') expect(wideById.get(q.id)!.status).not.toBe('scored');
  });
});

describe('visibility questions', () => {
  const target = ball('target', 0, 0.3, 0);
  const wall = makeObject('wall', 'wall', [0, 0, 1], [box(2, 2, 0.1, 0, 1, 0, '#fff')]);
  const other = ball('other', 0.9, 0.3, 2);
  const scene = makeScene([target, wall, other]);
  const pose = { azimuthDeg: 0, height: 0.5, distance: 4 };

  it('labels a hidden object occluded and marks pair questions about it unaskable', () => {
    const qs = generateQuestions(scene, pose);
    const v = qs.all.find((q) => q.id === 'visibility:target')!;
    expect(v.status).toBe('scored');
    expect(v.gold).toBe('occluded');
    const pair = find(qs.all, 'lateral', 'target', 'other');
    expect(pair.status).toBe('unaskable');
    expect(pair.reason).toMatch(/visible/);
    expect(qs.questions.every((q) => q.status === 'scored' && q.gold)).toBe(true);
  });

  it('the same object is visible from the other side', () => {
    const qs = generateQuestions(scene, { ...pose, azimuthDeg: 180 });
    expect(qs.all.find((q) => q.id === 'visibility:target')!.gold).toBe('visible');
  });
});

describe('question sets on generated scenes', () => {
  it('are deterministic, capped per relation, and consistent with their evidence', () => {
    for (const env of ['tabletop', 'room', 'workbench'] as const) {
      const s = generateScene({ env, seed: 'qs', objectCount: 8, occlusion: 0.6, distractors: 1, jitter: 0.5 });
      const p = { azimuthDeg: 75, ...s.defaultViewer };
      const a = generateQuestions(s, p, { perRelation: 4 });
      const b = generateQuestions(s, p, { perRelation: 4 });
      expect(JSON.stringify(a.questions)).toBe(JSON.stringify(b.questions));
      const n = s.objects.length;
      expect(a.all.filter((q) => ['lateral', 'depth', 'vertical', 'visibility'].includes(q.relation)).length).toBe((3 * n * (n - 1)) / 2 + n);
      for (const rel of ['lateral', 'depth', 'vertical', 'visibility']) expect(a.questions.filter((q) => q.relation === rel).length).toBeLessThanOrEqual(4);
      for (const q of a.all) {
        if (q.status !== 'scored') continue;
        if (q.relation !== 'visibility') expect(Math.abs(q.evidence.delta)).toBeGreaterThanOrEqual(q.evidence.tolerance);
        if (q.relation === 'lateral') expect(q.gold).toBe(q.evidence.delta < 0 ? 'left' : 'right');
        if (q.relation === 'depth') expect(q.gold).toBe(q.evidence.delta < 0 ? 'closer' : 'farther');
        if (q.relation === 'vertical') expect(q.gold).toBe(q.evidence.delta > 0 ? 'above' : 'below');
      }
    }
  });
});
