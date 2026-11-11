/**
 * Scenario = everything needed to reproduce a scene AND a viewpoint exactly.
 * Objects are regenerated from the seed on import; the stored fingerprint is
 * compared against the regenerated scene to prove the reproduction is exact.
 */
import type { ViewerPose } from '../geometry/camera';
import { generateScene, normalizeSpec } from './generate';
import { ENVIRONMENTS } from './environments';
import type { LightingId, Scene, SceneSpec } from './types';

export const SCENARIO_FORMAT = 'egoversa.scenario';
export const SCENARIO_VERSION = 1;
export const LIGHTING_IDS: LightingId[] = ['studio', 'warm', 'dim', 'backlit'];

export interface Scenario {
  format: typeof SCENARIO_FORMAT;
  version: number;
  name: string;
  spec: SceneSpec;
  viewer: ViewerPose;
  lighting: LightingId;
  toleranceScale: number;
  fingerprint: string;
  savedAt?: string;
  /** Informational copy of the generated world transforms (ignored on import). */
  objects?: { id: string; name: string; worldCenter: number[]; worldBase: number[]; rotationYRad: number }[];
}

export function clampViewer(v: ViewerPose, scene: Pick<Scene, 'limits'>): ViewerPose {
  const { limits } = scene;
  return {
    azimuthDeg: Number.isFinite(v.azimuthDeg) ? v.azimuthDeg : 0,
    height: Math.min(limits.maxHeight, Math.max(limits.minHeight, Number(v.height) || limits.minHeight)),
    distance: Math.min(limits.maxDistance, Math.max(limits.minDistance, Number(v.distance) || limits.minDistance)),
  };
}

export function buildScenario(
  scene: Scene,
  viewer: ViewerPose,
  lighting: LightingId,
  toleranceScale: number,
  name?: string,
  withObjects = true,
): Scenario {
  return {
    format: SCENARIO_FORMAT,
    version: SCENARIO_VERSION,
    name: name ?? `${ENVIRONMENTS[scene.spec.env].label} / ${scene.spec.seed}`,
    spec: scene.spec,
    viewer: { azimuthDeg: round(viewer.azimuthDeg), height: round(viewer.height), distance: round(viewer.distance) },
    lighting,
    toleranceScale,
    fingerprint: scene.fingerprint,
    savedAt: new Date().toISOString(),
    objects: withObjects
      ? scene.objects.map((o) => ({ id: o.id, name: o.name, worldCenter: o.center.map(round), worldBase: o.position.map(round), rotationYRad: round(o.rotationY) }))
      : undefined,
  };
}

export type ParseResult =
  | { ok: true; scenario: Scenario; scene: Scene; fingerprintMatches: boolean }
  | { ok: false; error: string };

export function parseScenario(raw: unknown): ParseResult {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'The file is not valid JSON.' };
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'Expected a JSON object.' };
  const d = data as Record<string, unknown>;
  if (d.format !== SCENARIO_FORMAT) return { ok: false, error: `Not an EGOVERSA scenario (missing format "${SCENARIO_FORMAT}").` };
  if (typeof d.version !== 'number' || d.version > SCENARIO_VERSION) return { ok: false, error: `Unsupported scenario version ${String(d.version)}.` };
  const s = d.spec as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object') return { ok: false, error: 'Scenario has no "spec".' };
  if (typeof s.env !== 'string' || !(s.env in ENVIRONMENTS)) return { ok: false, error: `Unknown environment "${String(s.env)}".` };
  if (typeof s.seed !== 'string' || !s.seed) return { ok: false, error: 'Scenario spec needs a non-empty string "seed".' };
  const spec = normalizeSpec(s as unknown as SceneSpec);
  const scene = generateScene(spec);
  const v = (d.viewer ?? {}) as Partial<ViewerPose>;
  const viewer = clampViewer(
    { azimuthDeg: Number(v.azimuthDeg) || 0, height: Number(v.height) || scene.defaultViewer.height, distance: Number(v.distance) || scene.defaultViewer.distance },
    scene,
  );
  const lighting = LIGHTING_IDS.includes(d.lighting as LightingId) ? (d.lighting as LightingId) : 'studio';
  const tol = Number(d.toleranceScale);
  const scenario: Scenario = {
    format: SCENARIO_FORMAT,
    version: SCENARIO_VERSION,
    name: typeof d.name === 'string' && d.name ? d.name.slice(0, 80) : `${ENVIRONMENTS[spec.env].label} / ${spec.seed}`,
    spec,
    viewer,
    lighting,
    toleranceScale: Number.isFinite(tol) && tol > 0 ? Math.min(3, Math.max(0.25, tol)) : 1,
    fingerprint: scene.fingerprint,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : undefined,
  };
  const fingerprintMatches = typeof d.fingerprint !== 'string' || d.fingerprint === scene.fingerprint;
  return { ok: true, scenario, scene, fingerprintMatches };
}

function round(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}
