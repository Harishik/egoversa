import { describe, expect, it } from 'vitest';
import { box, sph } from '../src/scenes/catalog';
import { generateScene } from '../src/scenes/generate';
import { generateQuestions } from '../src/tasks/generator';
import type { SceneObject } from '../src/scenes/types';
import { makeObject, makeScene } from './helpers';

const ball = (id: string, x: number, z: number) => makeObject(id, id, [x, 0, z], [sph(0.3, 0.3, 0.3, 0, 0.15, 0, '#fff')]);
/** An observer at the origin facing `front` (world unit vector). */
function observer(front: [number, number, number]): SceneObject {
  const o = makeObject('obs', 'obs', [0, 0, 0], [box(0.2, 0.4, 0.2, 0, 0.2, 0, '#fff')]);
  return { ...o, front, observerPhrase: 'standing where the obs stands' };
}
const pose = { azimuthDeg: 0, height: 2.5, distance: 5 }; // high camera: nothing hides anything
const q = (scene: ReturnType<typeof makeScene>, id: string, p = pose) => generateQuestions(scene, p).all.find((x) => x.id === id)!;

describe('observer-frame relations (perspective taking)', () => {
  it('left/right is defined in the observer frame, not the camera frame', () => {
    // Object on world +X. An observer facing -Z (same as the canonical camera) has it on the right...
    const same = makeScene([observer([0, 0, -1]), ball('a', 1.2, 0)]);
    expect(q(same, 'obs_lateral:a:obs').gold).toBe('right');
    expect(q(same, 'obs_lateral:a:obs').thetaDeg).toBeCloseTo(0, 5);
    // ...an observer facing +Z (toward the camera) has the very same object on its LEFT.
    const opposite = makeScene([observer([0, 0, 1]), ball('a', 1.2, 0)]);
    expect(q(opposite, 'obs_lateral:a:obs').gold).toBe('left');
    expect(q(opposite, 'obs_lateral:a:obs').thetaDeg).toBeCloseTo(180, 5);
  });

  it('does not depend on where the camera is', () => {
    const scene = makeScene([observer([1, 0, 0]), ball('a', 0.3, 1.3)]); // facing +X: +Z is to its right
    for (const az of [0, 70, 150, -120]) {
      const got = q(scene, 'obs_lateral:a:obs', { ...pose, azimuthDeg: az });
      if (got.status === 'scored') expect(got.gold).toBe('right');
    }
    expect(q(scene, 'obs_lateral:a:obs').status).toBe('scored');
  });

  it('front/behind follows the observer heading and ties near its side are ambiguous', () => {
    const scene = makeScene([observer([0, 0, 1]), ball('front', 0.2, 1.4), ball('back', -0.2, -1.4), ball('side', 1.4, 0.05)]);
    expect(q(scene, 'obs_frontback:front:obs').gold).toBe('front');
    expect(q(scene, 'obs_frontback:back:obs').gold).toBe('behind');
    const side = q(scene, 'obs_frontback:side:obs');
    expect(side.status).toBe('ambiguous');
    expect(side.gold).toBeUndefined();
    // straight ahead is a left/right tie
    expect(q(scene, 'obs_lateral:front:obs').status).toBe('ambiguous');
  });

  it('facing: toward / away / sideways-ambiguous relative to the camera', () => {
    expect(q(makeScene([observer([0, 0, 1])]), 'facing:obs').gold).toBe('toward'); // camera is on +Z
    expect(q(makeScene([observer([0, 0, -1])]), 'facing:obs').gold).toBe('away');
    expect(q(makeScene([observer([1, 0, 0])]), 'facing:obs').status).toBe('ambiguous');
    // Orbit the camera 180 degrees and the same object now faces away.
    expect(q(makeScene([observer([0, 0, 1])]), 'facing:obs', { ...pose, azimuthDeg: 180 }).gold).toBe('away');
  });

  it('objects without a defined front never become observers', () => {
    const scene = makeScene([ball('a', 1, 0), ball('b', -1, 0)]);
    expect(generateQuestions(scene, pose).all.some((x) => x.relation.startsWith('obs_') || x.relation === 'facing')).toBe(false);
  });
});

describe('agents in generated scenes', () => {
  const base = { env: 'room' as const, seed: 'agents', objectCount: 7, occlusion: 0.3, distractors: 0, jitter: 0.5 };
  it('agents are added without changing the base scene', () => {
    const none = generateScene({ ...base, agents: 0 });
    const two = generateScene({ ...base, agents: 2 });
    const strip = (s: typeof none) => JSON.stringify(s.objects.filter((o) => !o.isAgent));
    expect(strip(two)).toBe(strip(none));
    expect(two.objects.filter((o) => o.isAgent).length).toBeGreaterThanOrEqual(1);
    expect(two.fingerprint).not.toBe(none.fingerprint);
    for (const a of two.objects.filter((o) => o.isAgent)) {
      expect(Math.hypot(a.front![0], a.front![2])).toBeCloseTo(1, 3);
      expect(a.observerPhrase).toContain(a.name);
    }
    expect(new Set(two.objects.map((o) => o.name)).size).toBe(two.objects.length);
  });
  it('excluded nouns never appear', () => {
    for (let i = 0; i < 30; i++) {
      const s = generateScene({ ...base, seed: `ex-${i}`, objectCount: 10, exclude: ['ottoman', 'beanbag'] });
      expect(s.objects.some((o) => o.noun === 'ottoman' || o.noun === 'beanbag')).toBe(false);
      expect(s.objects.length).toBeGreaterThanOrEqual(5);
    }
  });
  it('the v0.1 default scene is still reproduced exactly when agents = 0', () => {
    expect(generateScene({ env: 'tabletop', seed: 'amber-harbor-42', objectCount: 8, occlusion: 0.5, distractors: 1, jitter: 0.5 }).fingerprint).toBe('92e75d92');
  });
});
