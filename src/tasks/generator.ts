/**
 * Formal task generator.  scene + viewer pose -> camera-relative questions with
 * geometric ground truth.  A question is only `scored` when its answer
 * condition is well defined; ties are `ambiguous` and questions that cannot be
 * answered from the image alone are `unaskable`.  See docs/CONVENTIONS.md.
 */
import { cameraFrame, cameraMetrics, type CameraFrame, type CameraMetrics, type ViewerPose } from '../geometry/camera';
import { getColliders } from '../geometry/raycast';
import { hashString } from '../geometry/rng';
import { computeVisibility, mainOccluder, type VisibilityResult } from '../geometry/visibility';
import type { Scene, SceneObject } from '../scenes/types';
import { RELATION_INFO, RELATIONS, type Label, type Question, type QuestionStatus, type Relation, type Tolerances } from './types';

export const DEFAULT_TOLERANCES: Tolerances = {
  azimuthDeg: 4,
  rangeFrac: 0.05,
  heightFrac: 0.03,
  visibleMin: 0.7,
  occludedMax: 0.3,
  pairMinVisible: 0.35,
  inFrameMin: 0.8,
  observerDeg: 12,
  facingBandDeg: 30,
};

/**
 * One "ambiguity" knob for the UI and the batch evaluator.
 * scale = 1 is the default; larger values widen every tie band, so more
 * candidate questions are declared ambiguous and removed from scoring.
 */
export function scaledTolerances(scale: number): Tolerances {
  const s = Math.min(3, Math.max(0.25, scale));
  const band = Math.min(0.48, 0.2 * s);
  return {
    ...DEFAULT_TOLERANCES,
    azimuthDeg: DEFAULT_TOLERANCES.azimuthDeg * s,
    rangeFrac: DEFAULT_TOLERANCES.rangeFrac * s,
    heightFrac: DEFAULT_TOLERANCES.heightFrac * s,
    observerDeg: Math.min(40, DEFAULT_TOLERANCES.observerDeg * s),
    facingBandDeg: Math.min(60, DEFAULT_TOLERANCES.facingBandDeg * s),
    visibleMin: 0.5 + band,
    occludedMax: 0.5 - band,
  };
}

export interface RelationCounts {
  scored: number;
  ambiguous: number;
  unaskable: number;
}

export interface QuestionSet {
  frame: CameraFrame;
  /** Scored questions selected for presentation / evaluation. */
  questions: Question[];
  /** Every candidate, including ambiguous and unaskable ones. */
  all: Question[];
  stats: Record<Relation, RelationCounts>;
  visibility: Map<string, VisibilityResult>;
  metrics: Map<string, CameraMetrics>;
}

export interface GenerateOptions {
  tolerances?: Tolerances;
  /** Max scored questions kept per relation (all candidates are still counted). */
  perRelation?: number;
}

function ownerName(scene: Scene, owner: string | null): string {
  if (!owner) return 'another object';
  if (owner.startsWith('fixture:')) return scene.fixtures.find((f) => `fixture:${f.id}` === owner)?.name ?? 'the furniture';
  return scene.objects.find((o) => o.id === owner)?.name ?? 'another object';
}

/** Why an object cannot be the subject of an image-grounded pair question, or null if it can. */
function pairBlocker(o: SceneObject, vis: VisibilityResult, tol: Tolerances, scene: Scene): string | null {
  if (!vis.bbox) return `the ${o.name} is partly behind the camera`;
  if (!vis.determinable) return `the ${o.name} projects to too few rays to measure`;
  if (vis.inFrameFraction < tol.inFrameMin) return `the ${o.name} is ${(100 * (1 - vis.inFrameFraction)).toFixed(0)}% outside the frame`;
  if (vis.visibleFraction < tol.pairMinVisible)
    return `the ${o.name} is only ${(100 * vis.visibleFraction).toFixed(0)}% visible (hidden by the ${ownerName(scene, mainOccluder(vis))})`;
  return null;
}

const fmt = (v: number, d = 2) => (Object.is(v, -0) ? 0 : v).toFixed(d);

export function generateQuestions(scene: Scene, pose: ViewerPose, opts: GenerateOptions = {}): QuestionSet {
  const tol = opts.tolerances ?? DEFAULT_TOLERANCES;
  const perRelation = opts.perRelation ?? 6;
  const frame = cameraFrame(pose, scene.focus);
  const visibility = computeVisibility(scene, getColliders(scene), frame);
  const metrics = new Map<string, CameraMetrics>();
  for (const o of scene.objects) metrics.set(o.id, cameraMetrics(frame, o.center));

  const all: Question[] = [];
  const objs = scene.objects;

  for (let i = 0; i < objs.length; i++) {
    for (let j = i + 1; j < objs.length; j++) {
      for (const relation of ['lateral', 'depth', 'vertical'] as const) {
        // Subject/reference order is a seeded coin flip that depends only on the scene, never on the viewpoint.
        const flip = hashString(`${scene.fingerprint}|${relation}|${i}|${j}`) & 1;
        const A = flip ? objs[j] : objs[i];
        const B = flip ? objs[i] : objs[j];
        const mA = metrics.get(A.id)!;
        const mB = metrics.get(B.id)!;
        const meanRange = (mA.range + mB.range) / 2;
        const info = RELATION_INFO[relation];
        let text: string;
        let valueA: number;
        let valueB: number;
        let tolerance: number;
        let metric: string;
        let unit: string;
        let first: boolean; // true -> options[0]
        if (relation === 'lateral') {
          text = `From the camera's viewpoint, is the ${A.name} to the left or to the right of the ${B.name}?`;
          valueA = mA.azimuthDeg;
          valueB = mB.azimuthDeg;
          tolerance = tol.azimuthDeg;
          metric = 'θ';
          unit = '°';
          first = valueA < valueB;
        } else if (relation === 'depth') {
          text = `From the camera's viewpoint, is the ${A.name} closer to or farther from the camera than the ${B.name}?`;
          valueA = mA.range;
          valueB = mB.range;
          tolerance = tol.rangeFrac * meanRange;
          metric = 'ρ';
          unit = ' m';
          first = valueA < valueB;
        } else {
          text = `For the upright viewer, is the ${A.name} above or below the ${B.name}?`;
          valueA = A.center[1] - frame.position[1];
          valueB = B.center[1] - frame.position[1];
          tolerance = tol.heightFrac * meanRange;
          metric = 'y_v';
          unit = ' m';
          first = valueA > valueB;
        }
        const delta = valueA - valueB;
        const blocker = pairBlocker(A, visibility.get(A.id)!, tol, scene) ?? pairBlocker(B, visibility.get(B.id)!, tol, scene);
        let status: QuestionStatus = 'scored';
        let reason: string | undefined;
        if (blocker) {
          status = 'unaskable';
          reason = `Not answerable from the image: ${blocker}.`;
        } else if (Math.abs(delta) < tolerance) {
          status = 'ambiguous';
          reason = `Tie: |Δ${metric}| = ${fmt(Math.abs(delta))}${unit} is inside the tolerance τ = ${fmt(tolerance)}${unit}.`;
        }
        all.push({
          id: `${relation}:${A.id}:${B.id}`,
          relation,
          a: A.id,
          b: B.id,
          aName: A.name,
          bName: B.name,
          text,
          options: info.options,
          status,
          gold: status === 'scored' ? info.options[first ? 0 : 1] : undefined,
          reason,
          evidence: {
            metric,
            unit,
            valueA,
            valueB,
            delta,
            tolerance,
            margin: tolerance > 0 ? Math.abs(delta) / tolerance : Infinity,
            note: `${metric}(${A.name}) = ${fmt(valueA)}${unit}, ${metric}(${B.name}) = ${fmt(valueB)}${unit}; Δ = ${fmt(delta)}${unit}, τ = ${fmt(tolerance)}${unit}`,
          },
        });
      }
    }
  }

  for (const o of objs) {
    const vis = visibility.get(o.id)!;
    const f = vis.visibleFraction;
    let status: QuestionStatus = 'scored';
    let reason: string | undefined;
    let gold: Label | undefined;
    if (!vis.bbox || !vis.determinable) {
      status = 'unaskable';
      reason = `Not measurable: the ${o.name} projects to too few rays from this viewpoint.`;
    } else if (vis.inFrameFraction < tol.inFrameMin) {
      status = 'unaskable';
      reason = `Out of frame: only ${(100 * vis.inFrameFraction).toFixed(0)}% of the ${o.name} lies inside the image, which is not occlusion.`;
    } else if (f >= tol.visibleMin) gold = 'visible';
    else if (f <= tol.occludedMax) gold = 'occluded';
    else {
      status = 'ambiguous';
      reason = `Partially occluded: ${(100 * f).toFixed(0)}% visible lies between f_occ = ${(100 * tol.occludedMax).toFixed(0)}% and f_vis = ${(100 * tol.visibleMin).toFixed(0)}%.`;
    }
    const occ = mainOccluder(vis);
    all.push({
      id: `visibility:${o.id}`,
      relation: 'visibility',
      a: o.id,
      aName: o.name,
      text: `From the camera's viewpoint, is the ${o.name} mostly visible or mostly occluded?`,
      options: RELATION_INFO.visibility.options,
      status,
      gold,
      reason,
      evidence: {
        metric: 'f',
        unit: '',
        valueA: f,
        delta: f,
        tolerance: tol.visibleMin - tol.occludedMax,
        margin: Math.max(f - tol.visibleMin, tol.occludedMax - f),
        note: `f = ${vis.visibleRays}/${vis.inFrameRays} unblocked rays = ${(100 * f).toFixed(0)}%` + (occ ? `; mainly blocked by the ${ownerName(scene, occ)}` : ''),
      },
    });
  }

  // ---- Perspective taking: questions asked from an oriented object's viewpoint, and its facing. ----
  const DEG = 180 / Math.PI;
  const camHeading = Math.atan2(frame.forward[0], frame.forward[2]);
  for (const O of objs) {
    if (!O.front) continue;
    const [fx, , fz] = O.front;
    const visO = visibility.get(O.id)!;
    const blockO = pairBlocker(O, visO, tol, scene);
    let theta = Math.abs(Math.atan2(fx, fz) - camHeading) * DEG;
    if (theta > 180) theta = 360 - theta;

    // facing: alpha = angle between O's forward and the horizontal direction from O to the camera
    const tcx = frame.position[0] - O.center[0];
    const tcz = frame.position[2] - O.center[2];
    const tl = Math.hypot(tcx, tcz) || 1;
    const alpha = Math.acos(Math.max(-1, Math.min(1, (fx * tcx + fz * tcz) / tl))) * DEG;
    {
      let status: QuestionStatus = 'scored';
      let reason: string | undefined;
      if (blockO) {
        status = 'unaskable';
        reason = `Not answerable from the image: ${blockO}.`;
      } else if (Math.abs(alpha - 90) < tol.facingBandDeg) {
        status = 'ambiguous';
        reason = `Sideways: α = ${fmt(alpha, 1)}° is within ${fmt(tol.facingBandDeg, 0)}° of side-on.`;
      }
      all.push({
        id: `facing:${O.id}`,
        relation: 'facing',
        a: O.id,
        aName: O.name,
        text: `Is the ${O.name} facing toward the camera or away from the camera?`,
        options: RELATION_INFO.facing.options,
        status,
        gold: status === 'scored' ? (alpha < 90 ? 'toward' : 'away') : undefined,
        reason,
        thetaDeg: theta,
        evidence: { metric: 'α', unit: '°', valueA: alpha, delta: alpha - 90, tolerance: tol.facingBandDeg, margin: Math.abs(alpha - 90) / tol.facingBandDeg, note: `α(${O.name}) = ${fmt(alpha, 1)}°; toward if α ≤ ${fmt(90 - tol.facingBandDeg, 0)}°, away if α ≥ ${fmt(90 + tol.facingBandDeg, 0)}°` },
      });
    }

    for (const A of objs) {
      if (A === O) continue;
      const dx = A.center[0] - O.center[0];
      const dz = A.center[2] - O.center[2];
      const dist = Math.hypot(dx, dz);
      const blocker = blockO ?? pairBlocker(A, visibility.get(A.id)!, tol, scene);
      // right-handed, +Y up: right = forward x up = (-fz, 0, fx)
      const lateral = dist > 1e-9 ? Math.asin(Math.max(-1, Math.min(1, (-fz * dx + fx * dz) / dist))) * DEG : 0;
      const frontal = dist > 1e-9 ? Math.asin(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / dist))) * DEG : 0;
      const defs = [
        { relation: 'obs_lateral' as const, value: lateral, metric: 'φ', ask: `is the ${A.name} to your left or to your right?` },
        { relation: 'obs_frontback' as const, value: frontal, metric: 'ψ', ask: `is the ${A.name} in front of you or behind you?` },
      ];
      for (const d of defs) {
        const info = RELATION_INFO[d.relation];
        let status: QuestionStatus = 'scored';
        let reason: string | undefined;
        if (blocker) {
          status = 'unaskable';
          reason = `Not answerable from the image: ${blocker}.`;
        } else if (Math.abs(d.value) < tol.observerDeg) {
          status = 'ambiguous';
          reason = `Tie: |${d.metric}| = ${fmt(Math.abs(d.value), 1)}° is inside the tolerance τ = ${fmt(tol.observerDeg, 1)}°.`;
        }
        const first = d.relation === 'obs_lateral' ? d.value < 0 : d.value > 0;
        all.push({
          id: `${d.relation}:${A.id}:${O.id}`,
          relation: d.relation,
          a: A.id,
          b: O.id,
          aName: A.name,
          bName: O.name,
          text: `Imagine you are ${O.observerPhrase ?? `at the ${O.name}`}, facing the same way it faces. From there, ${d.ask}`,
          options: info.options,
          status,
          gold: status === 'scored' ? info.options[first ? 0 : 1] : undefined,
          reason,
          thetaDeg: theta,
          evidence: { metric: d.metric, unit: '°', valueA: d.value, delta: d.value, tolerance: tol.observerDeg, margin: Math.abs(d.value) / tol.observerDeg, note: `${d.metric}(${A.name} | ${O.name}) = ${fmt(d.value, 1)}°, τ = ${fmt(tol.observerDeg, 1)}°; observer heading is ${fmt(theta, 0)}° from the camera heading` },
        });
      }
    }
  }

  const stats = Object.fromEntries(RELATIONS.map((r) => [r, { scored: 0, ambiguous: 0, unaskable: 0 }])) as Record<Relation, RelationCounts>;
  for (const q of all) stats[q.relation][q.status]++;

  // Stable, viewpoint-independent priority so the same pairs persist as the camera moves.
  const prio = (q: Question) => hashString(`${scene.fingerprint}|${q.relation}|${[q.a, q.b ?? ''].sort().join('|')}`);
  const questions: Question[] = [];
  for (const relation of RELATIONS) {
    const scored = all.filter((q) => q.relation === relation && q.status === 'scored').sort((x, y) => prio(x) - prio(y));
    questions.push(...scored.slice(0, perRelation));
  }
  return { frame, questions, all, stats, visibility, metrics };
}
