import { useEffect, useMemo, useRef, useState } from 'react';
import { runBatch, summarize, type BatchConfig, type EvalItem, type RelationKey } from '../../evaluation/evaluator';
import { downloadText, pct, toCSV, toJSON, toMarkdownReport } from '../../evaluation/export';
import { REASONER_BY_ID, REASONERS, type ReasonerId } from '../../evaluation/reasoners';
import { ENV_IDS, ENVIRONMENTS } from '../../scenes/environments';
import { generateScene } from '../../scenes/generate';
import type { Scene } from '../../scenes/types';
import { RELATION_INFO, RELATIONS, type Relation } from '../../tasks/types';
import { useStudio } from '../../store/useStudio';
import { AccuracyTable, Composition, ConfusionMatrix, ShiftChart, ThetaChart } from '../charts/charts';
import { A_COLOR, B_COLOR, TopDownMap } from '../charts/TopDownMap';
import { ViewerCanvas } from '../three/ViewerCanvas';
import { Empty, Info, Section, Segmented, Slider } from '../ui/controls';

const SHIFT_CHOICES = [0, 30, 60, 90, 120, 150, 180];
const sceneCache = new Map<string, Scene>();
function sceneFor(item: EvalItem): Scene {
  const key = JSON.stringify(item.spec);
  let s = sceneCache.get(key);
  if (!s) {
    if (sceneCache.size > 300) sceneCache.clear();
    sceneCache.set(key, (s = generateScene(item.spec)));
  }
  return s;
}
const objectIds = (item: EvalItem) => {
  const [, a, b] = item.qid.split(':');
  return { a, b };
};

function ConfigPanel({ running, progress, onRun, onCancel }: { running: boolean; progress: number; onRun: () => void; onCancel: () => void }) {
  const c = useStudio((s) => s.batchConfig);
  const set = useStudio((s) => s.setBatchConfig);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const views = c.envs.length * c.scenariosPerEnv * c.shiftsDeg.length;
  return (
    <aside className="panel flex flex-col lg:min-h-0 lg:overflow-y-auto" aria-label="Benchmark configuration">
      <Section title="Batch" hint="A batch is fully determined by this panel. The same settings reproduce the same numbers in the browser and in `npm run benchmark`.">
        <label className="block text-[12.5px]">
          <span className="mb-1 block font-medium text-muted">Base seed</span>
          <input className="field num" value={c.baseSeed} spellCheck={false} onChange={(e) => set({ baseSeed: e.target.value || 'seed' })} />
        </label>
        <fieldset className="mt-3">
          <legend className="mb-1.5 text-[12.5px] font-medium text-muted">Environments</legend>
          <div className="flex flex-wrap gap-1.5">
            {ENV_IDS.map((e) => (
              <button key={e} type="button" aria-pressed={c.envs.includes(e)} onClick={() => set({ envs: ENV_IDS.filter((x) => toggle(c.envs, e).includes(x)) })} className={`rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold ${c.envs.includes(e) ? 'border-indigo bg-indigo/15 text-ink' : 'border-night-600 text-dim hover:text-ink'}`}>
                {ENVIRONMENTS[e].label}
              </button>
            ))}
          </div>
        </fieldset>
        <Slider label="Scenarios per environment" value={c.scenariosPerEnv} min={2} max={60} step={1} onChange={(v) => set({ scenariosPerEnv: v })} />
        <fieldset className="mt-2">
          <legend className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-muted">Viewpoint shifts <Info align="start" text="Each scenario is viewed at every selected azimuth offset from the canonical front view. The direction (left or right) is drawn from the seed." /></legend>
          <div className="flex flex-wrap gap-1.5">
            {SHIFT_CHOICES.map((sh) => (
              <button key={sh} type="button" aria-pressed={c.shiftsDeg.includes(sh)} onClick={() => set({ shiftsDeg: toggle(c.shiftsDeg, sh).sort((a, b) => a - b) })} className={`num rounded-lg border px-2 py-1 text-[12px] font-semibold ${c.shiftsDeg.includes(sh) ? 'border-viewer/70 bg-viewer/10 text-ink' : 'border-night-600 text-dim hover:text-ink'}`}>
                {sh}°
              </button>
            ))}
          </div>
        </fieldset>
      </Section>
      <Section title="Difficulty">
        <Slider label="Objects per scene" value={c.objectCount} min={5} max={10} step={1} onChange={(v) => set({ objectCount: v })} />
        <Slider label="Occlusion" value={c.occlusion} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ occlusion: v })} hint="Scene-generation knob. The occlusion rate actually measured in the batch is reported in the results." />
        <Slider label="Ambiguity tolerance" value={c.toleranceScale} min={0.5} max={2.5} step={0.25} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => set({ toleranceScale: v })} hint="Scales every tie band. The share of candidates actually excluded as ambiguous is measured and shown under Dataset composition." />
        <Slider label="Look-alike distractors" value={c.distractors} min={0} max={3} step={1} onChange={(v) => set({ distractors: v })} />
        <Slider label="Agents per scene" value={c.agents ?? 0} min={0} max={2} step={1} onChange={(v) => set({ agents: v })} hint="Robots with a visible facing direction. They make observer-frame questions (left of the robot, in front of the robot) and the facing task possible." />
        <Slider label="Camera perturbation" value={c.poseJitter} min={0} max={0.4} step={0.05} format={(v) => `±${Math.round(v * 100)}%`} onChange={(v) => set({ poseJitter: v })} hint="Seeded jitter of eye height and distance per view, as a fraction of the allowed range." />
        <Slider label="Questions per relation and view" value={c.perRelation} min={1} max={12} step={1} onChange={(v) => set({ perRelation: v })} />
      </Section>
      <div className="mt-auto rounded-b-2xl border-t hairline bg-night-850 p-4 lg:sticky lg:bottom-0">
        {running ? (
          <>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-night-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Benchmark progress">
              <div className="h-full rounded-full bg-indigo transition-[width]" style={{ width: `${progress * 100}%` }} />
            </div>
            <button className="btn w-full" onClick={onCancel}>Cancel ({Math.round(progress * 100)}%)</button>
          </>
        ) : (
          <button className="btn btn-primary w-full py-2.5 text-[14px]" onClick={onRun} disabled={!c.envs.length || !c.shiftsDeg.length} data-testid="run-benchmark">
            Run benchmark
          </button>
        )}
        <p className="num mt-2 text-center text-[11.5px] text-dim">{views} views, up to {views * c.perRelation * 4} questions</p>
      </div>
    </aside>
  );
}

function Playback({ items, index, onIndex, onClose }: { items: EvalItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const item = items[index];
  const loadScenario = useStudio((s) => s.loadScenario);
  const setWorkspace = useStudio((s) => s.setWorkspace);
  const lighting = useStudio((s) => s.lighting);
  const [annotate, setAnnotate] = useState(true);
  const scene = useMemo(() => sceneFor(item), [item]);
  const { a, b } = objectIds(item);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') { e.stopPropagation(); onIndex(Math.min(items.length - 1, index + 1)); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); onIndex(Math.max(0, index - 1)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, items.length, onClose, onIndex]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-night-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Question playback" data-testid="playback">
      <div className="panel flex max-h-full w-full max-w-5xl flex-col overflow-hidden bg-night-850">
        <header className="flex items-center gap-3 border-b hairline px-5 py-3">
          <h3 className="text-[14px] font-bold text-ink">Playback</h3>
          <span className="num text-[12.5px] text-muted">{index + 1} / {items.length}</span>
          <span className="chip">{ENVIRONMENTS[item.env].label}</span>
          <span className="chip num">seed {item.spec.seed}</span>
          <span className="chip num">{item.shiftDeg}° shift</span>
          <div className="ml-auto flex gap-1.5">
            <button className="btn" onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0} aria-label="Previous item">←</button>
            <button className="btn" onClick={() => onIndex(Math.min(items.length - 1, index + 1))} disabled={index === items.length - 1} aria-label="Next item">→</button>
            <button ref={closeRef} className="btn" onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="grid gap-5 overflow-y-auto p-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <div className="overflow-hidden rounded-xl border hairline">
              <ViewerCanvas key={item.idx} scene={scene} viewer={item.viewer} lighting={lighting}
                outlines={annotate ? { [a]: A_COLOR, ...(b ? { [b]: B_COLOR } : {}) } : undefined}
                tags={annotate ? { [a]: { text: item.aName, color: A_COLOR }, ...(b && item.bName ? { [b]: { text: item.bName, color: B_COLOR } } : {}) } : undefined}
                label="Viewer image for this benchmark item" />
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
              <input type="checkbox" className="accent-indigo" checked={annotate} onChange={(e) => setAnnotate(e.target.checked)} />
              Outline the two objects (annotations are never part of a model’s input)
            </label>
          </div>
          <div className="space-y-4 text-[13px]">
            <p className="font-display text-[1.45rem] leading-snug text-ink">{item.text}</p>
            <div className="rounded-xl border border-night-500 bg-night-900 p-3">
              <p className="text-[12.5px] font-bold text-ink">Geometric ground truth: <span className="capitalize">{item.gold}</span></p>
              <p className="num mt-1 text-[12px] leading-relaxed text-muted">{item.note}</p>
            </div>
            <ul className="divide-y divide-night-700 rounded-xl border hairline">
              {REASONERS.filter((r) => r.kind !== 'reference').map((r) => {
                const ok = item.preds[r.id] === item.gold;
                return (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                    <span className="font-semibold text-ink">{r.name}</span>
                    <span className="ml-auto capitalize text-ink">{item.preds[r.id]}</span>
                    <span className={`w-5 text-right font-bold ${ok ? 'text-mint' : 'text-rose'}`} aria-label={ok ? 'correct' : 'wrong'}>{ok ? '✓' : '✗'}</span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-start gap-4">
              <TopDownMap scene={scene} viewer={item.viewer} a={a} b={b} size={170} showLabels />
              <div className="space-y-2">
                <p className="text-[12px] leading-relaxed text-muted">Plan view with the camera at azimuth <span className="num text-ink">{Math.round(item.viewer.azimuthDeg)}°</span>.</p>
                <button className="btn" onClick={() => { loadScenario({ spec: item.spec, viewer: item.viewer }); setWorkspace('lab'); onClose(); }}>Open in Scene Lab</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Benchmark() {
  const config = useStudio((s) => s.batchConfig);
  const result = useStudio((s) => s.batchResult);
  const setResult = useStudio((s) => s.setBatchResult);
  const notify = useStudio((s) => s.notify);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef(false);

  const [relation, setRelation] = useState<RelationKey>('all');
  const [thetaRel, setThetaRel] = useState<'obs_lateral' | 'obs_frontback'>('obs_lateral');
  const [confReasoner, setConfReasoner] = useState<ReasonerId>('world');
  const [failReasoner, setFailReasoner] = useState<ReasonerId>('world');
  const [failRelation, setFailRelation] = useState<RelationKey>('all');
  const [failShift, setFailShift] = useState<number | 'all'>('all');
  const [shown, setShown] = useState(12);
  const [playback, setPlayback] = useState<number | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setProgress(0);
    cancel.current = false;
    try {
      const snapshot: BatchConfig = JSON.parse(JSON.stringify(config));
      const r = await runBatch(snapshot, (p) => setProgress(p.done / p.total), () => cancel.current);
      setResult(r);
      setShown(12);
      notify(`Benchmark finished: ${r.items.length} scored questions in ${(r.durationMs / 1000).toFixed(1)} s`);
    } catch (e) {
      if ((e as Error).message !== 'cancelled') setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const summary = useMemo(() => (result ? summarize(result) : null), [result]);
  const failures = useMemo(() => {
    if (!result) return [];
    return result.items.filter((it) => it.preds[failReasoner] !== it.gold && (failRelation === 'all' || it.relation === failRelation) && (failShift === 'all' || it.shiftDeg === failShift));
  }, [result, failReasoner, failRelation, failShift]);
  useEffect(() => setShown(12), [failReasoner, failRelation, failShift]);

  const stale = result && JSON.stringify(result.config) !== JSON.stringify(config);
  const stamp = result ? result.config.baseSeed.replace(/[^\w-]+/g, '_') : '';
  const visStats = summary?.goldCounts.visibility;
  const occRate = visStats ? (visStats.occluded ?? 0) / Math.max(1, (visStats.occluded ?? 0) + (visStats.visible ?? 0)) : 0;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto lg:content-stretch lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden">
      <ConfigPanel running={running} progress={progress} onRun={run} onCancel={() => (cancel.current = true)} />
      <div className="space-y-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1" aria-busy={running}>
        {error && <p role="alert" className="panel border-rose/50 px-4 py-3 text-[13px] text-rose">The benchmark could not run: {error}</p>}
        {!result || !summary ? (
          <Empty title={running ? 'Measuring…' : 'No measurements yet'} action={!running && <button className="btn btn-primary" onClick={run}>Run benchmark</button>}>
            {running
              ? `Generating scenes, casting rays and scoring every reasoner. ${Math.round(progress * 100)}% done.`
              : 'Results are computed on demand from generated scenes. Nothing on this page is precomputed or hard-coded. A default run takes a second or two.'}
          </Empty>
        ) : (
          <>
            <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-[12.5px] text-muted" data-testid="bench-summary">
              <p><span className="num text-[15px] font-bold text-ink" data-testid="bench-items">{summary.nItems}</span> scored questions</p>
              <p><span className="num text-[15px] font-bold text-ink">{summary.nViews}</span> views</p>
              <p><span className="num text-[15px] font-bold text-ink">{(100 * occRate).toFixed(1)}%</span> of visibility items are occluded</p>
              <p><span className="num text-[15px] font-bold text-ink">{(result.durationMs / 1000).toFixed(1)} s</span> compute</p>
              <span className="ml-auto flex flex-wrap gap-1.5">
                <button className="btn" onClick={() => downloadText(`egoversa-eval-${stamp}.csv`, toCSV(result), 'text/csv')}>Export CSV</button>
                <button className="btn" onClick={() => downloadText(`egoversa-eval-${stamp}.json`, toJSON(result), 'application/json')}>Export JSON</button>
                <button className="btn" onClick={() => downloadText(`egoversa-report-${stamp}.md`, toMarkdownReport(result), 'text/markdown')}>Export report</button>
              </span>
            </div>

            <p className="rounded-xl border border-world/30 bg-world/5 px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
              <span className="font-bold text-world">What these numbers are.</span> A geometric reference oracle, two hand-written heuristics and a seeded coin flip, scored on generated scenes.
              No vision-language model is connected, so nothing here is evidence about any learned model.
              {stale && <span className="ml-1 font-semibold text-ink">The settings changed since this run; press Run benchmark to update.</span>}
            </p>

            <section className="panel p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h3 className="text-[15px] font-bold text-ink">Accuracy by viewpoint shift</h3>
                <select aria-label="Relation" className="field ml-auto w-auto py-1" value={relation} onChange={(e) => setRelation(e.target.value as RelationKey)}>
                  <option value="all">All relations</option>
                  {RELATIONS.map((r) => <option key={r} value={r}>{RELATION_INFO[r].title}</option>)}
                </select>
              </div>
              <ShiftChart summary={summary} relation={relation} />
            </section>

            <section className="panel p-5" data-testid="theta-section">
              <div className="mb-1 flex flex-wrap items-center gap-3">
                <h3 className="text-[15px] font-bold text-ink">Perspective taking: accuracy by observer heading offset θ</h3>
                <span className="ml-auto"><Segmented size="sm" label="Observer relation" value={thetaRel} onChange={setThetaRel} options={[{ value: 'obs_lateral', label: 'Left / right' }, { value: 'obs_frontback', label: 'Front / behind' }]} /></span>
              </div>
              <p className="mb-3 max-w-3xl text-[12.5px] leading-relaxed text-muted">
                These questions are asked from the viewpoint of an oriented object in the scene (“imagine you are the robot”). The image-plane heuristic answers them from the camera’s own view, which is the egocentric bias reported for vision-language models: correct when the observer looks the same way as the camera, wrong when it faces the camera.
              </p>
              {summary.byRelation.oracle.obs_lateral.n === 0 ? (
                <p className="rounded-xl border border-dashed border-night-600 px-4 py-8 text-center text-[13px] text-muted">This run has no observer-frame questions. Set “Agents per scene” to 1 or 2 and run again.</p>
              ) : (
                <ThetaChart summary={summary} relation={thetaRel} />
              )}
            </section>

            <div className="grid gap-3 2xl:grid-cols-2">
              <section className="panel p-5">
                <h3 className="mb-3 text-[15px] font-bold text-ink">Accuracy by relation <span className="text-[12px] font-medium text-muted">± half-width of the 95% Wilson interval, in points</span></h3>
                <AccuracyTable summary={summary} />
              </section>
              <section className="panel p-5">
                <h3 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-ink">Dataset composition <Info text="Every object pair and every object is a candidate. Ties inside the tolerance are ambiguous; pairs with a hidden or out-of-frame object are unaskable. Only scored candidates are evaluated." /></h3>
                <Composition summary={summary} />
              </section>
            </div>

            <section className="panel p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h3 className="text-[15px] font-bold text-ink">Confusion matrices</h3>
                <span className="ml-auto"><Segmented size="sm" label="Reasoner" value={confReasoner} onChange={setConfReasoner} options={REASONERS.filter((r) => r.kind !== 'reference').map((r) => ({ value: r.id, label: r.short }))} /></span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                {RELATIONS.map((r) => <ConfusionMatrix key={r} summary={summary} reasoner={confReasoner} relation={r} />)}
              </div>
            </section>

            <section className="panel p-5" data-testid="failures">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-[15px] font-bold text-ink">Failure gallery <span className="num text-[12.5px] font-medium text-muted">{failures.length} wrong answers by the {REASONER_BY_ID[failReasoner].name.toLowerCase()}</span></h3>
                <Segmented size="sm" label="Failing reasoner" value={failReasoner} onChange={setFailReasoner} options={REASONERS.filter((r) => r.kind === 'heuristic').map((r) => ({ value: r.id, label: r.short }))} />
                <select aria-label="Relation" className="field w-auto py-1" value={failRelation} onChange={(e) => setFailRelation(e.target.value as RelationKey)}>
                  <option value="all">All relations</option>
                  {RELATIONS.map((r) => <option key={r} value={r}>{RELATION_INFO[r as Relation].short}</option>)}
                </select>
                <select aria-label="Viewpoint shift" className="field num w-auto py-1" value={String(failShift)} onChange={(e) => setFailShift(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                  <option value="all">All shifts</option>
                  {summary.shifts.map((s) => <option key={s} value={s}>{s}°</option>)}
                </select>
              </div>
              {failures.length === 0 ? (
                <p className="rounded-xl border border-dashed border-night-600 px-4 py-8 text-center text-[13px] text-muted">No failures match these filters. Try another relation or a larger viewpoint shift.</p>
              ) : (
                <>
                  <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {failures.slice(0, shown).map((it, i) => {
                      const { a, b } = objectIds(it);
                      return (
                        <li key={it.idx}>
                          <button className="flex w-full gap-3 rounded-xl border hairline bg-night-900/60 p-3 text-left transition-colors hover:border-indigo" onClick={() => setPlayback(i)} data-testid="failure-card">
                            <TopDownMap scene={sceneFor(it)} viewer={it.viewer} a={a} b={b} size={84} />
                            <span className="min-w-0 flex-1">
                              <span className="num block text-[11px] text-dim">{ENVIRONMENTS[it.env].label}, {it.shiftDeg}° shift</span>
                              <span className="mt-0.5 block text-[12.5px] font-semibold leading-snug text-ink">
                                <span style={{ color: A_COLOR }}>{it.aName}</span>{it.bName && <> vs <span style={{ color: B_COLOR }}>{it.bName}</span></>}
                              </span>
                              <span className="mt-1 block text-[12px] text-muted">truth <span className="font-bold capitalize text-ink">{it.gold}</span>, predicted <span className="font-bold capitalize text-rose">{it.preds[failReasoner]}</span></span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {shown < failures.length && (
                    <div className="mt-4 text-center"><button className="btn" onClick={() => setShown((n) => n + 24)}>Show 24 more of {failures.length - shown}</button></div>
                  )}
                </>
              )}
            </section>

            <section className="panel p-5 text-[12.5px] leading-relaxed text-muted">
              <h3 className="mb-2 text-[15px] font-bold text-ink">What each reasoner is allowed to see</h3>
              <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                {REASONERS.map((r) => (
                  <div key={r.id}>
                    <dt className="flex items-center gap-2 font-bold text-ink"><span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.name}<span className="font-medium text-dim">{r.kind}</span></dt>
                    <dd className="mt-0.5"><span className="text-ink">Sees: {r.input.replace(/\.$/, '')}.</span> {r.description}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-dim">Overall: {REASONERS.map((r) => `${r.short} ${pct(summary.overall[r.id])}`).join(', ')}.</p>
            </section>
          </>
        )}
      </div>
      {playback !== null && failures[playback] && <Playback items={failures} index={playback} onIndex={setPlayback} onClose={() => setPlayback(null)} />}
    </div>
  );
}
