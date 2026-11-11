/**
 * Analytic ray casting against the scene's opaque primitives.
 * The same Part list drives the renderer, so the oracle tests the geometry
 * that is drawn (the renderer tessellates curved surfaces with 32 segments;
 * the analytic surface is the limit of that mesh).
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { intersectUnit, type PrimitiveKind } from './primitives';
import type { Vec3 } from './types';
import type { Part, Scene } from '../scenes/types';

export interface Collider {
  /** Object id, or `fixture:<id>` for static geometry. */
  owner: string;
  kind: PrimitiveKind;
  /** Rows of the inverse world matrix (3x4, row-major). */
  inv: Float64Array;
  cx: number;
  cy: number;
  cz: number;
  /** Bounding-sphere radius (used only as a conservative early-out). */
  r: number;
}

const _m = new Matrix4();
const _obj = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();

/** World matrix of a part: T(obj) * Ry(obj) * T(part) * R(part) * S(part). */
export function partWorldMatrix(objPosition: Vec3, objRotationY: number, part: Part, out = new Matrix4()): Matrix4 {
  _obj.makeRotationY(objRotationY).setPosition(objPosition[0], objPosition[1], objPosition[2]);
  _e.set(part.rotation[0], part.rotation[1], part.rotation[2], 'XYZ');
  _q.setFromEuler(_e);
  _m.compose(new Vector3(...part.position), _q, new Vector3(...part.scale));
  return out.multiplyMatrices(_obj, _m);
}

const UNIT_CORNERS: Vec3[] = [];
for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) UNIT_CORNERS.push([x, y, z]);

export function partCorners(objPosition: Vec3, objRotationY: number, part: Part): Vec3[] {
  const m = partWorldMatrix(objPosition, objRotationY, part);
  const v = new Vector3();
  return UNIT_CORNERS.map((c) => {
    v.set(c[0], c[1], c[2]).applyMatrix4(m);
    return [v.x, v.y, v.z] as Vec3;
  });
}

function makeCollider(owner: string, objPosition: Vec3, objRotationY: number, part: Part): Collider {
  const m = partWorldMatrix(objPosition, objRotationY, part);
  const e = m.elements;
  const sx = Math.hypot(e[0], e[1], e[2]);
  const sy = Math.hypot(e[4], e[5], e[6]);
  const sz = Math.hypot(e[8], e[9], e[10]);
  const i = m.clone().invert().elements;
  return {
    owner,
    kind: part.kind,
    inv: new Float64Array([i[0], i[4], i[8], i[12], i[1], i[5], i[9], i[13], i[2], i[6], i[10], i[14]]),
    cx: e[12],
    cy: e[13],
    cz: e[14],
    r: 0.5 * Math.hypot(sx, sy, sz),
  };
}

const cache = new WeakMap<Scene, Collider[]>();

export function getColliders(scene: Scene): Collider[] {
  let c = cache.get(scene);
  if (!c) {
    c = [];
    for (const o of scene.objects) for (const p of o.parts) c.push(makeCollider(o.id, o.position, o.rotationY, p));
    for (const f of scene.fixtures) {
      if (!f.occludes) continue;
      for (const p of f.parts) c.push(makeCollider(`fixture:${f.id}`, [0, 0, 0], 0, p));
    }
    cache.set(scene, c);
  }
  return c;
}

const T_MIN = 1e-6;

function hitCollider(c: Collider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number): number {
  // Bounding-sphere rejection (direction is unit length).
  const lx = c.cx - ox;
  const ly = c.cy - oy;
  const lz = c.cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < -c.r || tca - c.r > tMax) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > c.r * c.r) return Infinity;
  const m = c.inv;
  const lox = m[0] * ox + m[1] * oy + m[2] * oz + m[3];
  const loy = m[4] * ox + m[5] * oy + m[6] * oz + m[7];
  const loz = m[8] * ox + m[9] * oy + m[10] * oz + m[11];
  const ldx = m[0] * dx + m[1] * dy + m[2] * dz;
  const ldy = m[4] * dx + m[5] * dy + m[6] * dz;
  const ldz = m[8] * dx + m[9] * dy + m[10] * dz;
  return intersectUnit(c.kind, lox, loy, loz, ldx, ldy, ldz, T_MIN);
}

export interface RayHit {
  t: number;
  owner: string | null;
}

/**
 * Nearest hit along a unit-direction ray.
 * `only`   : restrict to colliders with this owner.
 * `except` : skip colliders with this owner.
 */
export function castRay(
  colliders: Collider[],
  origin: Vec3,
  dir: Vec3,
  opts: { only?: string; except?: string; tMax?: number } = {},
): RayHit {
  const tMax = opts.tMax ?? Infinity;
  let best = tMax;
  let owner: string | null = null;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (opts.only !== undefined && c.owner !== opts.only) continue;
    if (opts.except !== undefined && c.owner === opts.except) continue;
    const t = hitCollider(c, origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], best);
    if (t < best) {
      best = t;
      owner = c.owner;
    }
  }
  return { t: owner === null ? Infinity : best, owner };
}
