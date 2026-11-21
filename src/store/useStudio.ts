import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { wrapDeg, type ViewerPose } from '../geometry/camera';
import { randomSeedName } from '../geometry/rng';
import { DEFAULT_BATCH, type BatchConfig, type BatchResult } from '../evaluation/evaluator';
import { generateScene, normalizeSpec } from '../scenes/generate';
import { buildScenario, clampViewer, type Scenario } from '../scenes/scenario';
import type { EnvId, LightingId, Scene, SceneSpec } from '../scenes/types';

export type Workspace = 'lab' | 'physics' | 'arena' | 'bench' | 'models';
export type ViewMode = 'world' | 'viewer';

const DEFAULT_SPEC: SceneSpec = { env: 'tabletop', seed: 'amber-harbor-42', objectCount: 8, occlusion: 0.5, distractors: 1, jitter: 0.5, agents: 1 };

export interface StudioState {
  workspace: Workspace;
  spec: SceneSpec;
  scene: Scene;
  viewer: ViewerPose;
  lighting: LightingId;
  toleranceScale: number;
  viewMode: ViewMode;
  selectedId: string | null;
  showLabels: boolean;
  saved: Scenario[];
  heroSeen: boolean;
  demoStep: number | null;
  aboutOpen: boolean;
  modelServer: string;
  batchConfig: BatchConfig;
  batchResult: BatchResult | null;
  toast: { id: number; text: string; tone: 'ok' | 'warn' } | null;

  setWorkspace: (w: Workspace) => void;
  updateSpec: (patch: Partial<SceneSpec>) => void;
  setEnv: (env: EnvId) => void;
  newSeed: () => void;
  setViewer: (patch: Partial<ViewerPose>) => void;
  animateViewer: (patch: Partial<ViewerPose>, ms?: number) => void;
  nudgeAzimuth: (deltaDeg: number) => void;
  setLighting: (l: LightingId) => void;
  setToleranceScale: (s: number) => void;
  setViewMode: (m: ViewMode) => void;
  select: (id: string | null) => void;
  setShowLabels: (v: boolean) => void;
  saveScenario: () => void;
  deleteSaved: (index: number) => void;
  loadScenario: (s: Pick<Scenario, 'spec' | 'viewer'> & Partial<Pick<Scenario, 'lighting' | 'toleranceScale'>>) => void;
  setHeroSeen: (v: boolean) => void;
  setDemoStep: (s: number | null) => void;
  setAboutOpen: (v: boolean) => void;
  setModelServer: (v: string) => void;
  setBatchConfig: (patch: Partial<BatchConfig>) => void;
  setBatchResult: (r: BatchResult | null) => void;
  notify: (text: string, tone?: 'ok' | 'warn') => void;
}

let raf = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const initialScene = generateScene(DEFAULT_SPEC);

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      workspace: 'lab',
      spec: initialScene.spec,
      scene: initialScene,
      viewer: { azimuthDeg: 35, ...initialScene.defaultViewer },
      lighting: 'studio',
      toleranceScale: 1,
      viewMode: 'world',
      selectedId: null,
      showLabels: true,
      saved: [],
      heroSeen: false,
      demoStep: null,
      aboutOpen: false,
      modelServer: 'http://127.0.0.1:8787',
      batchConfig: DEFAULT_BATCH,
      batchResult: null,
      toast: null,

      setWorkspace: (workspace) => set({ workspace }),
      updateSpec: (patch) => {
        const spec = normalizeSpec({ ...get().spec, ...patch });
        const scene = generateScene(spec);
        set({ spec: scene.spec, scene, selectedId: null, viewer: clampViewer(get().viewer, scene) });
      },
      setEnv: (env) => {
        if (env === get().spec.env) return;
        cancelAnimationFrame(raf);
        const scene = generateScene(normalizeSpec({ ...get().spec, env }));
        set({ spec: scene.spec, scene, selectedId: null, viewer: { azimuthDeg: get().viewer.azimuthDeg, ...scene.defaultViewer } });
      },
      newSeed: () => get().updateSpec({ seed: randomSeedName() }),
      setViewer: (patch) => {
        const v = clampViewer({ ...get().viewer, ...patch }, get().scene);
        set({ viewer: { ...v, azimuthDeg: wrapDeg(v.azimuthDeg) } });
      },
      animateViewer: (patch, ms = 900) => {
        cancelAnimationFrame(raf);
        const from = get().viewer;
        const to = clampViewer({ ...from, ...patch }, get().scene);
        const dAz = patch.azimuthDeg === undefined ? 0 : wrapDeg(to.azimuthDeg - from.azimuthDeg);
        if (reducedMotion() || ms <= 0) {
          set({ viewer: { ...to, azimuthDeg: wrapDeg(from.azimuthDeg + dAz) } });
          return;
        }
        const t0 = performance.now();
        const step = () => {
          const k = ease(Math.min(1, (performance.now() - t0) / ms));
          set({
            viewer: {
              azimuthDeg: wrapDeg(from.azimuthDeg + dAz * k),
              height: from.height + (to.height - from.height) * k,
              distance: from.distance + (to.distance - from.distance) * k,
            },
          });
          if (k < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      nudgeAzimuth: (d) => get().setViewer({ azimuthDeg: get().viewer.azimuthDeg + d }),
      setLighting: (lighting) => set({ lighting }),
      setToleranceScale: (toleranceScale) => set({ toleranceScale }),
      setViewMode: (viewMode) => set({ viewMode }),
      select: (selectedId) => set({ selectedId }),
      setShowLabels: (showLabels) => set({ showLabels }),
      saveScenario: () => {
        const { scene, viewer, lighting, toleranceScale, saved } = get();
        const s = buildScenario(scene, viewer, lighting, toleranceScale, undefined, false);
        s.name = `${s.name} @ ${Math.round(viewer.azimuthDeg)}°`;
        set({ saved: [s, ...saved].slice(0, 24) });
        get().notify('Scenario saved in this browser');
      },
      deleteSaved: (index) => set({ saved: get().saved.filter((_, i) => i !== index) }),
      loadScenario: (s) => {
        cancelAnimationFrame(raf);
        const scene = generateScene(normalizeSpec(s.spec));
        set({
          spec: scene.spec,
          scene,
          selectedId: null,
          viewer: clampViewer(s.viewer, scene),
          lighting: s.lighting ?? get().lighting,
          toleranceScale: s.toleranceScale ?? get().toleranceScale,
        });
      },
      setHeroSeen: (heroSeen) => set({ heroSeen }),
      setDemoStep: (demoStep) => set({ demoStep }),
      setAboutOpen: (aboutOpen) => set({ aboutOpen }),
      setModelServer: (modelServer) => set({ modelServer: modelServer.replace(/\/+$/, '') }),
      setBatchConfig: (patch) => set({ batchConfig: { ...get().batchConfig, ...patch } }),
      setBatchResult: (batchResult) => set({ batchResult }),
      notify: (text, tone = 'ok') => {
        clearTimeout(toastTimer);
        set({ toast: { id: Date.now(), text, tone } });
        toastTimer = setTimeout(() => set({ toast: null }), 3200);
      },
    }),
    {
      name: 'egoversa.studio.v2',
      version: 2,
      partialize: (s) => ({
        spec: s.spec,
        viewer: s.viewer,
        lighting: s.lighting,
        toleranceScale: s.toleranceScale,
        showLabels: s.showLabels,
        saved: s.saved,
        heroSeen: s.heroSeen,
        modelServer: s.modelServer,
        batchConfig: s.batchConfig,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StudioState>;
        try {
          const scene = generateScene(normalizeSpec({ ...current.spec, ...(p.spec ?? {}) }));
          return {
            ...current,
            ...p,
            spec: scene.spec,
            scene,
            viewer: clampViewer({ ...current.viewer, ...(p.viewer ?? {}) }, scene),
            batchConfig: { ...current.batchConfig, ...(p.batchConfig ?? {}) },
            saved: Array.isArray(p.saved) ? p.saved : [],
          };
        } catch {
          return current;
        }
      },
    },
  ),
);
