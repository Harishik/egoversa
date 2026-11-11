import { Canvas, useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { VIEWER_FOV_DEG, type ViewerPose } from '../../geometry/camera';
import { generateScene } from '../../scenes/generate';
import type { LightingId, Scene, SceneSpec } from '../../scenes/types';
import { SceneContents } from './SceneContents';
import { ViewerCam } from './ViewerCanvas';

/**
 * Headless render target used by scripts/build-dataset.ts (open the app with `?render=1`).
 *
 * It draws exactly what the in-app "viewer camera image" draws — the same SceneContents and the same
 * camera maths — with no outlines, tags, axes or UI, at a fixed pixel size. The page exposes
 *   window.__egoversaRender(spec, pose, lighting) -> Promise<PNG data URL>
 * and nothing else: no oracle output is ever computed in, or readable from, this page.
 */
declare global {
  interface Window {
    __egoversaRender?: (spec: SceneSpec, pose: ViewerPose, lighting: LightingId) => Promise<string>;
    __egoversaReady?: boolean;
  }
}

interface Job {
  scene: Scene;
  pose: ViewerPose;
  lighting: LightingId;
  id: number;
}

function FrameCounter({ counter }: { counter: React.MutableRefObject<number> }) {
  useFrame(() => {
    counter.current++;
  });
  return null;
}

export function RenderHarness() {
  const params = new URLSearchParams(window.location.search);
  const width = Math.min(1024, Math.max(128, Number(params.get('w')) || 512));
  const height = Math.round((width * 3) / 4);
  const [job, setJob] = useState<Job | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const frames = useRef(0);
  const jobId = useRef(0);
  const sceneCache = useRef(new Map<string, Scene>());
  const committed = useRef({ id: 0, frame: 0 });
  useEffect(() => {
    committed.current = { id: job?.id ?? 0, frame: frames.current };
  }, [job]);

  useEffect(() => {
    window.__egoversaRender = async (spec, pose, lighting) => {
      const key = JSON.stringify(spec);
      let scene = sceneCache.current.get(key);
      if (!scene) {
        if (sceneCache.current.size > 8) sceneCache.current.clear();
        sceneCache.current.set(key, (scene = generateScene(spec)));
      }
      const id = ++jobId.current;
      setJob({ scene, pose, lighting, id });
      // Wait until React has committed the job and the renderer has drawn several frames with it
      // (the shadow map needs one extra pass after geometry changes).
      await new Promise<void>((resolve, reject) => {
        const t0 = performance.now();
        const tick = () => {
          if (committed.current.id === id && frames.current - committed.current.frame >= 3 && canvas.current) return resolve();
          if (performance.now() - t0 > 15000) return reject(new Error('render timed out'));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return canvas.current!.toDataURL('image/png');
    };
    window.__egoversaReady = true;
    return () => {
      delete window.__egoversaRender;
    };
  }, []);

  return (
    <div style={{ width, height, background: '#0B1026' }} data-testid="render-harness">
      <Canvas
        shadows
        dpr={1}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: VIEWER_FOV_DEG, near: 0.05, far: 80 }}
        onCreated={({ gl }) => (canvas.current = gl.domElement)}
      >
        <FrameCounter counter={frames} />
        {job && (
          <>
            <ViewerCam scene={job.scene} viewer={job.pose} />
            <SceneContents key={job.scene.fingerprint} scene={job.scene} lighting={job.lighting} />
          </>
        )}
      </Canvas>
    </div>
  );
}
