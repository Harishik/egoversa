import { useEffect, useMemo, useRef, useState } from 'react';
import { cameraFrame } from '../../geometry/camera';
import { buildContext, BASELINE_IDS, REASONER_BY_ID } from '../../evaluation/reasoners';
import { createServerAdapter, fetchModels, type ModelListing, type SpatialVLMAdapter } from '../../evaluation/adapters';
import { generateQuestions, scaledTolerances } from '../../tasks/generator';
import { RELATION_INFO, RELATIONS, type Label, type Question, type Relation } from '../../tasks/types';
import { useStudio } from '../../store/useStudio';
import { A_COLOR, B_COLOR, TopDownMap } from '../charts/TopDownMap';
import { ViewerCanvas } from '../three/ViewerCanvas';
import { Empty, Info, Kbd, Slider } from '../ui/controls';

type Filter = Relation | 'all';
const GEOMETRY_ID = 'geometry-only';
/** Survives workspace switches within a session. */
let arenaStarted = false;

function Verdict({ ok }: { ok: boolean }) {
  return <span className={`inline-flex items-center gap-1 text-[12px] font-bold ${ok ? 'text-mint' : 'text-rose'}`}>{ok ? '✓ matches' : '✗ differs'}</span>;
}

/** Real model inference for the current question. Geometry-only by default; nothing is ever simulated. */
function ModelPanel({ question, getImage }: { question: Question; getImage: () => string | null }) {
  const server = useStudio((s) => s.modelServer);
  const [listing, setListing] = useState<ModelListing | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>(GEOMETRY_ID);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; res?: Awaited<ReturnType<SpatialVLMAdapter['predict']>>; error?: string; qid?: string; model?: string }>({ status: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const refresh = () => {
    setListError(null);
    fetchModels(server).then(setListing).catch((e: Error) => { setListing(null); setListError(e.message); });
  };
  useEffect(refresh, [server]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abort.current?.abort(), []);

  const model = listing?.models.find((m) => m.id === modelId) ?? null;
  // Observer-frame and camera questions offer "unknown" to a model, exactly as in the dataset prompts.
  const options = ['lateral', 'depth', 'vertical', 'obs_lateral', 'obs_frontback'].includes(question.relation) ? [...question.options, 'unknown'] : [...question.options];
  const ask = async () => {
    if (!model) return;
    const image = getImage();
    if (!image) return setState({ status: 'error', error: 'The viewer image is not ready yet.' });
    abort.current?.abort();
    abort.current = new AbortController();
    setState({ status: 'loading' });
    try {
      const res = await createServerAdapter(server, model).predict({ images: [image], question: question.text, taskType: question.relation, options }, abort.current.signal);
      setState({ status: 'done', res, qid: question.id, model: model.id });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return setState({ status: 'idle' });
      setState({ status: 'error', error: (e as Error).message });
    }
  };
  const shown = state.status === 'done' && state.res && state.qid === question.id && state.model === modelId ? state.res : null;

  return (
    <section className="panel" data-testid="model-panel">
      <div className="flex flex-wrap items-center gap-2 border-b hairline px-4 py-3">
        <h3 className="text-[13px] font-bold text-ink">Answer with a model</h3>
        <Info text="A model receives only the clean viewer image and the question text. No coordinates, poses, seeds or ground truth. Its reply is a prediction and is scored against the geometry oracle." />
        <select aria-label="Model" data-testid="model-select" className="field ml-auto w-auto max-w-[62%] py-1" value={modelId} onChange={(e) => { setModelId(e.target.value); setState({ status: 'idle' }); }}>
          <option value={GEOMETRY_ID}>Geometry only (no model)</option>
          {listing?.models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}{m.available ? '' : ' — not installed'}</option>
          ))}
        </select>
      </div>
      <div className="space-y-3 px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        {modelId === GEOMETRY_ID ? (
          <p>
            No model is selected, so nothing is predicted: you see geometric ground truth and the two hand-written heuristics only.
            {listError ? <> To use a real model, start the local server: <span className="num text-ink">npm run model-server</span>. <button className="underline decoration-night-500 underline-offset-2 hover:text-ink" onClick={refresh}>Check again</button></> : listing ? ` ${listing.models.filter((m) => m.available).length} of ${listing.models.length} registered models are installed.` : ' Looking for the model server…'}
          </p>
        ) : !model ? (
          <p role="alert" className="text-rose">{listError ?? 'This model is not in the registry.'}</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="num text-ink">{model.hf_id}</span>
              <span className="chip num">{(model.params_millions / 1000).toFixed(2)}B params</span>
              <span className="chip">{model.license}</span>
              {model.quantization && <span className="chip num">{model.quantization}</span>}
              <span className={`chip ${model.track === 'research-nc' ? 'border-world/60 text-world' : ''}`}>{model.track === 'research-nc' ? 'research only, non-commercial' : 'permissive track'}</span>
            </p>
            {model.license_notice && <p className="rounded-lg border border-world/40 bg-world/5 px-3 py-2 text-world">{model.license_notice}</p>}
            {!model.available ? (
              <p role="status" className="rounded-lg border border-night-500 bg-night-900 px-3 py-2" data-testid="model-unavailable">
                <span className="font-bold text-ink">Not available on this machine.</span> {model.unavailable_reason} No answer is shown for a model that did not run.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-primary" onClick={ask} disabled={state.status === 'loading'} data-testid="ask-model">{state.status === 'loading' ? 'Running the model…' : 'Ask this model'}</button>
                {state.status === 'loading' && <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>}
                <span className="text-dim">Runs locally on CPU; a few seconds per question.</span>
              </div>
            )}
          </>
        )}
        {state.status === 'error' && <p role="alert" className="rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-rose">{state.error}</p>}
        {shown && (
          <div className="rounded-lg border hairline bg-night-900 px-3 py-2" data-testid="model-reply">
            <p className="font-semibold text-ink">Model reply <span className="font-medium text-muted">(a prediction, not ground truth)</span></p>
            <p className="num mt-1 text-ink">“{shown.rawOutput || '(empty reply)'}”</p>
            <p className="mt-1">
              Parsed answer: <span className="font-bold text-ink">{shown.normalizedAnswer ?? 'unparseable'}</span>
              {question.gold && <span className="ml-2"><Verdict ok={shown.normalizedAnswer === question.gold} /></span>}
              <span className="num ml-3 text-dim">{shown.latencyMs} ms{shown.promptTokens ? `, ${shown.promptTokens} prompt tokens` : ''}{shown.modelRevision ? `, rev ${shown.modelRevision.slice(0, 10)}` : ''}</span>
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-muted hover:text-ink">Exact text the model was given</summary>
              <pre className="num mt-1 whitespace-pre-wrap text-[11.5px] text-ink">{shown.prompt}</pre>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}

export function QuestionArena() {
  const scene = useStudio((s) => s.scene);
  const viewer = useStudio((s) => s.viewer);
  const lighting = useStudio((s) => s.lighting);
  const toleranceScale = useStudio((s) => s.toleranceScale);
  const setToleranceScale = useStudio((s) => s.setToleranceScale);
  const animateViewer = useStudio((s) => s.animateViewer);
  const setViewer = useStudio((s) => s.setViewer);
  const newSeed = useStudio((s) => s.newSeed);

  const [generated, setGeneratedState] = useState(arenaStarted);
  const setGenerated = (v: boolean) => {
    arenaStarted = v;
    setGeneratedState(v);
  };
  const [filter, setFilter] = useState<Filter>('all');
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** answers keyed by view + question id, so moving the camera asks afresh */
  const [answers, setAnswers] = useState<Record<string, Label>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Quantise the pose so dragging a slider does not regenerate on every sub-degree change.
  const pose = useMemo(
    () => ({ azimuthDeg: Math.round(viewer.azimuthDeg), height: Math.round(viewer.height * 20) / 20, distance: Math.round(viewer.distance * 20) / 20 }),
    [viewer.azimuthDeg, viewer.height, viewer.distance],
  );
  const viewKey = `${scene.fingerprint}|${pose.azimuthDeg}|${pose.height}|${pose.distance}|${toleranceScale}`;
  const set = useMemo(() => generateQuestions(scene, pose, { tolerances: scaledTolerances(toleranceScale), perRelation: 3 }), [scene, pose, toleranceScale]);
  const ctx = useMemo(() => buildContext(scene, cameraFrame(pose, scene.focus), viewKey), [scene, pose, viewKey]);

  const visible = useMemo(() => set.questions.filter((q) => filter === 'all' || q.relation === filter), [set, filter]);
  const current = visible.find((q) => q.id === currentId) ?? visible[0] ?? null;
  const answerKey = (q: Question) => `${viewKey}|${q.id}`;
  const given = current ? answers[answerKey(current)] : undefined;
  const excluded = set.all.filter((q) => q.status !== 'scored');

  const answer = (label: Label) => {
    if (!current || given) return;
    setAnswers((a) => ({ ...a, [answerKey(current)]: label }));
  };
  const next = () => {
    if (!current) return;
    const i = visible.indexOf(current);
    const pending = [...visible.slice(i + 1), ...visible.slice(0, i)].find((q) => !answers[answerKey(q)]);
    setCurrentId((pending ?? visible[(i + 1) % visible.length]).id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!current || !generated) return;
      if (e.key === '1') answer(current.options[0]);
      else if (e.key === '2') answer(current.options[1]);
      else if (e.key === 'Enter' && given) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const answeredHere = set.questions.filter((q) => answers[answerKey(q)]);
  const correctHere = answeredHere.filter((q) => answers[answerKey(q)] === q.gold).length;
  const allAnswered = Object.keys(answers).length;

  const revealOutlines = current && given ? { [current.a]: A_COLOR, ...(current.b ? { [current.b]: B_COLOR } : {}) } : undefined;
  const revealTags = current && given ? { [current.a]: { text: current.aName, color: A_COLOR }, ...(current.b ? { [current.b]: { text: current.bName!, color: B_COLOR } } : {}) } : undefined;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-3 overflow-y-auto lg:content-stretch lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:overflow-hidden">
      {/* ------------------------------ left: the image ------------------------------ */}
      <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
        <figure className="panel overflow-hidden">
          <ViewerCanvas scene={scene} viewer={viewer} lighting={lighting} onCanvas={(el) => (canvasRef.current = el)} outlines={revealOutlines} tags={revealTags} label="Viewer camera image for the current question" />
          <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t hairline px-4 py-2.5 text-[12.5px] text-muted">
            <span className="font-semibold text-viewer">Viewer camera image</span>
            <span>{given ? 'Targets outlined after your answer.' : 'This clean frame is all a human or a model gets.'}</span>
            <span className="num ml-auto text-ink">az {pose.azimuthDeg}°, h {pose.height.toFixed(2)} m</span>
          </figcaption>
        </figure>

        <div className="panel px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[13px] font-bold text-ink">Move the viewer, keep the world</p>
            <button className="btn" onClick={() => animateViewer({ azimuthDeg: viewer.azimuthDeg - 90 })}>−90°</button>
            <button className="btn" onClick={() => animateViewer({ azimuthDeg: viewer.azimuthDeg + 90 })}>+90°</button>
            <button className="btn" onClick={() => animateViewer({ azimuthDeg: viewer.azimuthDeg + 180 }, 1300)}>Opposite side</button>
            <button className="btn" onClick={() => { newSeed(); setCurrentId(null); }}>New scene</button>
          </div>
          <Slider color="#5CE1E6" label="Azimuth" value={Math.round(viewer.azimuthDeg)} min={-180} max={180} step={1} format={(v) => `${v}°`} onChange={(v) => setViewer({ azimuthDeg: v })} />
          <Slider label="Ambiguity tolerance" value={toleranceScale} min={0.5} max={2.5} step={0.25} format={(v) => `×${v.toFixed(2)}`} onChange={setToleranceScale} hint="Scales every tie band (τ_θ = 4°, τ_ρ = 5% and τ_y = 3% of range, visibility band 30–70%). Wider bands exclude more near-ties from scoring." />
        </div>

        {current && given && (
          <div className="panel grid gap-4 p-4 sm:grid-cols-[auto_1fr]">
            <TopDownMap scene={scene} viewer={pose} a={current.a} b={current.b} size={180} showLabels />
            <div className="text-[12.5px] leading-relaxed text-muted">
              <p className="mb-1 text-[13px] font-bold text-ink">Plan view, revealed after answering</p>
              <p>World axes are drawn in amber and never move. The cyan wedge is the viewer’s field of view. Rotate the viewer and the same two objects swap sides in the image while their world coordinates stay put.</p>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------ right: the questions ------------------------------ */}
      <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
        <div className="panel flex flex-wrap items-center gap-3 px-4 py-3">
          <label className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
            Question type
            <select aria-label="Question type" className="field w-auto py-1" value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setCurrentId(null); }}>
              <option value="all">All types</option>
              {RELATIONS.map((r) => <option key={r} value={r}>{RELATION_INFO[r].title}</option>)}
            </select>
          </label>
          <p className="ml-auto text-[12.5px] text-muted" data-testid="arena-score">
            Your score at this viewpoint <span className="num font-bold text-ink">{correctHere}/{answeredHere.length}</span>
            <span className="text-dim"> ({allAnswered} answered this session)</span>
          </p>
        </div>

        {!generated ? (
          <Empty title="No questions yet" action={<button className="btn btn-primary" data-testid="generate-questions" onClick={() => setGenerated(true)}>Generate questions</button>}>
            Questions are derived from the current scene and viewpoint. Only well-defined ones are scored.
          </Empty>
        ) : !current ? (
          <Empty title="Nothing to score from here" action={<><button className="btn btn-primary" onClick={() => animateViewer({ azimuthDeg: viewer.azimuthDeg + 60 })}>Rotate the viewer 60°</button><button className="btn" onClick={() => setFilter('all')}>Show all relations</button></>}>
            Every candidate {filter === 'all' ? '' : `${RELATION_INFO[filter].short.toLowerCase()} `}question at this viewpoint is a tie or cannot be answered from the image, so none is scored.
          </Empty>
        ) : (
          <article className="panel p-5" aria-live="polite">
            <header className="flex items-center gap-2 text-[12.5px] text-muted">
              <span className="chip">{RELATION_INFO[current.relation].title}</span>
              <span>Question {visible.indexOf(current) + 1} of {visible.length}</span>
              <span className="ml-auto inline-flex items-center gap-1.5">Convention <Info align="end" text={`${RELATION_INFO[current.relation].rule} Frame: ${RELATION_INFO[current.relation].frame}.`} /></span>
            </header>
            <h2 className="mt-3 font-display text-[1.75rem] leading-tight text-ink" data-testid="question-text">{current.text}</h2>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {current.options.map((opt, i) => {
                const chosen = given === opt;
                const isGold = given && current.gold === opt;
                return (
                  <button
                    key={opt}
                    data-testid={`option-${i}`}
                    disabled={!!given}
                    onClick={() => answer(opt)}
                    className={`rounded-xl border px-4 py-4 text-left text-[15px] font-bold capitalize transition-colors disabled:cursor-default ${
                      isGold ? 'border-mint bg-mint/10 text-ink' : chosen ? 'border-rose bg-rose/10 text-ink' : given ? 'border-night-600 text-dim' : 'border-night-500 bg-night-800 text-ink hover:border-indigo hover:bg-indigo/10'
                    }`}
                  >
                    <span className="mr-2"><Kbd>{i + 1}</Kbd></span>
                    {opt}
                    {isGold && <span className="ml-2 text-[12px] font-semibold normal-case text-mint">ground truth</span>}
                    {chosen && !isGold && <span className="ml-2 text-[12px] font-semibold normal-case text-rose">your answer</span>}
                  </button>
                );
              })}
            </div>

            {given && (
              <div className="mt-5 space-y-4" data-testid="reveal">
                <div className="rounded-xl border border-night-500 bg-night-900 p-4">
                  <p className="text-[12.5px] font-bold text-ink">Geometric ground truth <span className="font-medium text-muted">(computed from the scene, not predicted)</span></p>
                  <p className="mt-1 text-[15px] font-bold capitalize text-ink">{current.gold}</p>
                  <p className="num mt-2 text-[12px] leading-relaxed text-muted">{current.evidence.note}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-dim">{RELATION_INFO[current.relation].rule}</p>
                </div>
                <div>
                  <p className="mb-2 text-[12.5px] font-bold text-ink">Predictions <span className="font-medium text-muted">(answers from limited reasoners, which can be wrong)</span></p>
                  <ul className="divide-y divide-night-700 rounded-xl border hairline text-[13px]">
                    <li className="flex items-center gap-3 px-3 py-2">
                      <span className="w-44 font-semibold text-ink">You</span>
                      <span className="capitalize text-ink">{given}</span>
                      <span className="ml-auto"><Verdict ok={given === current.gold} /></span>
                    </li>
                    {BASELINE_IDS.map((id) => {
                      const r = REASONER_BY_ID[id];
                      const p = r.predict(current, ctx);
                      return (
                        <li key={id} className="flex items-center gap-3 px-3 py-2">
                          <span className="flex w-44 items-center gap-2 font-semibold text-ink">
                            <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.name}
                            <Info text={`Sees: ${r.input.replace(/\.$/, '')}. ${r.description}`} />
                          </span>
                          <span className="capitalize text-ink">{p}</span>
                          <span className="ml-auto"><Verdict ok={p === current.gold} /></span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={next} data-testid="next-question">Next question <Kbd>Enter</Kbd></button>
                  <button className="btn" onClick={() => { setCurrentId(current.id); animateViewer({ azimuthDeg: viewer.azimuthDeg + 180 }, 1300); }}>
                    Ask again from the opposite side
                  </button>
                </div>
              </div>
            )}
          </article>
        )}

        {generated && current && <ModelPanel question={current} getImage={() => { try { return canvasRef.current?.toDataURL('image/png') ?? null; } catch { return null; } }} />}

        {generated && (
          <div className="panel">
            <div className="flex items-center gap-2 border-b hairline px-4 py-3">
              <h3 className="text-[13px] font-bold text-ink">Question set at this viewpoint</h3>
              <span className="chip ml-auto num" data-testid="question-count">{set.questions.length} scored</span>
              <span className="chip num">{excluded.length} excluded</span>
            </div>
            <ol className="max-h-56 divide-y divide-night-700/60 overflow-y-auto text-[12.5px]">
              {visible.map((q) => {
                const a = answers[answerKey(q)];
                return (
                  <li key={q.id}>
                    <button className={`flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-night-800/60 ${q === current ? 'bg-night-800' : ''}`} onClick={() => setCurrentId(q.id)}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${!a ? 'bg-night-500' : a === q.gold ? 'bg-mint' : 'bg-rose'}`} aria-label={!a ? 'unanswered' : a === q.gold ? 'correct' : 'incorrect'} />
                      <span className="min-w-0 flex-1 truncate text-ink">{q.text}</span>
                      <span className="shrink-0 text-dim">{RELATION_INFO[q.relation].short}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <details className="border-t hairline">
              <summary className="cursor-pointer px-4 py-2.5 text-[12.5px] font-semibold text-muted hover:text-ink">
                Why {excluded.length} candidates are not scored
              </summary>
              <ul className="max-h-48 space-y-1.5 overflow-y-auto px-4 pb-3 text-[12px] leading-snug text-muted">
                {excluded.slice(0, 60).map((q) => (
                  <li key={q.id}>
                    <span className={`mr-2 font-bold ${q.status === 'ambiguous' ? 'text-world' : 'text-dim'}`}>{q.status}</span>
                    <span className="text-ink">{q.aName}{q.bName ? ` / ${q.bName}` : ''}</span>, {RELATION_INFO[q.relation].short.toLowerCase()}. {q.reason}
                  </li>
                ))}
                {excluded.length > 60 && <li className="text-dim">and {excluded.length - 60} more.</li>}
              </ul>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
