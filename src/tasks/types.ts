export type Relation = 'lateral' | 'depth' | 'vertical' | 'visibility' | 'obs_lateral' | 'obs_frontback' | 'facing';
export type Label = 'left' | 'right' | 'closer' | 'farther' | 'above' | 'below' | 'visible' | 'occluded' | 'front' | 'behind' | 'toward' | 'away';

export const RELATIONS: Relation[] = ['lateral', 'depth', 'vertical', 'visibility', 'obs_lateral', 'obs_frontback', 'facing'];
/** Relations asked from the camera's own viewpoint (v0.1). */
export const CAMERA_RELATIONS: Relation[] = ['lateral', 'depth', 'vertical', 'visibility'];
/** Relations asked from the viewpoint of an oriented object inside the scene (perspective taking). */
export const OBSERVER_RELATIONS: Relation[] = ['obs_lateral', 'obs_frontback'];

export const RELATION_INFO: Record<Relation, { title: string; short: string; options: [Label, Label]; frame: string; rule: string }> = {
  lateral: {
    title: 'Left / right',
    short: 'Left/right',
    options: ['left', 'right'],
    frame: 'camera frame',
    rule: 'Compare bearings θ = atan2(x_c, −z_c) of the two reference points. A is left of B iff θ_A < θ_B − τ_θ.',
  },
  depth: {
    title: 'Closer / farther',
    short: 'Closer/farther',
    options: ['closer', 'farther'],
    frame: 'camera frame',
    rule: 'Compare Euclidean ranges ρ = ‖p_c‖ from the optical centre. A is closer iff ρ_A < ρ_B − τ_ρ.',
  },
  vertical: {
    title: 'Above / below',
    short: 'Above/below',
    options: ['above', 'below'],
    frame: 'upright viewer frame',
    rule: 'Compare heights along the viewer’s gravity-aligned up axis (roll = 0, so this equals world Y). A is above iff y_A > y_B + τ_y.',
  },
  visibility: {
    title: 'Visible / occluded',
    short: 'Visible/occluded',
    options: ['visible', 'occluded'],
    frame: 'camera rays',
    rule: 'Unoccluded fraction f of the object’s in-frame silhouette, from ray casts. Visible iff f ≥ f_vis, occluded iff f ≤ f_occ.',
  },
  obs_lateral: {
    title: 'Observer left / right',
    short: 'Obs. left/right',
    options: ['left', 'right'],
    frame: 'observer frame',
    rule: 'Express the subject in the frame of an oriented object O (forward f_O, right r_O = f_O × up). φ = asin(r_O·d / ‖d‖) with d the horizontal offset from O. Left iff φ < −τ_φ, right iff φ > τ_φ.',
  },
  obs_frontback: {
    title: 'Observer front / behind',
    short: 'Obs. front/behind',
    options: ['front', 'behind'],
    frame: 'observer frame',
    rule: 'ψ = asin(f_O·d / ‖d‖) with d the horizontal offset from the observer O. In front iff ψ > τ_φ, behind iff ψ < −τ_φ.',
  },
  facing: {
    title: 'Facing toward / away',
    short: 'Facing',
    options: ['toward', 'away'],
    frame: 'camera and object heading',
    rule: 'α = angle between the object’s forward axis and the horizontal direction from the object to the camera. Toward iff α ≤ 90° − β, away iff α ≥ 90° + β.',
  },
};

export interface Evidence {
  /** Symbol of the compared quantity, e.g. "θ". */
  metric: string;
  unit: string;
  valueA: number;
  valueB?: number;
  /** valueA − valueB (or the visible fraction for visibility). */
  delta: number;
  tolerance: number;
  /** |delta| / tolerance for pair relations; distance to the nearest decision band for visibility. */
  margin: number;
  note: string;
}

export type QuestionStatus = 'scored' | 'ambiguous' | 'unaskable';

export interface Question {
  id: string;
  relation: Relation;
  a: string;
  b?: string;
  aName: string;
  bName?: string;
  text: string;
  options: [Label, Label];
  status: QuestionStatus;
  /** Present only when status === 'scored'. */
  gold?: Label;
  /** Why the question is ambiguous / unaskable. */
  reason?: string;
  evidence: Evidence;
  /**
   * Observer-frame questions only: angle in [0, 180] between the camera's heading and the
   * observer's heading. 0° = the observer looks the same way as the camera; 180° = it faces the camera.
   */
  thetaDeg?: number;
}

export interface Tolerances {
  /** τ_θ: bearing difference below which left/right is a tie, degrees. */
  azimuthDeg: number;
  /** τ_ρ as a fraction of the mean range of the pair. */
  rangeFrac: number;
  /** τ_y as a fraction of the mean range of the pair. */
  heightFrac: number;
  /** f_vis: minimum unoccluded fraction to be labelled visible. */
  visibleMin: number;
  /** f_occ: maximum unoccluded fraction to be labelled occluded. */
  occludedMax: number;
  /** Both objects of a pair question must be at least this visible to be askable from an image. */
  pairMinVisible: number;
  /** Minimum fraction of the silhouette inside the image frame. */
  inFrameMin: number;
  /** τ_φ: half-width of the tie band around the observer's sagittal / frontal plane, degrees. */
  observerDeg: number;
  /** β: half-width of the "sideways" band for the facing task, degrees. */
  facingBandDeg: number;
}
