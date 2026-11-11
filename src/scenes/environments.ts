import type { Vec3 } from '../geometry/types';
import {
  box,
  ROOM_AGENTS, ROOM_OCCLUDERS, ROOM_POOL, TABLETOP_AGENTS, TABLETOP_OCCLUDERS, TABLETOP_POOL, WORKBENCH_AGENTS, WORKBENCH_OCCLUDERS, WORKBENCH_POOL,
  type Template,
} from './catalog';
import type { EnvId, Fixture, ViewerLimits, Wall } from './types';

/** A rectangular support surface objects can rest on. */
export interface Region {
  id: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** World height of the support surface. */
  y: number;
  /** Clearance above the surface (Infinity if open). */
  maxH: number;
  /** Largest footprint radius that fits. */
  maxR: number;
}

export interface EnvDef {
  id: EnvId;
  label: string;
  blurb: string;
  focus: Vec3;
  defaultViewer: { height: number; distance: number };
  limits: ViewerLimits;
  extent: number;
  /** Characteristic gap between neighbouring objects, metres. */
  unit: number;
  fixtures: Fixture[];
  walls: Wall[];
  regions: Region[];
  pool: Template[];
  occluders: Template[];
  agents: Template[];
  /** Nouns reserved for out-of-distribution test splits (never placed when listed in SceneSpec.exclude). */
  heldOutNouns: string[];
}

const FLOOR = '#2c3566';
const floor = (size: number): Fixture => ({ id: 'floor', name: 'floor', occludes: true, parts: [box(size, 0.1, size, 0, -0.05, 0, FLOOR)] });

const tabletop: EnvDef = {
  id: 'tabletop',
  label: 'Tabletop',
  blurb: 'Small objects scattered on a desk. Tight depth ordering, mild occlusion.',
  focus: [0, 0.85, 0],
  defaultViewer: { height: 1.5, distance: 1.75 },
  limits: { minHeight: 0.85, maxHeight: 2.6, minDistance: 1.2, maxDistance: 3 },
  extent: 1.0,
  unit: 0.06,
  fixtures: [
    floor(7),
    {
      id: 'table', name: 'table', occludes: true,
      parts: [
        box(1.5, 0.04, 0.9, 0, 0.73, 0, '#8a6a4f'),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.05, 0.71, 0.05, sx * 0.68, 0.355, sz * 0.38, '#3b4060'))),
      ],
    },
  ],
  walls: [],
  regions: [{ id: 'desk', x0: -0.72, x1: 0.72, z0: -0.42, z1: 0.42, y: 0.75, maxH: Infinity, maxR: 1 }],
  pool: TABLETOP_POOL,
  occluders: TABLETOP_OCCLUDERS,
  agents: TABLETOP_AGENTS,
  heldOutNouns: ['candle', 'speaker'],
};

const R = 2.3;
const room: EnvDef = {
  id: 'room',
  label: 'Compact room',
  blurb: 'Furniture at human scale. Large viewpoint-dependent occluders.',
  focus: [0, 0.7, 0],
  defaultViewer: { height: 1.7, distance: 4.6 },
  limits: { minHeight: 0.6, maxHeight: 3.4, minDistance: 3.0, maxDistance: 6.5 },
  extent: 2.5,
  unit: 0.25,
  fixtures: [{ id: 'floor', name: 'floor', occludes: true, parts: [box(2 * R, 0.1, 2 * R, 0, -0.05, 0, '#34407a')] }],
  walls: [
    { position: [0, 1.25, -R], rotationY: 0, width: 2 * R, height: 2.5, color: '#3a4580' },
    { position: [0, 1.25, R], rotationY: Math.PI, width: 2 * R, height: 2.5, color: '#3a4580' },
    { position: [-R, 1.25, 0], rotationY: Math.PI / 2, width: 2 * R, height: 2.5, color: '#323c72' },
    { position: [R, 1.25, 0], rotationY: -Math.PI / 2, width: 2 * R, height: 2.5, color: '#323c72' },
  ],
  regions: [{ id: 'floor', x0: -2.05, x1: 2.05, z0: -2.05, z1: 2.05, y: 0, maxH: Infinity, maxR: 2 }],
  pool: ROOM_POOL,
  occluders: ROOM_OCCLUDERS,
  agents: ROOM_AGENTS,
  heldOutNouns: ['ottoman', 'beanbag'],
};

const SHELF_X = 0.76;
const workbench: EnvDef = {
  id: 'workbench',
  label: 'Shelf & workbench',
  blurb: 'Cluttered tiers. Objects stacked vertically behind boards and bins.',
  focus: [0, 1.3, -0.05],
  defaultViewer: { height: 1.6, distance: 2.7 },
  limits: { minHeight: 0.95, maxHeight: 2.8, minDistance: 1.8, maxDistance: 3.8 },
  extent: 1.2,
  unit: 0.05,
  fixtures: [
    floor(7),
    {
      id: 'bench', name: 'workbench', occludes: true,
      parts: [
        box(1.9, 0.06, 0.9, 0, 0.87, 0, '#7a5c42'),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.07, 0.84, 0.07, sx * 0.88, 0.42, sz * 0.38, '#3b4060'))),
      ],
    },
    {
      id: 'shelf', name: 'shelf', occludes: true,
      parts: [
        box(1.72, 0.03, 0.34, 0, 1.285, -0.27, '#59648f'),
        box(1.72, 0.03, 0.34, 0, 1.685, -0.27, '#59648f'),
        ...[-1, 1].flatMap((sx) => [-0.42, -0.12].map((z) => box(0.04, 0.8, 0.04, sx * 0.84, 1.3, z, '#3b4060'))),
      ],
    },
  ],
  walls: [],
  regions: [
    { id: 'bench-front', x0: -0.88, x1: 0.88, z0: -0.02, z1: 0.42, y: 0.9, maxH: Infinity, maxR: 0.21 },
    { id: 'bench-back', x0: -SHELF_X, x1: SHELF_X, z0: -0.41, z1: -0.13, y: 0.9, maxH: 0.36, maxR: 0.135 },
    { id: 'shelf-mid', x0: -SHELF_X, x1: SHELF_X, z0: -0.41, z1: -0.13, y: 1.3, maxH: 0.36, maxR: 0.135 },
    { id: 'shelf-top', x0: -SHELF_X, x1: SHELF_X, z0: -0.41, z1: -0.13, y: 1.7, maxH: 0.5, maxR: 0.135 },
  ],
  pool: WORKBENCH_POOL,
  occluders: WORKBENCH_OCCLUDERS,
  agents: WORKBENCH_AGENTS,
  heldOutNouns: ['lantern', 'bucket'],
};

export const ENVIRONMENTS: Record<EnvId, EnvDef> = { tabletop, room, workbench };
export const ENV_IDS: EnvId[] = ['tabletop', 'room', 'workbench'];
