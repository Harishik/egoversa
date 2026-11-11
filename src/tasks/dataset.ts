/**
 * Dataset items for vision-language models.
 *
 * Builds on the oracle in generator.ts and adds what a model benchmark needs beyond the in-app quiz:
 *   - paraphrase templates (one family is reserved for out-of-distribution test splits),
 *   - ABSTENTION items: the question names an object that is fully hidden in the image, so the only
 *     correct reply is "unknown" (physical visibility is kept distinct from knowability),
 *   - TWO-VIEW items computed from a pair of camera poses of the same scene.
 *
 * Nothing here renders pixels. A DatasetItem is oracle-side data; `modelPrompt` is the ONLY text
 * that may be shown to a model.
 */
import type { ViewerPose } from '../geometry/camera';
import { wrapDeg } from '../geometry/camera';
import { hashString } from '../geometry/rng';
import type { Scene } from '../scenes/types';
import { generateQuestions, type QuestionSet } from './generator';
import type { Question, Relation, Tolerances } from './types';

export type TaskType = Relation | 'abstain' | 'mv_best_view' | 'mv_camera_motion';
export const TASK_TYPES: TaskType[] = ['lateral', 'depth', 'vertical', 'visibility', 'obs_lateral', 'obs_frontback', 'facing', 'abstain', 'mv_best_view', 'mv_camera_motion'];
export const MULTI_VIEW_TASKS: TaskType[] = ['mv_best_view', 'mv_camera_motion'];

export const TASK_TITLES: Record<TaskType, string> = {
  lateral: 'Left / right (camera)',
  depth: 'Closer / farther (camera)',
  vertical: 'Above / below',
  visibility: 'Visible / occluded',
  obs_lateral: 'Left / right (observer)',
  obs_frontback: 'Front / behind (observer)',
  facing: 'Facing toward / away',
  abstain: 'Abstain when hidden',
  mv_best_view: 'Two views: better view',
  mv_camera_motion: 'Two views: camera motion',
};

export type ReferenceFrame = 'camera' | 'observer' | 'upright-viewer' | 'multi-view';
export type Difficulty = 'easy' | 'medium' | 'hard';
/** Template families. 0 and 1 are used for train / val / in-distribution test; 2 is reserved for OOD test. */
export type TemplateId = 0 | 1 | 2;

export interface DatasetItem {
  /** Stable within a (scene, pose) — `<task>:<object ids>` */
  key: string;
  taskType: TaskType;
  /** The relation the question is about (for abstain items: the relation that could not be answered). */
  relation: Relation | null;
  question: string;
  options: string[];
  answer: string;
  answerable: boolean;
  referenceFrame: ReferenceFrame;
  /** 0 = first image only, [0, 1] = both images. */
  views: number[];
  objectIds: string[];
  objectNames: string[];
  templateId: TemplateId;
  difficulty: Difficulty;
  /** Geometry-derived justification. Oracle-side only. */
  explanation: string;
  thetaDeg?: number;
}

const UNKNOWN = 'unknown';

function phrase(q: Question, v: TemplateId): string {
  if (v === 0) return q.text;
  const A = q.aName;
  const B = q.bName ?? '';
  switch (q.relation) {
    case 'lateral':
      return v === 1 ? `Looking at the image, does the ${A} appear on the left side or the right side of the ${B}?` : `In this picture, which side of the ${B} is the ${A} on: left or right?`;
    case 'depth':
      return v === 1 ? `Compared with the ${B}, is the ${A} closer to the camera or farther from it?` : `Is the distance from the camera to the ${A} smaller (closer) or larger (farther) than the distance to the ${B}?`;
    case 'vertical':
      return v === 1 ? `Is the ${A} located above or below the ${B} in the scene?` : `Compared with the ${B}, is the ${A} higher up (above) or lower down (below)?`;
    case 'visibility':
      return v === 1 ? `Can most of the ${A} be seen from here (visible), or is most of it hidden behind something (occluded)?` : `Is the ${A} largely in view (visible) or largely blocked from view (occluded)?`;
    case 'obs_lateral':
      return v === 1 ? `Put yourself in the place of the ${B}, looking where it looks. Is the ${A} on your left or on your right?` : `From the ${B}'s own point of view, is the ${A} on its left or on its right?`;
    case 'obs_frontback':
      return v === 1 ? `Put yourself in the place of the ${B}, looking where it looks. Is the ${A} in front of you or behind you?` : `From the ${B}'s own point of view, is the ${A} in front of it or behind it?`;
    case 'facing':
      return v === 1 ? `Is the front of the ${A} turned toward the camera or away from it?` : `Does the ${A} face the viewer (toward) or face the opposite way (away)?`;
  }
}

function difficultyOf(q: Question): Difficulty {
  const m = q.relation === 'visibility' ? q.evidence.margin * 10 : q.evidence.margin;
  return m < 2 ? 'hard' : m < 4 ? 'medium' : 'easy';
}

const FRAME: Record<Relation, ReferenceFrame> = {
  lateral: 'camera', depth: 'camera', vertical: 'upright-viewer', visibility: 'camera', obs_lateral: 'observer', obs_frontback: 'observer', facing: 'camera',
};
/** Relations whose model prompt offers "unknown" as a third option. */
const ABSTAINABLE: Relation[] = ['lateral', 'depth', 'vertical', 'obs_lateral', 'obs_frontback'];

/** Fraction below which an object counts as not shown at all in the image. */
export const HIDDEN_MAX = 0.03;

export interface ViewItemsOptions {
  tolerances?: Tolerances;
  /** Template families allowed for this split. */
  templates: TemplateId[];
  /** Mixed into the template choice so different splits phrase the same pair differently. */
  salt: string;
}

function toItem(q: Question, v: TemplateId): DatasetItem {
  const abst = ABSTAINABLE.includes(q.relation);
  return {
    key: q.id,
    taskType: q.relation,
    relation: q.relation,
    question: phrase(q, v),
    options: abst ? [...q.options, UNKNOWN] : [...q.options],
    answer: q.gold!,
    answerable: true,
    referenceFrame: FRAME[q.relation],
    views: [0],
    objectIds: q.b ? [q.a, q.b] : [q.a],
    objectNames: q.bName ? [q.aName, q.bName] : [q.aName],
    templateId: v,
    difficulty: difficultyOf(q),
    explanation: q.evidence.note,
    thetaDeg: q.thetaDeg,
  };
}

/** All single-image items for one (scene, pose): every scored question plus abstention items. */
export function buildViewItems(scene: Scene, pose: ViewerPose, opts: ViewItemsOptions): { items: DatasetItem[]; set: QuestionSet } {
  const set = generateQuestions(scene, pose, { tolerances: opts.tolerances, perRelation: Number.MAX_SAFE_INTEGER });
  const pick = (q: Question): TemplateId => opts.templates[hashString(`${opts.salt}|${scene.fingerprint}|${q.id}`) % opts.templates.length];
  const items: DatasetItem[] = [];
  for (const q of set.all) {
    if (q.status === 'scored') {
      items.push(toItem(q, pick(q)));
      continue;
    }
    // Abstention: a pair / observer question about an object that is in frame, measurable and (almost) entirely hidden.
    if (q.status !== 'unaskable' || !ABSTAINABLE.includes(q.relation)) continue;
    const hidden = [q.a, q.b!].filter((id) => {
      const vis = set.visibility.get(id)!;
      return vis.determinable && vis.inFrameFraction >= 0.8 && vis.visibleFraction <= HIDDEN_MAX;
    });
    const others = [q.a, q.b!].filter((id) => !hidden.includes(id));
    // Exactly one object hidden, the other clearly shown: the question is well formed but unknowable.
    if (hidden.length !== 1) continue;
    const ov = set.visibility.get(others[0])!;
    if (!(ov.determinable && ov.inFrameFraction >= 0.8 && ov.visibleFraction >= 0.5)) continue;
    const v = pick(q);
    const hiddenName = hidden[0] === q.a ? q.aName : q.bName!;
    items.push({
      key: `abstain:${q.id}`,
      taskType: 'abstain',
      relation: q.relation,
      question: phrase(q, v),
      options: [...q.options, UNKNOWN],
      answer: UNKNOWN,
      answerable: false,
      referenceFrame: FRAME[q.relation],
      views: [0],
      objectIds: [q.a, q.b!],
      objectNames: [q.aName, q.bName!],
      templateId: v,
      difficulty: 'medium',
      explanation: `The ${hiddenName} is ${(100 * set.visibility.get(hidden[0])!.visibleFraction).toFixed(0)}% visible from this viewpoint, so the relation cannot be determined from the image.`,
      thetaDeg: q.thetaDeg,
    });
  }
  return { items, set };
}

/** Minimum / maximum azimuth change for which "which way did the camera move" is asked. */
export const MOTION_MIN_DEG = 25;
export const MOTION_MAX_DEG = 110;
/** Minimum difference in unoccluded fraction for a "better view" question. */
export const BEST_VIEW_MIN_DELTA = 0.4;

/** Two-view items for the same scene seen from poseA (first image) and poseB (second image). */
export function buildPairItems(scene: Scene, poseA: ViewerPose, poseB: ViewerPose, setA: QuestionSet, setB: QuestionSet, opts: ViewItemsOptions): DatasetItem[] {
  const items: DatasetItem[] = [];
  const d = wrapDeg(poseB.azimuthDeg - poseA.azimuthDeg);
  const tpl = (k: string): TemplateId => opts.templates[hashString(`${opts.salt}|${scene.fingerprint}|${k}`) % opts.templates.length];
  if (Math.abs(d) >= MOTION_MIN_DEG && Math.abs(d) <= MOTION_MAX_DEG) {
    const v = tpl('motion');
    const q = [
      'The two images show the same scene. Between the first image and the second image, did the camera move to its left or to its right around the scene?',
      'Both pictures show one scene from two viewpoints. To get from the first viewpoint to the second, did the camera travel to the left or to the right?',
      'Same scene, two camera positions. Relative to where it started, is the second camera position to the left or to the right of the first?',
    ][v];
    items.push({
      key: 'mv_camera_motion', taskType: 'mv_camera_motion', relation: null, question: q, options: ['left', 'right'],
      // Azimuth increases counter-clockwise seen from above; at any azimuth that is the camera's own +x (right).
      answer: d > 0 ? 'right' : 'left', answerable: true, referenceFrame: 'multi-view', views: [0, 1], objectIds: [], objectNames: [], templateId: v,
      difficulty: Math.abs(d) < 45 ? 'hard' : Math.abs(d) < 75 ? 'medium' : 'easy',
      explanation: `The camera azimuth changed by ${d.toFixed(0)}°, i.e. it moved to its ${d > 0 ? 'right' : 'left'} around the scene focus.`,
    });
  }
  for (const o of scene.objects) {
    const a = setA.visibility.get(o.id)!;
    const b = setB.visibility.get(o.id)!;
    if (!(a.determinable && b.determinable && a.inFrameFraction >= 0.8 && b.inFrameFraction >= 0.8)) continue;
    const delta = a.visibleFraction - b.visibleFraction;
    if (Math.abs(delta) < BEST_VIEW_MIN_DELTA) continue;
    const v = tpl(`best:${o.id}`);
    const q = [
      `The two images show the same scene from different viewpoints. In which image is more of the ${o.name} visible: the first or the second?`,
      `Two views of one scene. Which image gives the clearer, less blocked view of the ${o.name}: the first or the second?`,
      `Comparing the two pictures of this scene, the ${o.name} is less hidden in which one, the first or the second?`,
    ][v];
    items.push({
      key: `mv_best_view:${o.id}`, taskType: 'mv_best_view', relation: null, question: q, options: ['first', 'second'],
      answer: delta > 0 ? 'first' : 'second', answerable: true, referenceFrame: 'multi-view', views: [0, 1], objectIds: [o.id], objectNames: [o.name], templateId: v,
      difficulty: Math.abs(delta) < 0.6 ? 'hard' : Math.abs(delta) < 0.8 ? 'medium' : 'easy',
      explanation: `Unoccluded fraction of the ${o.name}: ${(100 * a.visibleFraction).toFixed(0)}% in the first image, ${(100 * b.visibleFraction).toFixed(0)}% in the second.`,
    });
  }
  return items;
}

/**
 * The one and only model-visible text for an item: the question and the admissible answer words.
 * It never contains coordinates, poses, seeds, fractions or the answer.
 */
export function modelPrompt(item: Pick<DatasetItem, 'question' | 'options'>): string {
  const o = item.options;
  const list = o.length === 2 ? `${o[0]} or ${o[1]}` : `${o.slice(0, -1).join(', ')}, or ${o[o.length - 1]}`;
  const hint = o.includes(UNKNOWN) ? ' If it cannot be determined from what is shown, answer unknown.' : '';
  return `${item.question}\nAnswer with exactly one word: ${list}.${hint}`;
}
