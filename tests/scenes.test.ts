import { describe, expect, it } from 'vitest';
import { cameraFrame, cameraMetrics } from '../src/geometry/camera';
import { ENV_IDS, ENVIRONMENTS } from '../src/scenes/environments';
import { generateScene } from '../src/scenes/generate';
import { buildScenario, parseScenario } from '../src/scenes/scenario';
import type { SceneSpec } from '../src/scenes/types';

const spec = (env: SceneSpec['env'], seed: string, over: Partial<SceneSpec> = {}): SceneSpec => ({
  env, seed, objectCount: 8, occlusion: 0.5, distractors: 1, jitter: 0.5, ...over,
});

describe('procedural scenes', () => {
  it('provides three environments', () => {
    expect(ENV_IDS).toEqual(['tabletop', 'room', 'workbench']);
  });

  for (const env of ENV_IDS) {
    it(`${env}: deterministic for a seed, different across seeds`, () => {
      const a = generateScene(spec(env, 's1'));
      const b = generateScene(spec(env, 's1'));
      const c = generateScene(spec(env, 's2'));
      expect(JSON.stringify(a.objects)).toBe(JSON.stringify(b.objects));
      expect(a.fingerprint).toBe(b.fingerprint);
      expect(c.fingerprint).not.toBe(a.fingerprint);
    });

    it(`${env}: 5-10 uniquely named objects with known transforms, across many seeds`, () => {
      for (let i = 0; i < 40; i++) {
        for (const count of [5, 8, 10]) {
          const s = generateScene(spec(env, `seed-${i}`, { objectCount: count, occlusion: (i % 5) / 4, distractors: i % 4 }));
          expect(s.objects.length).toBeGreaterThanOrEqual(5);
          expect(s.objects.length).toBeLessThanOrEqual(10);
          expect(new Set(s.objects.map((o) => o.name)).size).toBe(s.objects.length);
          expect(new Set(s.objects.map((o) => o.id)).size).toBe(s.objects.length);
          for (const o of s.objects) {
            expect(o.parts.length).toBeGreaterThan(0);
            expect(o.center.every(Number.isFinite)).toBe(true);
            expect(o.size.every((v) => v > 0)).toBe(true);
          }
        }
      }
    });

    it(`${env}: footprints on the same surface do not overlap`, () => {
      for (let i = 0; i < 25; i++) {
        const s = generateScene(spec(env, `overlap-${i}`, { objectCount: 10, occlusion: 1 }));
        for (let a = 0; a < s.objects.length; a++)
          for (let b = a + 1; b < s.objects.length; b++) {
            const A = s.objects[a];
            const B = s.objects[b];
            if (A.region !== B.region) continue;
            const d = Math.hypot(A.position[0] - B.position[0], A.position[2] - B.position[2]);
            expect(d).toBeGreaterThanOrEqual((A.footprint + B.footprint) * 0.95);
          }
      }
    });

    it(`${env}: the default viewer keeps every object centre in frame`, () => {
      for (let i = 0; i < 20; i++) {
        const s = generateScene(spec(env, `frame-${i}`, { objectCount: 10 }));
        for (const az of [0, 90, 180, -90]) {
          const f = cameraFrame({ azimuthDeg: az, ...s.defaultViewer }, s.focus);
          for (const o of s.objects) expect(cameraMetrics(f, o.center).inFrustum).toBe(true);
        }
      }
    });
  }

  it('occlusion control adds occluder objects', () => {
    const none = generateScene(spec('tabletop', 'occ', { occlusion: 0 }));
    const full = generateScene(spec('tabletop', 'occ', { occlusion: 1 }));
    expect(none.objects.filter((o) => o.isOccluder).length).toBe(0);
    expect(full.objects.filter((o) => o.isOccluder).length).toBeGreaterThanOrEqual(2);
  });

  it('distractors share a noun with another object but never a full name', () => {
    const s = generateScene(spec('room', 'dis', { distractors: 3, occlusion: 0 }));
    const d = s.objects.filter((o) => o.isDistractor);
    expect(d.length).toBeGreaterThan(0);
    for (const o of d) expect(s.objects.some((x) => x !== o && x.noun === o.noun)).toBe(true);
  });

  it('every environment declares a pool large enough for 10 distinct objects', () => {
    for (const env of ENV_IDS) expect(ENVIRONMENTS[env].pool.length).toBeGreaterThanOrEqual(10);
  });
});

describe('scenario export / import', () => {
  it('round-trips to the exact same scene and viewpoint', () => {
    const scene = generateScene(spec('workbench', 'roundtrip'));
    const viewer = { azimuthDeg: 137.5, height: 1.8, distance: 2.9 };
    const json = JSON.stringify(buildScenario(scene, viewer, 'warm', 1.5));
    const parsed = parseScenario(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fingerprintMatches).toBe(true);
    expect(parsed.scene.fingerprint).toBe(scene.fingerprint);
    expect(JSON.stringify(parsed.scene.objects)).toBe(JSON.stringify(scene.objects));
    expect(parsed.scenario.viewer).toEqual(viewer);
    expect(parsed.scenario.lighting).toBe('warm');
    expect(parsed.scenario.toleranceScale).toBe(1.5);
  });

  it('rejects malformed input with a readable error and flags fingerprint drift', () => {
    expect(parseScenario('{nope').ok).toBe(false);
    expect(parseScenario({ format: 'other' }).ok).toBe(false);
    expect(parseScenario({ format: 'egoversa.scenario', version: 1, spec: { env: 'moon', seed: 'x' } }).ok).toBe(false);
    const drift = parseScenario({ format: 'egoversa.scenario', version: 1, spec: spec('room', 'x'), fingerprint: 'deadbeef' });
    expect(drift.ok && drift.fingerprintMatches).toBe(false);
  });

  it('clamps out-of-range viewer poses instead of failing', () => {
    const r = parseScenario({ format: 'egoversa.scenario', version: 1, spec: spec('tabletop', 'x'), viewer: { azimuthDeg: 20, height: 99, distance: 0 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.scenario.viewer.height).toBe(r.scene.limits.maxHeight);
      expect(r.scenario.viewer.distance).toBeGreaterThanOrEqual(r.scene.limits.minDistance);
    }
  });
});
