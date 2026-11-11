import { Canvas, useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import type { PerspectiveCamera } from 'three';
import { VIEWER_FOV_DEG, viewerPosition, type ViewerPose } from '../../geometry/camera';
import type { LightingId, Scene } from '../../scenes/types';
import { SceneContents } from './SceneContents';

export function ViewerCam({ scene, viewer }: { scene: Scene; viewer: ViewerPose }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    const p = viewerPosition(viewer, scene.focus);
    camera.position.set(p[0], p[1], p[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(scene.focus[0], scene.focus[1], scene.focus[2]);
    camera.fov = VIEWER_FOV_DEG;
    camera.near = 0.05;
    camera.far = 80;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, scene, viewer.azimuthDeg, viewer.height, viewer.distance, size.width, size.height]);
  return null;
}

export interface ViewerCanvasProps {
  scene: Scene;
  viewer: ViewerPose;
  lighting: LightingId;
  /** Receives the WebGL canvas so callers can capture the clean frame (for the optional VLM adapter). */
  onCanvas?: (el: HTMLCanvasElement) => void;
  outlines?: Record<string, string>;
  tags?: Record<string, { text: string; color: string }>;
  label?: string;
  className?: string;
}

/**
 * The viewer's own 4:3 image: exactly the frame the questions refer to.
 * With no `outlines` / `tags` it contains nothing but the rendered scene —
 * no axes, labels, gizmos or metadata.
 */
export function ViewerCanvas({ scene, viewer, lighting, onCanvas, outlines, tags, label = 'Viewer camera image', className = '' }: ViewerCanvasProps) {
  return (
    <div className={`relative aspect-[4/3] w-full overflow-hidden bg-night-900 ${className}`} role="img" aria-label={label}>
      <Canvas
        shadows
        dpr={[1, 1.5]}
        frameloop="demand"
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ fov: VIEWER_FOV_DEG, near: 0.05, far: 80 }}
        onCreated={({ gl }) => onCanvas?.(gl.domElement)}
        fallback={<p className="p-4 text-sm text-muted">WebGL is unavailable, so the viewer image cannot be rendered.</p>}
      >
        <ViewerCam scene={scene} viewer={viewer} />
        <SceneContents scene={scene} lighting={lighting} outlines={outlines} tags={tags} />
      </Canvas>
    </div>
  );
}
