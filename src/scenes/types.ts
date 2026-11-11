import type { Vec3 } from '../geometry/types';
import type { PrimitiveKind } from '../geometry/primitives';

export type EnvId = 'tabletop' | 'room' | 'workbench';

/** One opaque primitive. Local unit shape (see geometry/primitives.ts) under T * R(euler XYZ) * S. */
export interface Part {
  kind: PrimitiveKind;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  metalness?: number;
  roughness?: number;
  emissive?: string;
}

export interface SceneObject {
  id: string;
  /** Unique referring expression inside the scene, e.g. "red mug". */
  name: string;
  noun: string;
  colorName: string;
  category: string;
  /** World position of the object's base centre (where it rests on its support). */
  position: Vec3;
  /** Yaw about world +Y, radians. */
  rotationY: number;
  /** Parts in the object's local frame (base at y = 0). */
  parts: Part[];
  /** Reference point used by every relation: centre of the world-space AABB. */
  center: Vec3;
  /** World-space AABB extents. */
  size: Vec3;
  /** World-space corners of every part's bounding box (8 per part). */
  corners: Vec3[];
  footprint: number;
  isOccluder: boolean;
  isDistractor: boolean;
  /** Oriented agent figure added by `SceneSpec.agents` (a robot with a visible face). */
  isAgent: boolean;
  region: string;
  /**
   * World-space unit vector of the direction the object faces (horizontal), for objects with an
   * unambiguous front. Such objects can serve as the reference viewer of an observer-frame question.
   */
  front?: Vec3;
  /** How to phrase "imagine you are ..." for this object, e.g. "sitting on the red sofa". */
  observerPhrase?: string;
}

/** Static furniture / architecture. Parts are given directly in world space. */
export interface Fixture {
  id: string;
  name: string;
  parts: Part[];
  /** Opaque fixtures take part in the visibility raycast. */
  occludes: boolean;
}

/**
 * Room walls are single-sided, inward-facing planes: rendered only when seen
 * from inside (back-face culled), so they never hide the room from an outside
 * camera in the image, and are consistently ignored by the visibility oracle.
 */
export interface Wall {
  position: Vec3;
  rotationY: number;
  width: number;
  height: number;
  color: string;
}

export interface SceneSpec {
  env: EnvId;
  seed: string;
  /** 5..10 named objects. */
  objectCount: number;
  /** 0..1 — how many tall occluders are added and how tightly objects huddle behind them. */
  occlusion: number;
  /** 0..3 — look-alike objects sharing a noun with another object (different colour). */
  distractors: number;
  /** 0..1 — random yaw applied to objects. */
  jitter: number;
  /**
   * 0..2 — oriented agent figures (robots) placed after the other objects from an independent RNG
   * stream, so agents = 0 reproduces the same base scene. They always get a random heading.
   */
  agents?: number;
  /** Object nouns that must not appear (used to hold asset families out of training splits). */
  exclude?: string[];
}

export interface ViewerLimits {
  minHeight: number;
  maxHeight: number;
  minDistance: number;
  maxDistance: number;
}

export interface Scene {
  spec: SceneSpec;
  objects: SceneObject[];
  fixtures: Fixture[];
  walls: Wall[];
  /** Point the viewer camera looks at. */
  focus: Vec3;
  defaultViewer: { height: number; distance: number };
  limits: ViewerLimits;
  /** Rough horizontal half-extent, for framing diagrams and the inspection camera. */
  extent: number;
  /** 8-hex digest of every object's name and world transform. */
  fingerprint: string;
}

export type LightingId = 'studio' | 'warm' | 'dim' | 'backlit';
