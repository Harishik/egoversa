/**
 * Procedural object catalogue. Every object is built in code from opaque
 * primitives (no external meshes or textures). Dimensions are in metres,
 * the local origin is the centre of the object's base.
 */
import type { Vec3 } from '../geometry/types';
import type { Part } from './types';

export const COLORS: Record<string, string> = {
  red: '#e5484d',
  orange: '#f2762a',
  yellow: '#f2c94c',
  green: '#4cb37a',
  teal: '#1fb8a6',
  blue: '#4a7dff',
  purple: '#9b6dff',
  pink: '#ef6fa8',
  white: '#e9eaf2',
  charcoal: '#3d4152',
  brown: '#a9744a',
};
export const COLOR_NAMES = Object.keys(COLORS);

const DARK = '#262a3a';
const LIGHT = '#dfe2ee';
const METAL = '#8b93a7';
const WOOD = '#9c7350';

type Extra = Partial<Pick<Part, 'metalness' | 'roughness' | 'emissive'>>;
const Z: Vec3 = [0, 0, 0];

export const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, rot: Vec3 = Z, extra: Extra = {}): Part => ({
  kind: 'box', position: [x, y, z], rotation: rot, scale: [w, h, d], color, ...extra,
});
export const cyl = (dia: number, h: number, x: number, y: number, z: number, color: string, extra: Extra = {}): Part => ({
  kind: 'cylinder', position: [x, y, z], rotation: Z, scale: [dia, h, dia], color, ...extra,
});
export const sph = (dx: number, dy: number, dz: number, x: number, y: number, z: number, color: string, extra: Extra = {}): Part => ({
  kind: 'sphere', position: [x, y, z], rotation: Z, scale: [dx, dy, dz], color, ...extra,
});
export const cone = (dia: number, h: number, x: number, y: number, z: number, color: string, extra: Extra = {}): Part => ({
  kind: 'cone', position: [x, y, z], rotation: Z, scale: [dia, h, dia], color, ...extra,
});

export interface Template {
  noun: string;
  category: string;
  /** Footprint radius used for collision-free placement. */
  r: number;
  /** Overall height. */
  h: number;
  build: (c: string) => Part[];
  /** True when the object has an unambiguous front along its local +Z axis. */
  front?: boolean;
  /** "imagine you are ..." phrase; `{name}` is replaced by the object's name. */
  observerPhrase?: string;
}

const t = (noun: string, category: string, r: number, h: number, build: (c: string) => Part[], extra: Partial<Template> = {}): Template => ({ noun, category, r, h, build, ...extra });
const SEAT: Partial<Template> = { front: true, observerPhrase: 'sitting on the {name}' };

/** A robot figure of height `h` whose face (glowing visor), chest panel and feet all point along local +Z. */
const robot = (h: number) => (c: string): Part[] => [
  box(0.12 * h, 0.3 * h, 0.14 * h, -0.09 * h, 0.15 * h, 0, DARK),
  box(0.12 * h, 0.3 * h, 0.14 * h, 0.09 * h, 0.15 * h, 0, DARK),
  box(0.12 * h, 0.06 * h, 0.22 * h, -0.09 * h, 0.03 * h, 0.05 * h, DARK),
  box(0.12 * h, 0.06 * h, 0.22 * h, 0.09 * h, 0.03 * h, 0.05 * h, DARK),
  box(0.38 * h, 0.36 * h, 0.24 * h, 0, 0.48 * h, 0, c),
  box(0.09 * h, 0.3 * h, 0.1 * h, -0.24 * h, 0.48 * h, 0, DARK),
  box(0.09 * h, 0.3 * h, 0.1 * h, 0.24 * h, 0.48 * h, 0, DARK),
  box(0.18 * h, 0.12 * h, 0.02 * h, 0, 0.5 * h, 0.125 * h, LIGHT),
  box(0.3 * h, 0.24 * h, 0.26 * h, 0, 0.79 * h, 0, c),
  box(0.24 * h, 0.08 * h, 0.02 * h, 0, 0.81 * h, 0.135 * h, '#0b1020', Z, { emissive: '#5CE1E6' }),
  cyl(0.03 * h, 0.09 * h, 0, 0.955 * h, 0, METAL),
];
const AGENT: Partial<Template> = { front: true, observerPhrase: 'standing where the {name} stands' };
export const TABLETOP_AGENTS: Template[] = [t('toy robot', 'agent', 0.09, 0.27, robot(0.27), AGENT)];
export const ROOM_AGENTS: Template[] = [t('robot', 'agent', 0.32, 1.5, robot(1.5), AGENT)];
export const WORKBENCH_AGENTS: Template[] = [t('toy robot', 'agent', 0.09, 0.27, robot(0.27), AGENT)];

/* ------------------------------ tabletop ------------------------------ */
export const TABLETOP_POOL: Template[] = [
  t('mug', 'kitchenware', 0.07, 0.1, (c) => [cyl(0.09, 0.1, 0, 0.05, 0, c), box(0.03, 0.055, 0.016, 0.055, 0.05, 0, c)]),
  t('book', 'stationery', 0.14, 0.045, (c) => [box(0.17, 0.045, 0.24, 0, 0.0225, 0, c), box(0.16, 0.035, 0.235, 0.008, 0.0225, 0, LIGHT)]),
  t('laptop', 'electronics', 0.2, 0.22, (c) => [
    box(0.32, 0.018, 0.22, 0, 0.009, 0, c, Z, { metalness: 0.4 }),
    box(0.32, 0.21, 0.012, 0, 0.118, -0.135, c, [-0.25, 0, 0], { metalness: 0.4 }),
    box(0.29, 0.18, 0.004, 0, 0.12, -0.127, '#10142a', [-0.25, 0, 0], { emissive: '#1b2a66' }),
  ]),
  t('desk lamp', 'lighting', 0.09, 0.49, (c) => [cyl(0.14, 0.02, 0, 0.01, 0, DARK), cyl(0.018, 0.34, 0, 0.19, 0, METAL, { metalness: 0.6 }), cone(0.17, 0.13, 0, 0.425, 0, c)]),
  t('ball', 'toy', 0.06, 0.11, (c) => [sph(0.11, 0.11, 0.11, 0, 0.055, 0, c)]),
  t('bottle', 'kitchenware', 0.045, 0.25, (c) => [cyl(0.07, 0.19, 0, 0.095, 0, c), cyl(0.03, 0.05, 0, 0.215, 0, c), cyl(0.036, 0.02, 0, 0.245, 0, LIGHT)]),
  t('bowl', 'kitchenware', 0.095, 0.08, (c) => [sph(0.19, 0.09, 0.19, 0, 0.045, 0, c), cyl(0.15, 0.012, 0, 0.082, 0, DARK)]),
  t('flowerpot', 'decor', 0.09, 0.3, (c) => [cyl(0.11, 0.1, 0, 0.05, 0, c), sph(0.19, 0.2, 0.19, 0, 0.2, 0, '#3f9d63')]),
  t('candle', 'decor', 0.04, 0.14, (c) => [cyl(0.06, 0.12, 0, 0.06, 0, c), cone(0.018, 0.025, 0, 0.1325, 0, '#ffd27a', { emissive: '#ffb347' })]),
  t('speaker', 'electronics', 0.09, 0.2, (c) => [box(0.12, 0.2, 0.12, 0, 0.1, 0, c), cyl(0.07, 0.006, 0, 0.203, 0, DARK)]),
];
export const TABLETOP_OCCLUDERS: Template[] = [
  t('cereal box', 'occluder', 0.12, 0.3, (c) => [box(0.2, 0.3, 0.07, 0, 0.15, 0, c), box(0.12, 0.1, 0.072, 0, 0.19, 0, LIGHT)]),
  t('monitor', 'occluder', 0.26, 0.43, (c) => [box(0.2, 0.012, 0.15, 0, 0.006, 0, DARK), box(0.035, 0.13, 0.03, 0, 0.075, 0, DARK), box(0.5, 0.3, 0.025, 0, 0.28, 0, c), box(0.47, 0.27, 0.004, 0, 0.28, 0.013, '#10142a', Z, { emissive: '#16235a' })]),
  t('storage box', 'occluder', 0.18, 0.24, (c) => [box(0.3, 0.22, 0.2, 0, 0.11, 0, c), box(0.32, 0.03, 0.22, 0, 0.225, 0, DARK)]),
];

/* -------------------------------- room -------------------------------- */
const legs = (w: number, d: number, h: number, th: number, color: string): Part[] =>
  [-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(th, h, th, (sx * (w - th)) / 2, h / 2, (sz * (d - th)) / 2, color)));

export const ROOM_POOL: Template[] = [
  t('sofa', 'seating', 0.9, 0.82, (c) => [box(1.6, 0.4, 0.8, 0, 0.2, 0, c), box(1.6, 0.44, 0.2, 0, 0.6, -0.3, c), box(0.18, 0.56, 0.8, -0.71, 0.28, 0, c), box(0.18, 0.56, 0.8, 0.71, 0.28, 0, c)], SEAT),
  t('armchair', 'seating', 0.54, 0.84, (c) => [box(0.76, 0.4, 0.74, 0, 0.2, 0, c), box(0.76, 0.46, 0.18, 0, 0.61, -0.28, c), box(0.14, 0.54, 0.74, -0.31, 0.27, 0, c), box(0.14, 0.54, 0.74, 0.31, 0.27, 0, c)], SEAT),
  t('coffee table', 'table', 0.52, 0.4, (c) => [box(0.9, 0.05, 0.5, 0, 0.375, 0, c), ...legs(0.84, 0.44, 0.35, 0.05, DARK)]),
  t('floor lamp', 'lighting', 0.2, 1.72, (c) => [cyl(0.32, 0.03, 0, 0.015, 0, DARK), cyl(0.03, 1.4, 0, 0.72, 0, METAL, { metalness: 0.6 }), cone(0.42, 0.32, 0, 1.56, 0, c, { emissive: '#3a2f14' })]),
  t('planter', 'decor', 0.3, 1.15, (c) => [cyl(0.36, 0.36, 0, 0.18, 0, c), sph(0.66, 0.6, 0.66, 0, 0.72, 0, '#3f9d63'), sph(0.42, 0.4, 0.42, 0.06, 1.0, 0.04, '#52b578')]),
  t('TV stand', 'electronics', 0.62, 1.08, (c) => [box(1.2, 0.45, 0.4, 0, 0.225, 0, c), box(1.0, 0.58, 0.05, 0, 0.78, 0, DARK), box(0.95, 0.53, 0.004, 0, 0.78, 0.027, '#10142a', Z, { emissive: '#16235a' })]),
  t('side table', 'table', 0.25, 0.54, (c) => [cyl(0.46, 0.04, 0, 0.52, 0, c), cyl(0.06, 0.5, 0, 0.25, 0, DARK), cyl(0.28, 0.02, 0, 0.01, 0, DARK)]),
  t('ottoman', 'seating', 0.27, 0.38, (c) => [cyl(0.52, 0.38, 0, 0.19, 0, c)]),
  t('beanbag', 'seating', 0.38, 0.46, (c) => [sph(0.76, 0.46, 0.76, 0, 0.23, 0, c)]),
  t('moving box', 'storage', 0.36, 0.5, (c) => [box(0.5, 0.5, 0.5, 0, 0.25, 0, c), box(0.08, 0.004, 0.5, 0, 0.502, 0, LIGHT)]),
  t('chair', 'seating', 0.3, 0.9, (c) => [box(0.44, 0.04, 0.44, 0, 0.45, 0, c), box(0.44, 0.44, 0.04, 0, 0.69, -0.2, c), ...legs(0.42, 0.42, 0.43, 0.04, DARK)], SEAT),
];
export const ROOM_OCCLUDERS: Template[] = [
  t('bookshelf', 'occluder', 0.46, 1.7, (c) => [box(0.8, 1.7, 0.3, 0, 0.85, 0, c), box(0.7, 0.3, 0.02, 0, 1.4, 0.15, DARK), box(0.7, 0.3, 0.02, 0, 0.95, 0.15, DARK), box(0.7, 0.3, 0.02, 0, 0.5, 0.15, DARK)]),
  t('folding screen', 'occluder', 0.62, 1.6, (c) => [box(0.6, 1.6, 0.05, -0.29, 0.8, 0.04, c, [0, 0.25, 0]), box(0.6, 1.6, 0.05, 0.29, 0.8, 0.04, c, [0, -0.25, 0])]),
  t('wardrobe', 'occluder', 0.6, 1.9, (c) => [box(1.0, 1.9, 0.55, 0, 0.95, 0, c), box(0.02, 1.7, 0.01, 0, 0.95, 0.278, DARK)]),
];

/* ------------------------------ workbench ----------------------------- */
export const WORKBENCH_POOL: Template[] = [
  t('toolbox', 'tools', 0.2, 0.24, (c) => [box(0.36, 0.18, 0.18, 0, 0.09, 0, c), box(0.37, 0.03, 0.19, 0, 0.195, 0, DARK), box(0.16, 0.03, 0.025, 0, 0.225, 0, METAL)]),
  t('paint can', 'supplies', 0.09, 0.19, (c) => [cyl(0.17, 0.18, 0, 0.09, 0, c), cyl(0.175, 0.012, 0, 0.184, 0, METAL, { metalness: 0.7 })]),
  t('jar', 'supplies', 0.05, 0.15, (c) => [cyl(0.09, 0.13, 0, 0.065, 0, c), cyl(0.095, 0.02, 0, 0.14, 0, METAL, { metalness: 0.7 })]),
  t('crate', 'storage', 0.19, 0.22, (c) => [box(0.3, 0.22, 0.24, 0, 0.11, 0, c), box(0.31, 0.03, 0.25, 0, 0.11, 0, WOOD)]),
  t('spray can', 'supplies', 0.035, 0.22, (c) => [cyl(0.065, 0.18, 0, 0.09, 0, c), cone(0.065, 0.03, 0, 0.195, 0, METAL), cyl(0.025, 0.02, 0, 0.21, 0, LIGHT)]),
  t('helmet', 'safety', 0.13, 0.17, (c) => [sph(0.26, 0.17, 0.26, 0, 0.085, 0, c), box(0.27, 0.012, 0.3, 0, 0.006, 0.03, c)]),
  t('tape roll', 'supplies', 0.07, 0.06, (c) => [cyl(0.14, 0.06, 0, 0.03, 0, c), cyl(0.07, 0.062, 0, 0.03, 0, DARK)]),
  t('traffic cone', 'safety', 0.12, 0.3, (c) => [box(0.22, 0.02, 0.22, 0, 0.01, 0, DARK), cone(0.17, 0.28, 0, 0.16, 0, c)]),
  t('drill', 'tools', 0.11, 0.2, (c) => [
    box(0.07, 0.07, 0.2, 0, 0.165, 0, c),
    box(0.05, 0.13, 0.06, 0, 0.065, -0.05, DARK),
    { kind: 'cone', position: [0, 0.165, 0.13], rotation: [Math.PI / 2, 0, 0], scale: [0.05, 0.06, 0.05], color: METAL, metalness: 0.7 },
  ]),
  t('bucket', 'storage', 0.13, 0.24, (c) => [cyl(0.25, 0.24, 0, 0.12, 0, c), cyl(0.22, 0.004, 0, 0.241, 0, DARK)]),
  t('lantern', 'lighting', 0.07, 0.26, (c) => [cyl(0.13, 0.04, 0, 0.02, 0, DARK), cyl(0.1, 0.14, 0, 0.11, 0, c, { emissive: '#2a2410' }), cone(0.14, 0.08, 0, 0.22, 0, DARK)]),
  t('ball', 'toy', 0.06, 0.12, (c) => [sph(0.12, 0.12, 0.12, 0, 0.06, 0, c)]),
];
export const WORKBENCH_OCCLUDERS: Template[] = [
  t('storage bin', 'occluder', 0.2, 0.3, (c) => [box(0.34, 0.28, 0.28, 0, 0.14, 0, c), box(0.36, 0.03, 0.3, 0, 0.285, 0, DARK)]),
  t('pegboard', 'occluder', 0.2, 0.36, (c) => [box(0.4, 0.36, 0.03, 0, 0.18, 0, c), box(0.3, 0.02, 0.1, 0, 0.01, 0, DARK)]),
  t('cabinet', 'occluder', 0.19, 0.34, (c) => [box(0.3, 0.34, 0.24, 0, 0.17, 0, c), box(0.02, 0.06, 0.01, 0.08, 0.2, 0.123, METAL)]),
];
