/**
 * Deterministic scene generation: (SceneSpec) -> Scene.
 * The same spec always yields the same objects, colours and world transforms.
 */
import { RNG, hashHex } from '../geometry/rng';
import { partCorners } from '../geometry/raycast';
import type { Vec3 } from '../geometry/types';
import { COLORS, COLOR_NAMES, type Template } from './catalog';
import { ENVIRONMENTS, type EnvDef, type Region } from './environments';
import type { Scene, SceneObject, SceneSpec } from './types';

export const OBJECT_COUNT_MIN = 5;
export const OBJECT_COUNT_MAX = 10;

export function normalizeSpec(spec: SceneSpec): SceneSpec {
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  return {
    env: spec.env in ENVIRONMENTS ? spec.env : 'tabletop',
    seed: String(spec.seed ?? '').slice(0, 64) || 'seed',
    objectCount: Math.round(clamp(Number(spec.objectCount) || 7, OBJECT_COUNT_MIN, OBJECT_COUNT_MAX)),
    occlusion: Math.round(clamp(Number(spec.occlusion) || 0, 0, 1) * 100) / 100,
    distractors: Math.round(clamp(Number(spec.distractors) || 0, 0, 3)),
    jitter: Math.round(clamp(Number(spec.jitter) || 0, 0, 1) * 100) / 100,
    agents: Math.round(clamp(Number(spec.agents) || 0, 0, 2)),
    exclude: Array.isArray(spec.exclude) ? [...new Set(spec.exclude.map(String))].sort() : [],
  };
}

interface Placed {
  x: number;
  z: number;
  r: number;
  region: Region;
  occluder: boolean;
}

function fits(tpl: Template, region: Region): boolean {
  return tpl.r <= region.maxR && tpl.h <= region.maxH;
}

function tryPlace(rng: RNG, env: EnvDef, tpl: Template, placed: Placed[], hug: number): { x: number; z: number; region: Region } | null {
  const regions = env.regions.filter((r) => fits(tpl, r));
  if (!regions.length) return null;
  const free = (x: number, z: number, region: Region) => {
    if (x - tpl.r < region.x0 || x + tpl.r > region.x1 || z - tpl.r < region.z0 || z + tpl.r > region.z1) return false;
    for (const p of placed) {
      if (p.region !== region) continue;
      if (Math.hypot(p.x - x, p.z - z) < (p.r + tpl.r) * 0.96) return false;
    }
    return true;
  };
  // Optionally huddle next to an occluder so some viewpoints hide this object.
  const occluders = placed.filter((p) => p.occluder && regions.includes(p.region));
  if (occluders.length && rng.chance(hug)) {
    for (let i = 0; i < 40; i++) {
      const o = rng.pick(occluders);
      const ang = rng.range(0, Math.PI * 2);
      const d = (o.r + tpl.r) * 0.98 + rng.range(0, env.unit);
      const x = o.x + Math.cos(ang) * d;
      const z = o.z + Math.sin(ang) * d;
      if (free(x, z, o.region)) return { x, z, region: o.region };
    }
  }
  // Weight by usable area, with a floor on depth so narrow shelves still receive objects.
  const areas = regions.map((r) => Math.max(0.001, (r.x1 - r.x0 - 2 * tpl.r) * Math.max(0.14, r.z1 - r.z0 - 2 * tpl.r)));
  const total = areas.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 160; i++) {
    let pick = rng.next() * total;
    let region = regions[0];
    for (let k = 0; k < regions.length; k++) {
      pick -= areas[k];
      if (pick <= 0) {
        region = regions[k];
        break;
      }
    }
    const x = rng.range(region.x0 + tpl.r, Math.max(region.x0 + tpl.r, region.x1 - tpl.r));
    const z = rng.range(region.z0 + tpl.r, Math.max(region.z0 + tpl.r, region.z1 - tpl.r));
    if (free(x, z, region)) return { x, z, region };
  }
  return null;
}

export function generateScene(input: SceneSpec): Scene {
  const spec = normalizeSpec(input);
  const env = ENVIRONMENTS[spec.env];
  const rng = new RNG(`egoversa/v1|${spec.env}|${spec.seed}|${spec.objectCount}|${spec.occlusion}|${spec.distractors}|${spec.jitter}`);

  const n = spec.objectCount;
  const nOcc = Math.min(Math.round(spec.occlusion * 3), env.occluders.length, n - 3);
  const nDis = Math.min(spec.distractors, Math.floor((n - nOcc) / 2));
  const nDistinct = n - nOcc - nDis;

  const excluded = new Set(spec.exclude ?? []);
  const pool = rng.shuffle(excluded.size ? env.pool.filter((tpl) => !excluded.has(tpl.noun)) : env.pool);
  const occPool = rng.shuffle(env.occluders).slice(0, nOcc);
  const queue: { tpl: Template; occluder: boolean; distractor: boolean }[] = [];
  for (const tpl of occPool) queue.push({ tpl, occluder: true, distractor: false });
  const distinct = pool.slice(0, nDistinct);
  const spare = pool.slice(nDistinct);
  for (const tpl of distinct) queue.push({ tpl, occluder: false, distractor: false });
  for (let i = 0; i < nDis; i++) queue.push({ tpl: distinct[i % distinct.length], occluder: false, distractor: true });

  const colorOrder = rng.shuffle(COLOR_NAMES);
  const usedColors = new Map<string, number>();
  const usedNames = new Set<string>();
  const pickColor = (noun: string): string => {
    const ranked = colorOrder.slice().sort((a, b) => (usedColors.get(a) ?? 0) - (usedColors.get(b) ?? 0));
    const c = ranked.find((name) => !usedNames.has(`${name} ${noun}`)) ?? ranked[0];
    usedColors.set(c, (usedColors.get(c) ?? 0) + 1);
    usedNames.add(`${c} ${noun}`);
    return c;
  };

  const placed: Placed[] = [];
  const objects: SceneObject[] = [];
  const hug = spec.occlusion * 0.85;

  const add = (tpl: Template, occluder: boolean, distractor: boolean, r: RNG = rng, agent = false): boolean => {
    const spot = tryPlace(r, env, tpl, placed, occluder || agent ? 0 : hug);
    if (!spot) return false;
    const colorName = pickColor(tpl.noun);
    const rotationY = agent ? r.range(-Math.PI, Math.PI) : spec.jitter > 0 ? r.range(-Math.PI, Math.PI) * spec.jitter : 0;
    const name = `${colorName} ${tpl.noun}`;
    const position: Vec3 = [round(spot.x), spot.region.y, round(spot.z)];
    const parts = tpl.build(COLORS[colorName]);
    const corners = parts.flatMap((p) => partCorners(position, rotationY, p));
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const c of corners) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], c[k]);
      hi[k] = Math.max(hi[k], c[k]);
    }
    placed.push({ x: position[0], z: position[2], r: tpl.r, region: spot.region, occluder });
    objects.push({
      id: `obj-${objects.length}`,
      name,
      noun: tpl.noun,
      colorName,
      category: tpl.category,
      position,
      rotationY,
      parts,
      center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
      size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
      corners,
      footprint: tpl.r,
      isOccluder: occluder,
      isDistractor: distractor,
      isAgent: agent,
      region: spot.region.id,
      front: tpl.front ? [round(Math.sin(rotationY)), 0, round(Math.cos(rotationY))] : undefined,
      observerPhrase: tpl.observerPhrase?.replace('{name}', name),
    });
    return true;
  };

  for (const q of queue) {
    if (add(q.tpl, q.occluder, q.distractor)) continue;
    // Could not fit this template: fall back to the smallest unused spare.
    const alt = spare.sort((a, b) => a.r - b.r).shift();
    if (alt) add(alt, false, false);
  }
  // Guarantee the lower bound even in pathological layouts.
  const small = env.pool.filter((tpl) => !excluded.has(tpl.noun)).sort((a, b) => a.r - b.r);
  for (let i = 0; objects.length < OBJECT_COUNT_MIN && i < small.length * 3; i++) add(small[i % small.length], false, true);

  // Agents come from their own RNG stream and are placed last: the base scene is unchanged by `agents`.
  if (spec.agents) {
    const rngA = new RNG(`egoversa/v1/agents|${spec.env}|${spec.seed}|${spec.agents}`);
    for (let i = 0; i < spec.agents; i++) add(env.agents[i % env.agents.length], false, false, rngA, true);
  }

  const fingerprint = hashHex(
    objects.map((o) => `${o.name}@${o.position.map((v) => v.toFixed(4)).join(',')}/${o.rotationY.toFixed(4)}`).join(';'),
  );

  return {
    spec,
    objects,
    fixtures: env.fixtures,
    walls: env.walls,
    focus: env.focus,
    defaultViewer: env.defaultViewer,
    limits: env.limits,
    extent: env.extent,
    fingerprint,
  };
}

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}
