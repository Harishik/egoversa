/**
 * Reference oracle and intentionally limited heuristic baselines.
 *
 * NONE of these are learned models. The oracle is analytic geometry (it is
 * the ground truth by definition). The baselines are hand-written shortcuts,
 * each restricted by its *type signature* to a deliberately impoverished view
 * of the scene, so that their failures isolate one specific confusion:
 *
 *   world-axis  : sees world coordinates but has no idea where the camera is.
 *   image-plane : sees only amodal 2D boxes in the image; no depth, no 3D.
 *   chance      : sees nothing; a seeded coin flip (floor).
 */
import type { CameraFrame } from '../geometry/camera';
import { hashString } from '../geometry/rng';
import { projectedBounds, type NdcBox } from '../geometry/visibility';
import type { Scene } from '../scenes/types';
import type { Label, Question } from '../tasks/types';

export type ReasonerId = 'oracle' | 'world' | 'image' | 'chance';
export type ReasonerKind = 'reference' | 'heuristic' | 'chance';

/** World-centred view: object reference points in W. No camera information. */
export type WorldView = ReadonlyMap<string, { x: number; y: number; z: number }>;
/** Image-plane view: amodal 2D boxes in NDC (x right, y up). No depth. */
export type ImageView = ReadonlyMap<string, NdcBox>;

export interface ReasonerContext {
  world: WorldView;
  image: ImageView;
  /** Unique key of this (scenario, viewpoint), used only by the seeded chance baseline. */
  viewKey: string;
}

export interface ReasonerDef {
  id: ReasonerId;
  name: string;
  short: string;
  kind: ReasonerKind;
  /** What the reasoner is allowed to see. */
  input: string;
  description: string;
  color: string;
  predict: (q: Question, ctx: ReasonerContext) => Label;
}

export function buildContext(scene: Scene, frame: CameraFrame, viewKey: string): ReasonerContext {
  const world = new Map<string, { x: number; y: number; z: number }>();
  const image = new Map<string, NdcBox>();
  for (const o of scene.objects) {
    world.set(o.id, { x: o.center[0], y: o.center[1], z: o.center[2] });
    const b = projectedBounds(frame, o.corners);
    if (b) image.set(o.id, b);
  }
  return { world, image, viewKey };
}

function predictWorld(q: Question, world: WorldView): Label {
  const a = world.get(q.a)!;
  const b = q.b ? world.get(q.b)! : a;
  switch (q.relation) {
    case 'lateral':
      return a.x < b.x ? 'left' : 'right'; // world X as if it were the camera's x axis
    case 'depth':
      return a.z > b.z ? 'closer' : 'farther'; // assumes the canonical camera on the +Z side
    case 'vertical':
      return a.y > b.y ? 'above' : 'below';
    case 'visibility':
      return 'visible'; // cannot reason about lines of sight without a viewpoint
    case 'obs_lateral':
      return a.x < b.x ? 'left' : 'right'; // pretends every observer faces the canonical -Z direction
    case 'obs_frontback':
      return a.z < b.z ? 'front' : 'behind';
    case 'facing':
      return 'toward';
  }
}

const area = (b: NdcBox) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function overlap(a: NdcBox, b: NdcBox): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

function predictImage(q: Question, image: ImageView): Label {
  const a = image.get(q.a);
  const b = q.b ? image.get(q.b) : a;
  if (!a || !b) return q.options[0];
  switch (q.relation) {
    case 'lateral':
      return (a.x0 + a.x1) / 2 < (b.x0 + b.x1) / 2 ? 'left' : 'right';
    case 'depth':
      return a.y0 < b.y0 ? 'closer' : 'farther'; // "lower in the picture is nearer" pictorial cue
    case 'vertical':
      return (a.y0 + a.y1) / 2 > (b.y0 + b.y1) / 2 ? 'above' : 'below'; // image height taken for physical height
    case 'visibility': {
      // Bounding-box overlap guess: boxes whose bottom edge is lower are assumed to be in front.
      let covered = 0;
      for (const [id, other] of image) {
        if (id === q.a || other.y0 >= a.y0) continue;
        covered += overlap(a, other);
      }
      return covered / Math.max(1e-9, area(a)) > 0.5 ? 'occluded' : 'visible';
    }
    // Egocentric bias: answer an observer-frame question as if it were asked from the camera.
    case 'obs_lateral':
      return (a.x0 + a.x1) / 2 < (b.x0 + b.x1) / 2 ? 'left' : 'right';
    case 'obs_frontback':
      return a.y0 > b.y0 ? 'front' : 'behind'; // farther along the camera's view direction = "in front"
    case 'facing':
      return 'toward';
  }
}

export const REASONERS: ReasonerDef[] = [
  {
    id: 'oracle',
    name: 'Geometry oracle',
    short: 'Oracle',
    kind: 'reference',
    input: 'Full scene geometry and the camera pose',
    description: 'Analytic ground truth: camera-space transforms and ray casts. A reference, not a model — it is correct by construction.',
    color: '#E9ECFF',
    predict: (q) => q.gold ?? q.options[0],
  },
  {
    id: 'world',
    name: 'World-axis heuristic',
    short: 'World-axis',
    kind: 'heuristic',
    input: 'World coordinates of object centres. No camera pose.',
    description: 'Answers every question in the fixed world frame, as if the camera never left the canonical front view.',
    color: '#BC8532',
    predict: (q, ctx) => predictWorld(q, ctx.world),
  },
  {
    id: 'image',
    name: 'Image-plane heuristic',
    short: 'Image-plane',
    kind: 'heuristic',
    input: 'Amodal 2D bounding boxes in the image. No depth, no 3D.',
    description: 'Reads relations straight off pixel positions: lower box = nearer, higher box = above, box overlap = occlusion. Answers observer-frame questions from the camera’s own view (egocentric bias).',
    color: '#9F7AEA',
    predict: (q, ctx) => predictImage(q, ctx.image),
  },
  {
    id: 'chance',
    name: 'Seeded coin flip',
    short: 'Chance',
    kind: 'chance',
    input: 'Nothing',
    description: 'Deterministic pseudo-random guess. The floor any reasoner must beat.',
    color: '#7F8BC4',
    predict: (q, ctx) => q.options[hashString(`${ctx.viewKey}|${q.id}`) & 1],
  },
];

export const REASONER_BY_ID = Object.fromEntries(REASONERS.map((r) => [r.id, r])) as Record<ReasonerId, ReasonerDef>;
export const BASELINE_IDS: ReasonerId[] = ['world', 'image', 'chance'];
