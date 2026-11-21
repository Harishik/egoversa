import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import { BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, CylinderGeometry, Matrix4, Quaternion, SRGBColorSpace, SphereGeometry, TextureLoader, Vector3, type PerspectiveCamera, type Texture } from 'three';
import { Empty, Info, Kbd, Segmented } from '../ui/controls';

/* ---------------------------------------------------------------- data contract (public/sim/*.json) */

type Pose = number[]; // x y z qw qx qy qz (MuJoCo world, z up)
interface MeshRef { file: string; nv: number; nf: number; uv: boolean; index32: boolean; texture?: string }
interface SimGeom { type: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'ellipsoid' | 'mesh'; size: number[]; rgba: number[]; body: string; pos: number[]; quat: number[]; emissive?: boolean; mesh?: MeshRef }
interface Frame { t: number; poses: Record<string, Pose> }
interface Rollout { removed: string; displacement_cm: Record<string, number>; frames: Frame[] }
interface Agent { name: string; kind?: string; pos: number[]; quat: number[]; heading: number[]; height: number; eye: { pos: number[]; mat: number[]; fovy: number } }
interface SimQuestion { task: string; question: string; options: string[]; answer: string; explanation: string; objects: string[] }
interface SimScene {
  format: string; engine: string; simulator: string; fingerprint: string; spec: { seed: string };
  objects: { name: string; noun: string; color: string; mass: number; asset?: string | null }[];
  geoms: SimGeom[]; settle: Frame[]; support: Record<string, string[]>; rollouts: Rollout[]; agents: Agent[]; questions: SimQuestion[];
}
interface SimIndex { simulator: string; scenes: { file: string; seed: string; fingerprint: string; objects: number; agents: number; stacked: number; rollouts: number }[] }

const BASE = import.meta.env.BASE_URL;
const MOVED_CM = 3;
const TASK_LABEL: Record<string, string> = {
  lateral: 'Camera left / right', depth: 'Closer / farther', vertical: 'Above / below', visibility: 'Visible / occluded',
  obs_lateral: 'Robot’s left / right', obs_frontback: 'Robot’s front / behind', facing: 'Facing', support: 'Resting on', counterfactual: 'What if removed',
};

/* --------------------------------------------------------------------------------- geometry helpers */

/** Scanned-object and robot meshes: binary buffers exported by export_sim_scenes.py (positions, uvs, indices). */
const meshCache = new Map<string, Promise<BufferGeometry>>();
function loadMesh(ref: MeshRef): Promise<BufferGeometry> {
  let p = meshCache.get(ref.file);
  if (!p) {
    p = fetch(`${BASE}sim/${ref.file}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((buf) => {
        const geo = new BufferGeometry();
        let off = 0;
        geo.setAttribute('position', new BufferAttribute(new Float32Array(buf, off, ref.nv * 3), 3));
        off += ref.nv * 12;
        if (ref.uv) {
          geo.setAttribute('uv', new BufferAttribute(new Float32Array(buf, off, ref.nv * 2), 2));
          off += ref.nv * 8;
        }
        geo.setIndex(new BufferAttribute(ref.index32 ? new Uint32Array(buf, off, ref.nf * 3) : new Uint16Array(buf, off, ref.nf * 3), 1));
        geo.computeVertexNormals();
        return geo;
      });
    meshCache.set(ref.file, p);
  }
  return p;
}
const texCache = new Map<string, Texture>();
function textureFor(file: string): Texture {
  let t = texCache.get(file);
  if (!t) {
    t = new TextureLoader().load(`${BASE}sim/${file}`);
    t.colorSpace = SRGBColorSpace;
    t.flipY = false; // MuJoCo stores texture rows top-down with v measured from the top
    texCache.set(file, t);
  }
  return t;
}
function useMeshGeometry(ref?: MeshRef): BufferGeometry | null {
  const [geo, setGeo] = useState<BufferGeometry | null>(null);
  useEffect(() => {
    if (!ref) return;
    let live = true;
    loadMesh(ref).then((g) => live && setGeo(g)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ref]);
  return geo;
}

const geomCache = new Map<string, BufferGeometry>();
function geometryFor(g: SimGeom): BufferGeometry {
  const key = `${g.type}:${g.size.join(',')}`;
  let geo = geomCache.get(key);
  if (geo) return geo;
  const [a, b, c] = g.size;
  switch (g.type) {
    case 'box': geo = new BoxGeometry(2 * a, 2 * b, 2 * c); break;
    case 'sphere': geo = new SphereGeometry(a, 32, 20); break;
    case 'ellipsoid': geo = new SphereGeometry(1, 32, 20).scale(a, b, c); break;
    // MuJoCo cylinders and capsules run along local z; three.js builds them along y.
    case 'cylinder': geo = new CylinderGeometry(a, a, 2 * b, 32).rotateX(Math.PI / 2); break;
    case 'capsule': geo = new CapsuleGeometry(a, 2 * b, 8, 24).rotateX(Math.PI / 2); break;
  }
  geomCache.set(key, geo!);
  return geo!;
}
const q = (w: number, x: number, y: number, z: number) => new Quaternion(x, y, z, w);

function interp(frames: Frame[], t: number): Record<string, Pose> {
  if (!frames.length) return {};
  if (t <= frames[0].t) return frames[0].poses;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.poses;
  let i = 1;
  while (frames[i].t < t) i++;
  const f0 = frames[i - 1];
  const f1 = frames[i];
  const k = (t - f0.t) / (f1.t - f0.t);
  const out: Record<string, Pose> = {};
  for (const name of Object.keys(f1.poses)) {
    const p0 = f0.poses[name] ?? f1.poses[name];
    const p1 = f1.poses[name];
    const qa = q(p0[3], p0[4], p0[5], p0[6]).slerp(q(p1[3], p1[4], p1[5], p1[6]), k);
    out[name] = [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k, p0[2] + (p1[2] - p0[2]) * k, qa.w, qa.x, qa.y, qa.z];
  }
  return out;
}

/** MuJoCo world (z up) -> three.js world (y up): (x, y, z) -> (x, z, -y). */
const toThree = (v: number[]) => new Vector3(v[0], v[2], -v[1]);

/* ------------------------------------------------------------------------------------- 3D content */

function GeomMesh({ g, tint, ghost }: { g: SimGeom; tint?: string; ghost?: boolean }) {
  const loaded = useMeshGeometry(g.mesh);
  const geometry = g.type === 'mesh' ? loaded : geometryFor(g);
  if (!geometry) return null;
  const textured = !!g.mesh?.texture;
  return (
    <mesh geometry={geometry} position={g.pos as [number, number, number]} quaternion={q(g.quat[0], g.quat[1], g.quat[2], g.quat[3])} castShadow={!ghost} receiveShadow={!ghost}>
      <meshStandardMaterial
        map={textured ? textureFor(g.mesh!.texture!) : null}
        color={textured ? '#ffffff' : `rgb(${Math.round(g.rgba[0] * 255)},${Math.round(g.rgba[1] * 255)},${Math.round(g.rgba[2] * 255)})`}
        roughness={textured ? 0.6 : 0.45} metalness={textured ? 0.0 : 0.15}
        emissive={g.emissive ? '#5CE1E6' : tint ?? '#000000'} emissiveIntensity={g.emissive ? 0.9 : tint ? 0.35 : 0}
        transparent={ghost} opacity={ghost ? 0.18 : 1} wireframe={ghost}
      />
    </mesh>
  );
}

function Body({ geoms, pose, tint, ghost }: { geoms: SimGeom[]; pose?: Pose; tint?: string; ghost?: boolean }) {
  const position = pose ? ([pose[0], pose[1], pose[2]] as [number, number, number]) : undefined;
  const quaternion = pose ? q(pose[3], pose[4], pose[5], pose[6]) : undefined;
  return (
    <group position={position} quaternion={quaternion}>
      {geoms.map((g, i) => <GeomMesh key={i} g={g} tint={tint} ghost={ghost} />)}
    </group>
  );
}

/** Frame the table and every robot: the default orbit distance grows with how far the robots stand from the table. */
function FitCamera({ scene, active }: { scene: SimScene; active: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  useEffect(() => {
    if (!active) return;
    const pts = scene.agents.map((a) => toThree(a.pos));
    const cx = pts.length ? pts.reduce((s, p) => s + p.x, 0) / (pts.length + 1) : 0;
    const cz = pts.length ? pts.reduce((s, p) => s + p.z, 0) / (pts.length + 1) : 0;
    const reach = Math.max(0.8, ...pts.map((p) => Math.hypot(p.x - cx, p.z - cz) + 0.35));
    const d = (1.3 + 2.1 * reach) / Math.min(1, camera.aspect * 0.95); // narrow canvases need to stand further back
    const dir = new Vector3(0.16, 0.55, 0.82).normalize();
    camera.position.set(cx + dir.x * d, 0.7 + dir.y * d, cz + dir.z * d);
    camera.lookAt(cx, 0.7, cz);
    if (controls) {
      controls.target.set(cx, 0.7, cz);
      controls.update();
    }
  }, [scene, active, camera, controls]);
  return null;
}

function EyeCamera({ agent, active }: { agent?: Agent; active: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  useEffect(() => {
    if (!active || !agent) return;
    const m = agent.eye.mat; // row-major 3x3, columns = camera x (right), y (up), z (back) in MuJoCo world
    const col = (j: number) => toThree([m[j], m[3 + j], m[6 + j]]);
    const basis = new Matrix4().makeBasis(col(0), col(1), col(2));
    camera.position.copy(toThree(agent.eye.pos));
    camera.quaternion.setFromRotationMatrix(basis);
    camera.fov = agent.eye.fovy;
    camera.updateProjectionMatrix();
    return () => {
      camera.position.set(0.5, 2.1, 3.1);
      camera.lookAt(0, 0.7, 0);
      camera.fov = 40;
      camera.updateProjectionMatrix();
    };
  }, [active, agent, camera]);
  return null;
}

function SceneView({ scene, poses, removed, moved, showSupport, eyeAgent, selected }: {
  scene: SimScene; poses: Record<string, Pose>; removed: string | null; moved: Set<string>; showSupport: boolean; eyeAgent?: Agent; selected: string | null;
}) {
  const byBody = useMemo(() => {
    const m = new Map<string, SimGeom[]>();
    for (const g of scene.geoms) m.set(g.body, [...(m.get(g.body) ?? []), g]);
    return m;
  }, [scene]);
  const finalPoses = scene.settle[scene.settle.length - 1].poses;
  const lines = showSupport
    ? Object.entries(scene.support).flatMap(([top, sups]) => sups.filter((s) => finalPoses[s]).map((s) => [poses[top] ?? finalPoses[top], poses[s] ?? finalPoses[s], top] as const))
    : [];
  return (
    <>
      <color attach="background" args={['#0B1026']} />
      <hemisphereLight args={['#cfd6ff', '#1a1f3d', 0.9]} />
      <directionalLight position={[1.6, 3.2, 1.4]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-1.5} shadow-camera-right={1.5} shadow-camera-top={1.5} shadow-camera-bottom={-1.5} shadow-bias={-0.0004} />
      <EyeCamera agent={eyeAgent} active={!!eyeAgent} />
      <FitCamera scene={scene} active={!eyeAgent} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#232a52" roughness={0.95} />
      </mesh>
      <gridHelper args={[8, 32, '#3A4585', '#2a3368']} position={[0, 0.001, 0]} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <Body geoms={byBody.get('static') ?? []} />
        {scene.agents.map((a) => (
          // realistic robots (kind set) are exported in world coordinates; older toy agents in their body frame
          <Body key={a.name} geoms={byBody.get(`agent:${a.name}`) ?? []} pose={a.kind ? undefined : [...a.pos, ...a.quat]} />
        ))}
        {scene.objects.map((o) => {
          const isRemoved = o.name === removed;
          const pose = isRemoved ? finalPoses[o.name] : poses[o.name] ?? finalPoses[o.name];
          return (
            <group key={o.name}>
              <Body geoms={byBody.get(`obj:${o.name}`) ?? []} pose={pose} ghost={isRemoved} tint={moved.has(o.name) ? '#FF7A90' : o.name === selected ? '#7C87FF' : undefined} />
              {(moved.has(o.name) || o.name === selected) && pose && !isRemoved && (
                <Html position={[pose[0], pose[1], pose[2] + 0.07]} center zIndexRange={[20, 0]}>
                  <span className="scene-label" style={{ borderColor: moved.has(o.name) ? '#FF7A90' : '#7C87FF', color: moved.has(o.name) ? '#FF9EB1' : '#E9ECFF' }}>{o.name}</span>
                </Html>
              )}
            </group>
          );
        })}
        {lines.map(([a, b, key], i) => (
          <group key={`m-${key}-${i}`}>
            {[a, b].map((p, j) => (
              <mesh key={j} position={[p[0], p[1], p[2]]} renderOrder={11}>
                <sphereGeometry args={[0.009, 12, 8]} />
                <meshBasicMaterial color="#F0B866" depthTest={false} />
              </mesh>
            ))}
          </group>
        ))}
        {lines.map(([a, b, key], i) => (
          <Line key={`${key}-${i}`} points={[[a[0], a[1], a[2]], [b[0], b[1], b[2]]]} color="#F0B866" lineWidth={3} depthTest={false} renderOrder={10} />
        ))}
      </group>
      {!eyeAgent && <OrbitControls makeDefault target={[0, 0.7, 0]} maxPolarAngle={Math.PI / 2 - 0.05} minDistance={0.6} maxDistance={6} />}
    </>
  );
}

/* ----------------------------------------------------------------------------------------- workspace */

export function PhysicsLab() {
  const [index, setIndex] = useState<SimIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [scene, setScene] = useState<SimScene | null>(null);
  const [mode, setMode] = useState<'settle' | number>('settle');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [showSupport, setShowSupport] = useState(true);
  const [view, setView] = useState<'orbit' | string>('orbit');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}sim/index.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: SimIndex) => {
        setIndex(d);
        setFile(d.scenes[0]?.file ?? null);
      })
      .catch((e: Error) => setError(`Recorded scenes could not be loaded (${e.message}). Generate them with research/scripts/export_sim_scenes.py.`));
  }, []);
  useEffect(() => {
    if (!file) return;
    setScene(null);
    fetch(`${BASE}sim/${file}`)
      .then((r) => r.json())
      .then((d: SimScene) => {
        setScene(d);
        setMode('settle');
        setT(0);
        setPlaying(true);
        setView('orbit');
        setSelected(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [file]);

  const frames = scene ? (mode === 'settle' ? scene.settle : scene.rollouts[mode].frames) : [];
  const duration = frames.length ? frames[frames.length - 1].t : 0;
  useEffect(() => {
    if (!playing || !duration) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      setT((x) => {
        const n = x + ((now - last) / 1000) * 0.6; // 0.6x real time so the motion can be followed
        if (n >= duration) {
          setPlaying(false);
          return duration;
        }
        return n;
      });
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  const poses = useMemo(() => interp(frames, t), [frames, t]);
  const rollout = scene && mode !== 'settle' ? scene.rollouts[mode] : null;
  const moved = useMemo(() => new Set(rollout && t > 0.15 ? Object.entries(rollout.displacement_cm).filter(([, cm]) => cm > MOVED_CM).map(([n]) => n) : []), [rollout, t]);
  const play = (m: 'settle' | number) => {
    setMode(m);
    setT(0);
    setPlaying(true);
  };

  if (error) return <Empty title="No recorded physics scenes">{error}</Empty>;
  if (!index || !scene) return <div className="grid h-full place-items-center text-[13px] text-muted" role="status">Loading recorded MuJoCo scenes…</div>;
  const eyeAgent = scene.agents.find((a) => a.name === view);
  const stacked = Object.entries(scene.support).filter(([, s]) => s.some((x) => x !== 'table' && x !== 'floor'));

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto lg:grid-cols-[230px_minmax(0,1fr)_360px] lg:content-stretch lg:overflow-hidden" data-testid="physics-lab">
      <aside className="panel flex flex-col gap-2 p-3 lg:min-h-0 lg:overflow-y-auto" aria-label="Recorded scenes">
        <p className="px-1 text-[12.5px] leading-relaxed text-muted">
          Scenes simulated in <span className="text-ink">{index.simulator}</span>. Objects are dropped, settle under gravity, and are then removed one at a time.
        </p>
        {index.scenes.map((s, i) => (
          <button key={s.file} onClick={() => setFile(s.file)} aria-pressed={file === s.file} className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${file === s.file ? 'border-indigo bg-indigo/10' : 'border-night-600 bg-night-900/60 hover:border-night-500'}`}>
            <span className="block text-[13.5px] font-bold text-ink">Scene {i + 1}</span>
            <span className="block text-[12px] text-muted">{s.objects} objects, {s.stacked} stacked, {s.agents === 1 ? 'one robot' : `${s.agents} robots`}</span>
            <span className="num block text-[11px] text-dim">#{s.fingerprint}</span>
          </button>
        ))}
      </aside>

      <div className="flex flex-col gap-3 lg:min-h-0">
        <div className="panel relative h-[60vh] min-h-[360px] overflow-hidden lg:h-auto lg:flex-1" data-testid="physics-viewport">
          <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0.5, 2.1, 3.1], fov: 40, near: 0.02, far: 60 }} onPointerMissed={() => setSelected(null)}>
            <SceneView scene={scene} poses={poses} removed={rollout?.removed ?? null} moved={moved} showSupport={showSupport && mode === 'settle' && t >= duration} eyeAgent={eyeAgent} selected={selected} />
          </Canvas>
          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
            <Segmented size="sm" label="Camera" value={view} onChange={setView} options={[{ value: 'orbit', label: 'Orbit' }, ...scene.agents.map((a) => ({ value: a.name, label: `${a.name}’s eyes` }))]} />
            <label className="chip cursor-pointer select-none bg-night-900/80">
              <input type="checkbox" className="accent-indigo" checked={showSupport} onChange={(e) => setShowSupport(e.target.checked)} />
              Support graph
            </label>
          </div>
          {eyeAgent && <p className="absolute bottom-3 left-3 max-w-xs rounded-lg border hairline bg-night-900/85 px-3 py-2 text-[12px] text-muted">The exact head-camera pose of the {eyeAgent.name} in the simulator: this is the view used for the imagery experiment.</p>}
        </div>
        <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
          <button className="btn btn-primary" onClick={() => (t >= duration ? play(mode) : setPlaying(!playing))} data-testid="physics-play">{playing ? 'Pause' : t >= duration ? 'Replay' : 'Play'}</button>
          <span className="text-[12.5px] font-semibold text-ink">{rollout ? `What if the ${rollout.removed} were removed?` : 'Objects dropped and settling'}</span>
          <input aria-label="Simulation time" className="slider min-w-[160px] flex-1" type="range" min={0} max={duration} step={0.005} value={Math.min(t, duration)} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} />
          <span className="num text-[12px] text-muted">{t.toFixed(2)} / {duration.toFixed(2)} s</span>
        </div>
      </div>

      <aside className="panel flex flex-col lg:min-h-0 lg:overflow-y-auto" aria-label="Physics questions">
        <section className="border-b hairline p-4">
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold text-ink">
            What if… <Info align="end" text="Each button replays a real MuJoCo rollout: the object is taken out of the world and the simulation runs for 1.5 s. Objects that move more than 3 cm turn pink. These rollouts are the ground truth for the counterfactual questions." />
          </h3>
          <div className="grid gap-1.5">
            <button className={`btn justify-start ${mode === 'settle' ? 'border-indigo' : ''}`} onClick={() => play('settle')}>Drop and settle</button>
            {scene.rollouts.map((r, i) => {
              const hits = Object.entries(r.displacement_cm).filter(([, cm]) => cm > MOVED_CM).sort((a, b) => b[1] - a[1]);
              return (
                <button key={r.removed} className={`rounded-lg border px-3 py-2 text-left text-[12.5px] ${mode === i ? 'border-rose/70 bg-rose/10' : 'border-night-600 hover:border-night-500'}`} onClick={() => play(i)} data-testid="rollout-button">
                  <span className="block font-semibold text-ink">Remove the {r.removed}</span>
                  <span className="block text-muted">{hits.length ? hits.map(([n, cm]) => `${n} moves ${cm.toFixed(1)} cm`).join(', ') : 'nothing else moves more than 3 cm'}</span>
                </button>
              );
            })}
          </div>
        </section>
        <section className="border-b hairline p-4">
          <h3 className="mb-2 text-[13px] font-bold text-ink">Support from contact forces</h3>
          {stacked.length === 0 ? <p className="text-[12.5px] text-muted">Every object rests on the table.</p> : (
            <ul className="space-y-1 text-[12.5px]">
              {stacked.map(([top, sups]) => (
                <li key={top}><button className="text-left text-ink hover:text-viewer" onClick={() => setSelected(top)}>{top}</button> <span className="text-muted">rests on</span> <span className="text-ink">{sups.join(' and ')}</span></li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11.5px] text-dim">A rests on B when B’s normal contact force on A is at least 20% of A’s weight.</p>
        </section>
        <section className="p-4" data-testid="physics-questions">
          <h3 className="mb-2 text-[13px] font-bold text-ink">Questions with simulator ground truth</h3>
          <ul className="space-y-2.5">
            {scene.questions.map((qq, i) => (
              <li key={i} className="rounded-lg border hairline bg-night-900/60 p-2.5 text-[12.5px]">
                <span className="chip mb-1">{TASK_LABEL[qq.task] ?? qq.task}</span>
                <p className="leading-snug text-ink">{qq.question}</p>
                <p className="mt-1 text-muted">Answer <span className="font-bold capitalize text-ink">{qq.answer}</span></p>
                <p className="num mt-0.5 text-[11px] leading-snug text-dim">{qq.explanation}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-dim">Recorded by research/scripts/export_sim_scenes.py from {scene.simulator}. The browser replays the recording; it does not simulate or label. <Kbd>P</Kbd> opens this workspace.</p>
        </section>
      </aside>
    </div>
  );
}
