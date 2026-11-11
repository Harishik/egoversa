import { useEffect, useMemo, useRef } from 'react';
import { cameraFrame, cameraMetrics } from '../../geometry/camera';
import { getColliders } from '../../geometry/raycast';
import { computeVisibility } from '../../geometry/visibility';
import { downloadText } from '../../evaluation/export';
import { ENV_IDS, ENVIRONMENTS } from '../../scenes/environments';
import { OBJECT_COUNT_MAX, OBJECT_COUNT_MIN } from '../../scenes/generate';
import { buildScenario, LIGHTING_IDS, parseScenario } from '../../scenes/scenario';
import { useStudio } from '../../store/useStudio';
import { LIGHTING_LABELS } from '../three/SceneContents';
import { ViewerCanvas } from '../three/ViewerCanvas';
import { WorldCanvas } from '../three/WorldCanvas';
import { FrameTag, Info, Kbd, Section, Segmented, Slider, Tip } from '../ui/controls';

const PRESETS: { label: string; az: number; h?: 'low' | 'high' }[] = [
  { label: 'Front', az: 0 },
  { label: 'Right', az: 90 },
  { label: 'Back', az: 180 },
  { label: 'Left', az: -90 },
  { label: 'High', az: 35, h: 'high' },
  { label: 'Low', az: -35, h: 'low' },
];

function Hero() {
  const setHeroSeen = useStudio((s) => s.setHeroSeen);
  const setDemoStep = useStudio((s) => s.setDemoStep);
  return (
    <div className="absolute inset-0 z-40 flex items-center bg-gradient-to-r from-night-950 from-30% via-night-950/85 via-55% to-transparent">
      <div className="max-w-xl animate-rise px-8 py-10 sm:px-14">
        <h1 className="font-display text-[clamp(2.8rem,6.2vw,5.4rem)] leading-[0.95] tracking-tight text-ink">
          <span className="text-world">Same world.</span>
          <br />
          <span className="text-viewer">Different eyes.</span>
        </h1>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
          The scene behind this text never changes. The cyan camera orbiting it does, and with it the answer to
          “is the mug left of the book?”. EGOVERSA generates those questions with geometric ground truth and
          measures which shortcuts break when the viewpoint moves.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button className="btn btn-primary px-5 py-2.5 text-[14px]" onClick={() => { setHeroSeen(true); setDemoStep(0); }}>
            Take the guided tour
          </button>
          <button className="btn px-5 py-2.5 text-[14px]" onClick={() => setHeroSeen(true)}>
            Open the lab
          </button>
        </div>
        <p className="mt-6 text-[12.5px] text-dim">Runs entirely in this browser. No account, no model, no data leaves the page.</p>
      </div>
    </div>
  );
}

function ObjectTable() {
  const scene = useStudio((s) => s.scene);
  const viewer = useStudio((s) => s.viewer);
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  const rows = useMemo(() => {
    const frame = cameraFrame(viewer, scene.focus);
    const vis = computeVisibility(scene, getColliders(scene), frame);
    return scene.objects.map((o) => ({ o, m: cameraMetrics(frame, o.center), v: vis.get(o.id)! }));
  }, [scene, viewer]);
  const f = (v: number) => (Object.is(Number(v.toFixed(2)), -0) ? 0 : v).toFixed(2);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px]">
        <caption className="sr-only">Object reference points in the world frame and in the viewer camera frame</caption>
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1.5 pl-4 pr-2 font-semibold">Object</th>
            <th className="px-2 font-semibold" colSpan={3}><FrameTag frame="world">World frame (m), fixed</FrameTag></th>
            <th className="px-2 font-semibold" colSpan={3}><FrameTag frame="viewer">Camera frame (m), moves with the viewer</FrameTag></th>
            <th className="px-2 font-semibold">Bearing θ</th>
            <th className="px-2 pr-4 font-semibold">
              <span className="inline-flex items-center gap-1.5">Unoccluded <Info align="end" text="Fraction of the object's in-frame silhouette that camera rays reach before hitting anything else. Opaque geometry only." /></span>
            </th>
          </tr>
          <tr className="num text-[11px] text-dim">
            <th />
            <th className="px-2 text-right font-medium">X_w</th><th className="px-2 text-right font-medium">Y_w</th><th className="px-2 text-right font-medium">Z_w</th>
            <th className="px-2 text-right font-medium">x_c</th><th className="px-2 text-right font-medium">y_c</th><th className="px-2 text-right font-medium">depth −z_c</th>
            <th /><th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ o, m, v }) => (
            <tr key={o.id} onClick={() => select(o.id === selectedId ? null : o.id)} className={`cursor-pointer border-t hairline ${o.id === selectedId ? 'bg-viewer/10' : 'hover:bg-night-800/60'}`}>
              <th scope="row" className="py-1.5 pl-4 pr-2 text-left font-semibold text-ink">
                <button className="text-left" aria-pressed={o.id === selectedId} onClick={(e) => { e.stopPropagation(); select(o.id === selectedId ? null : o.id); }}>
                  {o.name}
                </button>
                {o.isOccluder && <span className="ml-2 text-[11px] font-medium text-dim">occluder</span>}
                {o.isDistractor && <span className="ml-2 text-[11px] font-medium text-dim">look-alike</span>}
                {o.front && <span className="ml-2 text-[11px] font-medium text-indigo" title="Has a defined facing direction; can be the observer of a question">{o.isAgent ? 'agent' : 'has a front'}</span>}
              </th>
              {o.center.map((c, i) => <td key={i} className="num px-2 text-right text-world">{f(c)}</td>)}
              <td className="num px-2 text-right text-viewer">{f(m.xc)}</td>
              <td className="num px-2 text-right text-viewer">{f(m.yc)}</td>
              <td className="num px-2 text-right text-viewer">{f(m.depth)}</td>
              <td className="num px-2 text-right text-ink">{m.azimuthDeg.toFixed(1)}°</td>
              <td className="px-2 pr-4">
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-night-700"><span className="block h-full rounded-full bg-indigo" style={{ width: `${v.visibleFraction * 100}%` }} /></span>
                  <span className="num text-ink">{v.determinable ? `${Math.round(v.visibleFraction * 100)}%` : 'n/a'}</span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ControlPanel() {
  const s = useStudio();
  const { scene, spec, viewer } = s;
  const fileRef = useRef<HTMLInputElement>(null);
  const exportScenario = () => {
    const sc = buildScenario(scene, viewer, s.lighting, s.toleranceScale);
    downloadText(`egoversa-${spec.env}-${spec.seed}.scenario.json`, JSON.stringify(sc, null, 2), 'application/json');
    s.notify('Scenario JSON downloaded');
  };
  const importScenario = async (file: File | undefined) => {
    if (!file) return;
    const res = parseScenario(await file.text());
    if (!res.ok) return s.notify(`Import failed: ${res.error}`, 'warn');
    s.loadScenario(res.scenario);
    s.notify(res.fingerprintMatches ? `Loaded “${res.scenario.name}”. Fingerprint ${res.scene.fingerprint} reproduced exactly.` : 'Loaded, but the regenerated scene does not match the stored fingerprint (different engine version?).', res.fingerprintMatches ? 'ok' : 'warn');
  };
  const copySeed = async () => {
    try {
      await navigator.clipboard.writeText(spec.seed);
      s.notify('Seed copied');
    } catch {
      s.notify('Clipboard is not available here', 'warn');
    }
  };
  const lim = scene.limits;
  return (
    <aside className="panel flex flex-col lg:min-h-0 lg:overflow-y-auto" aria-label="Scene controls">
      <Section title="Environment" hint="Three procedural worlds built in code from opaque primitives. No external assets.">
        <div className="grid gap-2">
          {ENV_IDS.map((id) => {
            const e = ENVIRONMENTS[id];
            const on = spec.env === id;
            return (
              <button key={id} type="button" aria-pressed={on} onClick={() => s.setEnv(id)} className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${on ? 'border-indigo bg-indigo/10' : 'border-night-600 bg-night-900/60 hover:border-night-500'}`}>
                <span className="block text-[13.5px] font-bold text-ink">{e.label}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-muted">{e.blurb}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Seed" hint="The seed and the four sliders below fully determine every object, colour and transform. Same inputs, same world, on any machine.">
        <div className="flex gap-2">
          <input aria-label="Scenario seed" className="field num" value={spec.seed} spellCheck={false} onChange={(e) => s.updateSpec({ seed: e.target.value })} />
          <Tip text="Draw a new random seed (N)"><button className="btn" onClick={s.newSeed} aria-label="New random seed">New</button></Tip>
          <Tip text="Copy the seed" align="end"><button className="btn" onClick={copySeed} aria-label="Copy seed">Copy</button></Tip>
        </div>
        <p className="mt-2 text-[12px] text-dim">Scene fingerprint <span className="num text-muted" data-testid="fingerprint">{scene.fingerprint}</span></p>
      </Section>

      <Section title="Scene">
        <Slider label="Objects" value={spec.objectCount} min={OBJECT_COUNT_MIN} max={OBJECT_COUNT_MAX} step={1} onChange={(v) => s.updateSpec({ objectCount: v })} />
        <Slider label="Occlusion" value={spec.occlusion} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => s.updateSpec({ occlusion: v })} hint="Adds up to three tall occluders and makes small objects huddle next to them, so more viewpoints hide something." />
        <Slider label="Look-alike distractors" value={spec.distractors} min={0} max={3} step={1} onChange={(v) => s.updateSpec({ distractors: v })} hint="Extra objects that share a noun with another object and differ only in colour (red mug vs. blue mug). Names stay unique." />
        <Slider label="Agents (robots)" value={spec.agents ?? 0} min={0} max={2} step={1} onChange={(v) => s.updateSpec({ agents: v })} hint="Robots with a visible face. They are the reference viewers for observer-frame questions (“imagine you are the robot”). Adding them leaves the other objects exactly where they were." />
        <Slider label="Pose noise" value={spec.jitter} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => s.updateSpec({ jitter: v })} hint="Random yaw applied to each object. At 0% everything is axis-aligned." />
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[12.5px] font-medium text-muted">Lighting</span>
          <Info align="start" text="Affects only the rendered image (relevant to a vision model). Geometry and ground truth are unchanged." />
          <span className="ml-auto"><Segmented size="sm" label="Lighting" value={s.lighting} onChange={s.setLighting} options={LIGHTING_IDS.map((l) => ({ value: l, label: LIGHTING_LABELS[l] }))} /></span>
        </div>
      </Section>

      <Section title="Viewer camera" hint="The embodied observer every question refers to. It orbits the scene focus, always upright (roll = 0), with a 50° vertical field of view.">
        <Slider color="#5CE1E6" label="Azimuth" value={Math.round(viewer.azimuthDeg)} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => s.setViewer({ azimuthDeg: v })} hint="Orbit angle about the world up axis. 0° is the canonical front view, where the camera's x axis equals world X." />
        <Slider color="#5CE1E6" label="Eye height" value={Number(viewer.height.toFixed(2))} min={lim.minHeight} max={lim.maxHeight} step={0.05} format={(v) => `${v.toFixed(2)} m`} onChange={(v) => s.setViewer({ height: v })} />
        <Slider color="#5CE1E6" label="Distance" value={Number(viewer.distance.toFixed(2))} min={lim.minDistance} max={lim.maxDistance} step={0.05} format={(v) => `${v.toFixed(2)} m`} onChange={(v) => s.setViewer({ distance: v })} />
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} className="btn px-2" onClick={() => s.animateViewer({ azimuthDeg: p.az, height: p.h === 'high' ? lim.maxHeight * 0.85 : p.h === 'low' ? lim.minHeight : scene.defaultViewer.height, distance: scene.defaultViewer.distance })}>
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Scenario" hint="A scenario is a seed plus a viewpoint. Saved scenarios live in this browser's local storage; JSON files can be shared and re-imported.">
        <div className="grid grid-cols-3 gap-1.5">
          <button className="btn btn-primary px-2" onClick={s.saveScenario}>Save</button>
          <button className="btn px-2" onClick={exportScenario}>Export</button>
          <button className="btn px-2" onClick={() => fileRef.current?.click()}>Import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Import scenario JSON" onChange={(e) => { void importScenario(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {s.saved.length === 0 ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-dim">No saved scenarios yet. Find a viewpoint worth keeping and press Save.</p>
        ) : (
          <ul className="mt-3 space-y-1">
            {s.saved.map((sc, i) => (
              <li key={`${sc.savedAt}-${i}`} className="flex items-center gap-1 rounded-lg border hairline bg-night-900/60 pl-2.5">
                <button className="min-w-0 flex-1 truncate py-1.5 text-left text-[12.5px] font-medium text-ink hover:text-viewer" onClick={() => { s.loadScenario(sc); s.notify(`Loaded “${sc.name}”`); }} title="Load this scenario">
                  {sc.name}
                </button>
                <button className="btn btn-ghost px-2 py-1" aria-label={`Delete ${sc.name}`} onClick={() => s.deleteSaved(i)}>×</button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}

export function SceneLab() {
  const scene = useStudio((s) => s.scene);
  const viewer = useStudio((s) => s.viewer);
  const lighting = useStudio((s) => s.lighting);
  const viewMode = useStudio((s) => s.viewMode);
  const setViewMode = useStudio((s) => s.setViewMode);
  const selectedId = useStudio((s) => s.selectedId);
  const select = useStudio((s) => s.select);
  const showLabels = useStudio((s) => s.showLabels);
  const setShowLabels = useStudio((s) => s.setShowLabels);
  const heroSeen = useStudio((s) => s.heroSeen);
  const nudge = useStudio((s) => s.nudgeAzimuth);

  // Hero: slowly orbit the viewer so the inset image changes while the world stays put.
  useEffect(() => {
    if (heroSeen) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      nudge(((now - last) / 1000) * 14);
      last = now;
    }, 33);
    return () => window.clearInterval(id);
  }, [heroSeen, nudge]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto lg:content-stretch lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
      <div className="flex flex-col gap-3 lg:min-h-0">
        <div className="panel relative h-[62vh] min-h-[380px] shrink-0 overflow-hidden lg:h-auto lg:flex-1 lg:shrink" data-testid="viewport">
          <WorldCanvas scene={scene} viewer={viewer} lighting={lighting} mode={viewMode} selectedId={selectedId} showLabels={showLabels && heroSeen} onSelect={select} />
          {!heroSeen && <Hero />}

          <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
            <Segmented label="Viewpoint" value={viewMode} onChange={setViewMode} options={[{ value: 'world', label: 'World view', title: 'Orbit the scene from outside (V)' }, { value: 'viewer', label: 'Viewer’s eyes', title: 'Fly into the viewer camera (V)' }]} />
            <label className="chip cursor-pointer select-none bg-night-900/80">
              <input type="checkbox" className="accent-indigo" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
              Object names
            </label>
          </div>

          <div className="pointer-events-none absolute right-3 top-3 z-10 hidden rounded-xl border hairline bg-night-900/80 px-3 py-2 text-[12px] leading-relaxed backdrop-blur md:block">
            <p><FrameTag frame="world">World axes stay fixed to the scene</FrameTag></p>
            <p><FrameTag frame="viewer">Camera axes travel with the viewer</FrameTag></p>
            <p className="mt-1 text-dim"><Kbd>←</Kbd> <Kbd>→</Kbd> orbit viewer, <Kbd>↑</Kbd> <Kbd>↓</Kbd> height, <Kbd>V</Kbd> swap view</p>
          </div>

          <figure className="absolute bottom-3 right-3 z-50 w-[min(42%,300px)] overflow-hidden rounded-xl border border-viewer/50 bg-night-900 shadow-2xl">
            <ViewerCanvas scene={scene} viewer={viewer} lighting={lighting} label="What the viewer camera sees" />
            <figcaption className="flex items-center justify-between gap-2 border-t border-viewer/30 px-2.5 py-1.5 text-[11.5px]">
              <span className="font-semibold text-viewer">Viewer camera</span>
              <span className="num text-muted" data-testid="pose-readout">az {Math.round(viewer.azimuthDeg)}°, h {viewer.height.toFixed(2)} m, d {viewer.distance.toFixed(2)} m</span>
            </figcaption>
          </figure>

          {viewMode === 'viewer' && heroSeen && (
            <p className="absolute bottom-3 left-3 z-10 max-w-xs rounded-lg border hairline bg-night-900/85 px-3 py-2 text-[12px] text-muted">
              You are looking through the viewer camera. The scored frame is the 4:3 inset; this wide view is for orientation.
            </p>
          )}
        </div>

        <div className="panel min-h-[120px] shrink-0 overflow-y-auto py-2 lg:max-h-[34%] lg:shrink">
          <ObjectTable />
        </div>
      </div>
      <ControlPanel />
    </div>
  );
}
