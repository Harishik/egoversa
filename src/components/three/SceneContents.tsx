import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import { BackSide, BoxGeometry, ConeGeometry, CylinderGeometry, FrontSide, PlaneGeometry, SphereGeometry } from 'three';
import type { PrimitiveKind } from '../../geometry/primitives';
import type { LightingId, Part, Scene } from '../../scenes/types';

// Tessellations of the analytic unit primitives used by the oracle (geometry/primitives.ts).
const GEOMETRY: Record<PrimitiveKind, BoxGeometry | SphereGeometry | CylinderGeometry | ConeGeometry> = {
  box: new BoxGeometry(1, 1, 1),
  sphere: new SphereGeometry(0.5, 40, 24),
  cylinder: new CylinderGeometry(0.5, 0.5, 1, 40),
  cone: new ConeGeometry(0.5, 1, 40),
};
const PLANE = new PlaneGeometry(1, 1);

const LIGHTS: Record<LightingId, { ambient: number; sky: string; key: number; keyColor: string; dir: [number, number, number]; fill: number }> = {
  studio: { ambient: 1.05, sky: '#cfd6ff', key: 2.3, keyColor: '#ffffff', dir: [2.2, 4.5, 3.2], fill: 0.7 },
  warm: { ambient: 0.8, sky: '#ffd9a8', key: 2.1, keyColor: '#ffc98a', dir: [-3, 3.2, 2.4], fill: 0.35 },
  dim: { ambient: 0.28, sky: '#8f9ad8', key: 0.7, keyColor: '#c9d2ff', dir: [1.5, 4, 2], fill: 0.15 },
  backlit: { ambient: 0.4, sky: '#cfd6ff', key: 2.4, keyColor: '#ffffff', dir: [-1.5, 3.5, -4.5], fill: 0.2 },
};

export const LIGHTING_LABELS: Record<LightingId, string> = { studio: 'Studio', warm: 'Warm', dim: 'Dim', backlit: 'Backlit' };

const noRaycast = () => null;

/**
 * Selection outline as an inverted hull: the same primitive, drawn back-faces
 * only and grown by `t` world units along each local axis. Purely visual.
 */
function PartMesh({ part, outline, shadows, t }: { part: Part; outline?: string; shadows: boolean; t: number }) {
  return (
    <mesh geometry={GEOMETRY[part.kind]} position={part.position} rotation={part.rotation} scale={part.scale} castShadow={shadows} receiveShadow={shadows} dispose={null}>
      <meshStandardMaterial color={part.color} roughness={part.roughness ?? 0.62} metalness={part.metalness ?? 0.05} emissive={part.emissive ?? '#000000'} />
      {outline && (
        <mesh geometry={GEOMETRY[part.kind]} scale={[1 + (2 * t) / part.scale[0], 1 + (2 * t) / part.scale[1], 1 + (2 * t) / part.scale[2]]} raycast={noRaycast} dispose={null}>
          <meshBasicMaterial color={outline} side={BackSide} />
        </mesh>
      )}
    </mesh>
  );
}

export interface SceneContentsProps {
  scene: Scene;
  lighting: LightingId;
  /** object id -> outline colour */
  outlines?: Record<string, string>;
  /** object id -> floating tag */
  tags?: Record<string, { text: string; color: string }>;
  onSelect?: (id: string | null) => void;
  shadows?: boolean;
}

/** Lights, fixtures, walls and objects of a scene. Shared by every canvas so all views draw identical geometry. */
export function SceneContents({ scene, lighting, outlines, tags, onSelect, shadows = true }: SceneContentsProps) {
  const L = LIGHTS[lighting];
  const s = scene.extent;
  const keyPos = useMemo<[number, number, number]>(() => [scene.focus[0] + L.dir[0] * s, L.dir[1] * s + 1, scene.focus[2] + L.dir[2] * s], [L, s, scene.focus]);
  const click = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    if (!onSelect) return;
    e.stopPropagation();
    onSelect(id);
  };
  return (
    <>
      <color attach="background" args={['#0B1026']} />
      <hemisphereLight args={[L.sky, '#1a1f3d', L.ambient]} />
      <directionalLight
        position={keyPos}
        intensity={L.key}
        color={L.keyColor}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-s * 2.4}
        shadow-camera-right={s * 2.4}
        shadow-camera-top={s * 2.4}
        shadow-camera-bottom={-s * 2.4}
        shadow-camera-near={0.1}
        shadow-camera-far={s * 14 + 6}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <directionalLight position={[-keyPos[0], keyPos[1] * 0.6, -keyPos[2]]} intensity={L.fill} color="#9fb0ff" />

      <group>
        {scene.fixtures.map((f) => (
          <group key={f.id}>
            {f.parts.map((p, i) => (
              <PartMesh key={i} part={p} shadows={shadows} t={0} />
            ))}
          </group>
        ))}
        {scene.walls.map((w, i) => (
          <mesh key={i} geometry={PLANE} position={w.position} rotation={[0, w.rotationY, 0]} scale={[w.width, w.height, 1]} receiveShadow={shadows} dispose={null}>
            <meshStandardMaterial color={w.color} side={FrontSide} roughness={0.95} />
          </mesh>
        ))}
        {scene.objects.map((o) => {
          const tag = tags?.[o.id];
          return (
            <group key={o.id} position={o.position} rotation={[0, o.rotationY, 0]} onClick={click(o.id)}>
              {o.parts.map((p, i) => (
                <PartMesh key={i} part={p} outline={outlines?.[o.id]} shadows={shadows} t={scene.extent * 0.009} />
              ))}
              {tag && (
                <Html position={[0, o.size[1] + scene.extent * 0.06, 0]} center zIndexRange={[20, 0]}>
                  <span className="scene-label" style={{ borderColor: tag.color, color: tag.color }}>{tag.text}</span>
                </Html>
              )}
            </group>
          );
        })}
      </group>
    </>
  );
}
