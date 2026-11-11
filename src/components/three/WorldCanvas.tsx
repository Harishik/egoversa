import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { VIEWER_ASPECT, VIEWER_FOV_DEG, viewerPosition, type ViewerPose } from '../../geometry/camera';
import type { LightingId, Scene } from '../../scenes/types';
import type { ViewMode } from '../../store/useStudio';
import { SceneContents } from './SceneContents';

const WORLD = '#F0B866';
const VIEWER = '#5CE1E6';
const WORLD_FOV = 38;

function Arrow({ dir, length, color, label }: { dir: [number, number, number]; length: number; color: string; label: string }) {
  const end = useMemo(() => new Vector3(...dir).multiplyScalar(length), [dir, length]);
  const quat = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...dir).normalize()), [dir]);
  return (
    <group>
      <Line points={[[0, 0, 0], end.toArray()]} color={color} lineWidth={2.5} />
      <mesh position={end} quaternion={quat}>
        <coneGeometry args={[length * 0.06, length * 0.2, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html position={end.clone().multiplyScalar(1.22)} center zIndexRange={[10, 0]}>
        <span className="axis-label" style={{ color }}>{label}</span>
      </Html>
    </group>
  );
}

/** World axes, drawn at a floor corner so they never hide the scene. Directions are what matter. */
function WorldAxes({ scene }: { scene: Scene }) {
  const L = scene.extent * 0.42;
  return (
    <group position={[-scene.extent * 1.25, 0.01, scene.extent * 1.25]}>
      <Arrow dir={[1, 0, 0]} length={L} color={WORLD} label="X_w" />
      <Arrow dir={[0, 1, 0]} length={L} color={WORLD} label="Y_w up" />
      <Arrow dir={[0, 0, 1]} length={L} color={WORLD} label="Z_w" />
      <mesh>
        <sphereGeometry args={[L * 0.05, 12, 12]} />
        <meshBasicMaterial color={WORLD} />
      </mesh>
    </group>
  );
}

function viewerQuaternion(scene: Scene, viewer: ViewerPose): { pos: Vector3; quat: Quaternion } {
  const p = viewerPosition(viewer, scene.focus);
  const pos = new Vector3(p[0], p[1], p[2]);
  const m = new Matrix4().lookAt(pos, new Vector3(...scene.focus), new Vector3(0, 1, 0));
  return { pos, quat: new Quaternion().setFromRotationMatrix(m) };
}

/** The viewer camera drawn as an object in the world: body, frustum and its own axes. */
function ViewerGizmo({ scene, viewer }: { scene: Scene; viewer: ViewerPose }) {
  const { pos, quat } = useMemo(() => viewerQuaternion(scene, viewer), [scene, viewer]);
  const s = scene.extent * 0.16;
  const depth = Math.hypot(viewer.distance, viewer.height - scene.focus[1]);
  const hh = depth * Math.tan((VIEWER_FOV_DEG * Math.PI) / 360);
  const hw = hh * VIEWER_ASPECT;
  const corners: [number, number, number][] = [[-hw, -hh, -depth], [hw, -hh, -depth], [hw, hh, -depth], [-hw, hh, -depth]];
  const frustum = corners.flatMap((c, i) => [[0, 0, 0] as [number, number, number], c, c, corners[(i + 1) % 4]]);
  const track = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push([scene.focus[0] + viewer.distance * Math.sin(a), viewer.height, scene.focus[2] + viewer.distance * Math.cos(a)]);
    }
    return pts;
  }, [scene.focus, viewer.distance, viewer.height]);
  return (
    <>
      <Line points={track} color={VIEWER} lineWidth={1} dashed dashSize={scene.extent * 0.06} gapSize={scene.extent * 0.05} transparent opacity={0.4} />
      <Html position={[scene.focus[0], viewer.height, scene.focus[2] + viewer.distance]} center zIndexRange={[10, 0]}>
        <span className="axis-label" style={{ color: VIEWER, opacity: 0.7 }}>0°</span>
      </Html>
      <group position={pos} quaternion={quat}>
        <mesh>
          <boxGeometry args={[s * 0.9, s * 0.62, s * 0.7]} />
          <meshStandardMaterial color="#10142a" emissive={VIEWER} emissiveIntensity={0.35} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, -s * 0.5]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[s * 0.26, s * 0.2, s * 0.34, 20]} />
          <meshStandardMaterial color={VIEWER} emissive={VIEWER} emissiveIntensity={0.5} />
        </mesh>
        <Line points={frustum} segments color={VIEWER} lineWidth={1.2} transparent opacity={0.55} />
        <Arrow dir={[1, 0, 0]} length={s * 2.1} color={VIEWER} label="x_c right" />
        <Arrow dir={[0, 1, 0]} length={s * 2.1} color={VIEWER} label="y_c" />
        <Arrow dir={[0, 0, -1]} length={s * 2.6} color="#E9ECFF" label="−z_c view" />
      </group>
    </>
  );
}

function defaultWorldPosition(scene: Scene): Vector3 {
  const e = scene.extent;
  return new Vector3(scene.focus[0] + e * 2.1, scene.focus[1] + e * 1.7 + 0.4, scene.focus[2] + e * 2.9);
}

/**
 * Owns the inspection camera. In 'world' mode the user orbits freely. Switching
 * to 'viewer' flies the camera into the viewer's pose (the viewpoint-change
 * animation) and then follows it; switching back returns to the saved orbit.
 */
function CameraDirector({ scene, viewer, mode }: { scene: Scene; viewer: ViewerPose; mode: ViewMode }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useRef<OrbitControlsImpl>(null);
  const saved = useRef<Vector3>(defaultWorldPosition(scene));
  const phase = useRef<'world' | 'toViewer' | 'toWorld'>('world');
  const [free, setFree] = useState(true);
  const env = scene.spec.env;

  // Reframe when the environment changes.
  useEffect(() => {
    const p = defaultWorldPosition(scene);
    saved.current.copy(p);
    if (phase.current === 'world') {
      camera.position.copy(p);
      camera.lookAt(...scene.focus);
      controls.current?.target.set(...scene.focus);
      controls.current?.update();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env]);

  useEffect(() => {
    if (mode === 'viewer') {
      if (phase.current === 'world') saved.current.copy(camera.position);
      phase.current = 'toViewer';
      setFree(false);
    } else if (phase.current !== 'world') {
      phase.current = 'toWorld';
    }
  }, [mode, camera]);

  const tmpQ = useMemo(() => new Quaternion(), []);
  const tmpM = useMemo(() => new Matrix4(), []);
  const focusV = useMemo(() => new Vector3(...scene.focus), [scene.focus]);
  const up = useMemo(() => new Vector3(0, 1, 0), []);

  useFrame((_, dt) => {
    if (phase.current === 'world') return;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4.2);
    if (phase.current === 'toViewer') {
      const { pos, quat } = viewerQuaternion(scene, viewer);
      camera.position.lerp(pos, k);
      camera.quaternion.slerp(quat, k);
      camera.fov += (VIEWER_FOV_DEG - camera.fov) * k;
    } else {
      camera.position.lerp(saved.current, k);
      tmpQ.setFromRotationMatrix(tmpM.lookAt(camera.position, focusV, up));
      camera.quaternion.slerp(tmpQ, Math.min(1, k * 1.6));
      camera.fov += (WORLD_FOV - camera.fov) * k;
      if (camera.position.distanceTo(saved.current) < scene.extent * 0.01) {
        camera.position.copy(saved.current);
        camera.lookAt(focusV);
        camera.fov = WORLD_FOV;
        phase.current = 'world';
        controls.current?.target.copy(focusV);
        controls.current?.update();
        setFree(true);
      }
    }
    camera.updateProjectionMatrix();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enabled={free && mode === 'world'}
      target={scene.focus}
      enableDamping
      dampingFactor={0.12}
      maxPolarAngle={Math.PI / 2 - 0.03}
      minDistance={scene.extent * 0.8}
      maxDistance={scene.extent * 9}
    />
  );
}

export interface WorldCanvasProps {
  scene: Scene;
  viewer: ViewerPose;
  lighting: LightingId;
  mode: ViewMode;
  selectedId: string | null;
  showLabels: boolean;
  onSelect: (id: string | null) => void;
}

/** Third-person inspection view: the scene, the world axes and the viewer camera as a physical object. */
export function WorldCanvas({ scene, viewer, lighting, mode, selectedId, showLabels, onSelect }: WorldCanvasProps) {
  const start = useMemo(() => defaultWorldPosition(scene).toArray(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const outlines = selectedId ? { [selectedId]: VIEWER } : undefined;
  const tags = useMemo(() => {
    const t: Record<string, { text: string; color: string }> = {};
    if (mode !== 'world') return t;
    for (const o of scene.objects) {
      if (o.id === selectedId) t[o.id] = { text: o.name, color: VIEWER };
      else if (showLabels) t[o.id] = { text: o.name, color: '#A0A8D4' };
    }
    return t;
  }, [scene, selectedId, showLabels, mode]);
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: start, fov: WORLD_FOV, near: 0.05, far: 120 }}
      onPointerMissed={() => onSelect(null)}
      fallback={<p className="p-6 text-sm text-muted">WebGL is unavailable in this browser, so the 3D viewport cannot be shown. The Benchmark workspace still works.</p>}
    >
      <CameraDirector scene={scene} viewer={viewer} mode={mode} />
      <SceneContents scene={scene} lighting={lighting} outlines={outlines} tags={tags} onSelect={onSelect} />
      <WorldAxes scene={scene} />
      {mode === 'world' && scene.objects.filter((o) => o.front).map((o) => (
        <group key={o.id} position={[o.center[0], o.position[1] + o.size[1] + scene.extent * 0.02, o.center[2]]}>
          <Arrow dir={o.front!} length={scene.extent * (o.id === selectedId ? 0.34 : 0.22)} color="#7C87FF" label={o.id === selectedId ? 'facing' : ''} />
        </group>
      ))}
      {mode === 'world' && <ViewerGizmo scene={scene} viewer={viewer} />}
    </Canvas>
  );
}
