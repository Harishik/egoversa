import { describe, expect, it } from 'vitest';
import { cameraFrame, cameraMetrics, toCamera, viewerPosition, wrapDeg } from '../src/geometry/camera';
import { intersectUnit } from '../src/geometry/primitives';
import { castRay, getColliders } from '../src/geometry/raycast';
import { RNG, hashString } from '../src/geometry/rng';
import { computeVisibility } from '../src/geometry/visibility';
import type { Vec3 } from '../src/geometry/types';
import { box, sph } from '../src/scenes/catalog';
import { makeObject, makeScene } from './helpers';

describe('rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = new RNG('alpha');
    const b = new RNG('alpha');
    const c = new RNG('beta');
    const sa = Array.from({ length: 8 }, () => a.next());
    expect(Array.from({ length: 8 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 8 }, () => c.next())).not.toEqual(sa);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(hashString('x')).toBe(hashString('x'));
  });
});

describe('unit primitive intersection', () => {
  it('box: hits the near face at the exact distance', () => {
    expect(intersectUnit('box', 0, 0, 5, 0, 0, -1, 1e-6)).toBeCloseTo(4.5, 10);
    expect(intersectUnit('box', 2, 0, 5, 0, 0, -1, 1e-6)).toBe(Infinity);
  });
  it('sphere: tangent and central rays', () => {
    expect(intersectUnit('sphere', 0, 0, 3, 0, 0, -1, 1e-6)).toBeCloseTo(2.5, 10);
    expect(intersectUnit('sphere', 0.51, 0, 3, 0, 0, -1, 1e-6)).toBe(Infinity);
  });
  it('cylinder: side and cap hits', () => {
    expect(intersectUnit('cylinder', 3, 0, 0, -1, 0, 0, 1e-6)).toBeCloseTo(2.5, 10);
    expect(intersectUnit('cylinder', 0.2, 4, 0, 0, -1, 0, 1e-6)).toBeCloseTo(3.5, 10);
    expect(intersectUnit('cylinder', 3, 0.6, 0, -1, 0, 0, 1e-6)).toBe(Infinity);
  });
  it('cone: radius shrinks linearly toward the apex', () => {
    // At y = 0 the cone radius is 0.25.
    expect(intersectUnit('cone', 3, 0, 0, -1, 0, 0, 1e-6)).toBeCloseTo(2.75, 10);
    // At y = -0.5 (base) it is 0.5; just above the apex it misses.
    expect(intersectUnit('cone', 3, -0.4999, 0, -1, 0, 0, 1e-6)).toBeCloseTo(2.5, 3);
    expect(intersectUnit('cone', 3, 0.51, 0, -1, 0, 0, 1e-6)).toBe(Infinity);
    // Straight down the axis onto the apex.
    expect(intersectUnit('cone', 0, 4, 0, 0, -1, 0, 1e-6)).toBeCloseTo(3.5, 6);
  });
});

describe('camera frame', () => {
  const focus: Vec3 = [0, 1, 0];
  it('azimuth 0 sits on +Z and its x axis equals world X', () => {
    const f = cameraFrame({ azimuthDeg: 0, height: 1, distance: 3 }, focus);
    expect(f.position).toEqual([0, 1, 3]);
    expect(f.right[0]).toBeCloseTo(1);
    expect(f.forward[2]).toBeCloseTo(-1);
    expect(f.up[1]).toBeCloseTo(1);
  });
  it('is orthonormal and right-handed for arbitrary poses', () => {
    for (const az of [17, 95, -140, 180]) {
      const f = cameraFrame({ azimuthDeg: az, height: 2.3, distance: 2 }, focus);
      const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot(f.right, f.up)).toBeCloseTo(0);
      expect(dot(f.right, f.forward)).toBeCloseTo(0);
      expect(dot(f.up, f.forward)).toBeCloseTo(0);
      expect(dot(f.right, f.right)).toBeCloseTo(1);
      expect(f.right[1]).toBeCloseTo(0); // roll = 0: the camera x axis is horizontal
      expect(f.up[1]).toBeGreaterThan(0);
    }
  });
  it('the focus projects to the image centre at depth = distance to focus', () => {
    const pose = { azimuthDeg: 63, height: 2, distance: 3 };
    const f = cameraFrame(pose, focus);
    const m = cameraMetrics(f, focus);
    expect(m.ndcX).toBeCloseTo(0);
    expect(m.ndcY).toBeCloseTo(0);
    const p = viewerPosition(pose, focus);
    expect(m.depth).toBeCloseTo(Math.hypot(p[0] - focus[0], p[1] - focus[1], p[2] - focus[2]));
  });
  it('camera x differs from world x: a 180° orbit mirrors left and right', () => {
    const p: Vec3 = [1, 1, 0]; // on the world +X side
    const front = toCamera(cameraFrame({ azimuthDeg: 0, height: 1, distance: 3 }, focus), p);
    const back = toCamera(cameraFrame({ azimuthDeg: 180, height: 1, distance: 3 }, focus), p);
    expect(front[0]).toBeCloseTo(1);
    expect(back[0]).toBeCloseTo(-1);
    const side = toCamera(cameraFrame({ azimuthDeg: 90, height: 1, distance: 3 }, focus), p);
    expect(side[0]).toBeCloseTo(0); // world X is now pure depth
    expect(-side[2]).toBeCloseTo(2);
  });
  it('wrapDeg maps into (-180, 180]', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(360)).toBe(0);
  });
});

describe('ray casting and visibility', () => {
  const ball = makeObject('ball', 'ball', [0, 0, 0], [sph(0.4, 0.4, 0.4, 0, 0.5, 0, '#fff')]);
  const wall = makeObject('wall', 'wall', [0, 0, 1], [box(2, 2, 0.1, 0, 1, 0, '#fff')]);
  const pose = { azimuthDeg: 0, height: 0.5, distance: 4 };

  it('castRay returns the nearest owner and honours only/except', () => {
    const scene = makeScene([ball, wall]);
    const col = getColliders(scene);
    const hit = castRay(col, [0, 0.5, 4], [0, 0, -1]);
    expect(hit.owner).toBe('wall');
    expect(hit.t).toBeCloseTo(2.95, 6);
    expect(castRay(col, [0, 0.5, 4], [0, 0, -1], { except: 'wall' }).owner).toBe('ball');
    expect(castRay(col, [0, 0.5, 4], [0, 0, -1], { only: 'ball' }).t).toBeCloseTo(3.8, 6);
    expect(castRay(col, [0, 0.5, 4], [0, 1, 0]).owner).toBeNull();
  });

  it('a wall between camera and ball occludes it; from behind, it does not', () => {
    const scene = makeScene([ball, wall]);
    const col = getColliders(scene);
    const front = computeVisibility(scene, col, cameraFrame(pose, scene.focus));
    expect(front.get('ball')!.visibleFraction).toBe(0);
    expect(front.get('ball')!.occluders.wall).toBeGreaterThan(0);
    expect(front.get('wall')!.visibleFraction).toBe(1);
    const back = computeVisibility(scene, col, cameraFrame({ ...pose, azimuthDeg: 180 }, scene.focus));
    expect(back.get('ball')!.visibleFraction).toBe(1);
    expect(back.get('wall')!.visibleFraction).toBeLessThan(1); // the ball now hides part of the wall
  });

  it('an isolated object is fully visible and fully in frame', () => {
    const scene = makeScene([ball]);
    const v = computeVisibility(scene, getColliders(scene), cameraFrame(pose, scene.focus)).get('ball')!;
    expect(v.determinable).toBe(true);
    expect(v.visibleFraction).toBe(1);
    expect(v.inFrameFraction).toBe(1);
    // A sphere covers at most pi/4 (the box is the loose projection of its bounding cube) of its projected bounding rectangle.
    expect(v.amodalRays / 400).toBeGreaterThan(0.6);
    expect(v.amodalRays / 400).toBeLessThan(0.86);
  });

  it('half-covering occluder gives a fraction near one half', () => {
    const half = makeObject('half', 'half', [0.5, 0, 1], [box(1, 2, 0.1, 0, 1, 0, '#fff')]); // covers x in [0, 1]
    const scene = makeScene([ball, half]);
    const v = computeVisibility(scene, getColliders(scene), cameraFrame(pose, scene.focus)).get('ball')!;
    expect(v.visibleFraction).toBeGreaterThan(0.25);
    expect(v.visibleFraction).toBeLessThan(0.6);
  });
});
