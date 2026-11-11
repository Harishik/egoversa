/**
 * Exact ray intersection with unit primitives in their local frame.
 *
 *   box      : [-0.5, 0.5]^3
 *   sphere   : radius 0.5 at the origin
 *   cylinder : radius 0.5, axis +Y, y in [-0.5, 0.5] (capped)
 *   cone     : base radius 0.5 at y = -0.5, apex at y = +0.5 (capped base)
 *
 * Every scene part is one of these under an affine transform, so the ray is
 * mapped into local space (direction NOT re-normalised) and the returned
 * parameter t is directly the world-space distance along the world ray.
 */

export type PrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone';

const TINY = 1e-12;

export function intersectUnit(
  kind: PrimitiveKind,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  tMin: number,
): number {
  switch (kind) {
    case 'box':
      return hitBox(ox, oy, oz, dx, dy, dz, tMin);
    case 'sphere':
      return hitSphere(ox, oy, oz, dx, dy, dz, tMin);
    case 'cylinder':
      return hitCylinder(ox, oy, oz, dx, dy, dz, tMin);
    case 'cone':
      return hitCone(ox, oy, oz, dx, dy, dz, tMin);
  }
}

function hitBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin: number): number {
  let t0 = -Infinity;
  let t1 = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < TINY) {
      if (o[i] < -0.5 || o[i] > 0.5) return Infinity;
    } else {
      let ta = (-0.5 - o[i]) / d[i];
      let tb = (0.5 - o[i]) / d[i];
      if (ta > tb) {
        const s = ta;
        ta = tb;
        tb = s;
      }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
  }
  if (t0 > tMin) return t0;
  if (t1 > tMin) return t1;
  return Infinity;
}

function hitSphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin: number): number {
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - 0.25;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < TINY) return Infinity;
  const s = Math.sqrt(disc);
  const ta = (-b - s) / (2 * a);
  if (ta > tMin) return ta;
  const tb = (-b + s) / (2 * a);
  if (tb > tMin) return tb;
  return Infinity;
}

function hitCylinder(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin: number): number {
  let best = Infinity;
  const a = dx * dx + dz * dz;
  if (a > TINY) {
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - 0.25;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
        if (t > tMin && t < best) {
          const y = oy + t * dy;
          if (y >= -0.5 && y <= 0.5) best = t;
        }
      }
    }
  }
  if (Math.abs(dy) > TINY) {
    for (const cap of [-0.5, 0.5]) {
      const t = (cap - oy) / dy;
      if (t > tMin && t < best) {
        const x = ox + t * dx;
        const z = oz + t * dz;
        if (x * x + z * z <= 0.25) best = t;
      }
    }
  }
  return best;
}

function hitCone(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMin: number): number {
  // Lateral surface: x^2 + z^2 = k (0.5 - y)^2 with k = 0.25, y in [-0.5, 0.5].
  let best = Infinity;
  const k = 0.25;
  const h0 = 0.5 - oy;
  const a = dx * dx + dz * dz - k * dy * dy;
  const b = 2 * (ox * dx + oz * dz + k * h0 * dy);
  const c = ox * ox + oz * oz - k * h0 * h0;
  const consider = (t: number) => {
    if (t > tMin && t < best) {
      const y = oy + t * dy;
      if (y >= -0.5 && y <= 0.5) best = t;
    }
  };
  if (Math.abs(a) < TINY) {
    if (Math.abs(b) > TINY) consider(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      consider((-b - s) / (2 * a));
      consider((-b + s) / (2 * a));
    }
  }
  if (Math.abs(dy) > TINY) {
    const t = (-0.5 - oy) / dy;
    if (t > tMin && t < best) {
      const x = ox + t * dx;
      const z = oz + t * dz;
      if (x * x + z * z <= 0.25) best = t;
    }
  }
  return best;
}
