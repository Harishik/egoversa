/**
 * Visibility oracle: per-object "unoccluded fraction" from the active viewpoint.
 *
 * For each object we lay a G x G grid of camera rays over its projected
 * bounding rectangle. A ray that hits the object when every other object is
 * ignored belongs to the object's AMODAL silhouette. Among amodal rays that
 * fall inside the image frame, the ray is VISIBLE iff nothing else is hit
 * before the object. This is the modal / amodal mask-area ratio estimated by
 * ray casting — not a bounding-box overlap guess.
 *
 * Scope: all geometry is opaque. There is no transparency, refraction or
 * partial coverage model.
 */
import { VIEWER_NEAR, toCamera, type CameraFrame } from './camera';
import { castRay, type Collider } from './raycast';
import type { Vec3 } from './types';
import type { Scene } from '../scenes/types';

export const VIS_GRID = 20;
export const MIN_AMODAL_RAYS = 12;

export interface NdcBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface VisibilityResult {
  objectId: string;
  /** Projected bounding rectangle of the whole object (NDC, not clipped). Null if any part is behind the camera. */
  bbox: NdcBox | null;
  amodalRays: number;
  inFrameRays: number;
  visibleRays: number;
  /** inFrameRays / amodalRays */
  inFrameFraction: number;
  /** visibleRays / inFrameRays */
  visibleFraction: number;
  /** False when the silhouette is too small / behind the camera to estimate reliably. */
  determinable: boolean;
  /** Owner id -> number of rays it blocked. */
  occluders: Record<string, number>;
}

export function projectedBounds(frame: CameraFrame, corners: Vec3[]): NdcBox | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of corners) {
    const [xc, yc, zc] = toCamera(frame, c);
    const depth = -zc;
    if (depth <= VIEWER_NEAR) return null;
    const u = xc / (depth * frame.tanHalfFov * frame.aspect);
    const v = yc / (depth * frame.tanHalfFov);
    if (u < x0) x0 = u;
    if (u > x1) x1 = u;
    if (v < y0) y0 = v;
    if (v > y1) y1 = v;
  }
  return { x0, y0, x1, y1 };
}

export function computeVisibility(
  scene: Scene,
  colliders: Collider[],
  frame: CameraFrame,
  grid = VIS_GRID,
): Map<string, VisibilityResult> {
  const out = new Map<string, VisibilityResult>();
  const { right, up, forward, position, tanHalfFov, aspect } = frame;
  const dir: Vec3 = [0, 0, 0];
  for (const obj of scene.objects) {
    const bbox = projectedBounds(frame, obj.corners);
    const res: VisibilityResult = {
      objectId: obj.id,
      bbox,
      amodalRays: 0,
      inFrameRays: 0,
      visibleRays: 0,
      inFrameFraction: 0,
      visibleFraction: 0,
      determinable: false,
      occluders: {},
    };
    out.set(obj.id, res);
    if (!bbox) continue;
    for (let j = 0; j < grid; j++) {
      const v = bbox.y0 + ((j + 0.5) / grid) * (bbox.y1 - bbox.y0);
      for (let i = 0; i < grid; i++) {
        const u = bbox.x0 + ((i + 0.5) / grid) * (bbox.x1 - bbox.x0);
        const a = u * tanHalfFov * aspect;
        const b = v * tanHalfFov;
        let dx = forward[0] + a * right[0] + b * up[0];
        let dy = forward[1] + a * right[1] + b * up[1];
        let dz = forward[2] + a * right[2] + b * up[2];
        const l = Math.hypot(dx, dy, dz);
        dx /= l;
        dy /= l;
        dz /= l;
        dir[0] = dx;
        dir[1] = dy;
        dir[2] = dz;
        const own = castRay(colliders, position, dir, { only: obj.id });
        if (own.owner === null) continue;
        res.amodalRays++;
        if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
        res.inFrameRays++;
        const other = castRay(colliders, position, dir, { except: obj.id, tMax: own.t - 1e-4 });
        if (other.owner === null) res.visibleRays++;
        else res.occluders[other.owner] = (res.occluders[other.owner] ?? 0) + 1;
      }
    }
    res.inFrameFraction = res.amodalRays ? res.inFrameRays / res.amodalRays : 0;
    res.visibleFraction = res.inFrameRays ? res.visibleRays / res.inFrameRays : 0;
    res.determinable = res.amodalRays >= MIN_AMODAL_RAYS;
  }
  return out;
}

/** Name of the collider owner that blocks the most rays, if any. */
export function mainOccluder(res: VisibilityResult): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [k, c] of Object.entries(res.occluders)) {
    if (c > n) {
      n = c;
      best = k;
    }
  }
  return best;
}
