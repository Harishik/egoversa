import { partCorners } from '../src/geometry/raycast';
import type { Vec3 } from '../src/geometry/types';
import type { Part, Scene, SceneObject } from '../src/scenes/types';

export function makeObject(id: string, name: string, position: Vec3, parts: Part[]): SceneObject {
  const corners = parts.flatMap((p) => partCorners(position, 0, p));
  const lo = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k])));
  return {
    id, name, noun: name, colorName: '', category: 'test', position, rotationY: 0, parts,
    center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
    size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
    corners, footprint: 0.1, isOccluder: false, isDistractor: false, isAgent: false, region: 'test',
  };
}

export function makeScene(objects: SceneObject[], fingerprint = 'test0000'): Scene {
  return {
    spec: { env: 'tabletop', seed: 'test', objectCount: objects.length, occlusion: 0, distractors: 0, jitter: 0 },
    objects, fixtures: [], walls: [], focus: [0, 0.5, 0],
    defaultViewer: { height: 0.5, distance: 4 },
    limits: { minHeight: 0.1, maxHeight: 5, minDistance: 1, maxDistance: 10 },
    extent: 2, fingerprint,
  };
}

