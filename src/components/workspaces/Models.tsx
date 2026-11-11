import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchModels, type ModelListing } from '../../evaluation/adapters';
import type { Acc } from '../../evaluation/evaluator';
import { answerCollapse, majorityByTask, summarizeModelEval, type ModelEvalFile, type ModelEvalSummary } from '../../evaluation/modelEval';
import { TASK_TITLES, TASK_TYPES, type TaskType } from '../../tasks/dataset';
import { useStudio } from '../../store/useStudio';
import { LineChart, type LineSeries } from '../charts/charts';
import { Empty, Info, Segmented } from '../ui/controls';

/** Fixed categorical order for compared runs (validated for the dark surface; direct labels carry identity too). */
const RUN_COLORS = ['#9F7AEA', '#BC8532', '#2B9FB0', '#D45C8A'];
const THETA = [0, 30, 60, 90, 120, 150, 180];
const pc = (a: Acc | undefined, d = 1) => (!a || !a.n ? 'n/a' : `${(100 * a.acc).toFixed(d)}%`);
const half = (a: Acc | undefined) => (!a || !a.n ? '' : `±${((a.hi - a.lo) * 50).toFixed(1)}`);
const ROLE: Record<string, string> = { 'student-base': 'Student, untuned', 'student-base-quantized': 'Student, untuned, quantised', 'student-tuned': 'Student, fine-tuned', teacher: 'Teacher', 'student-alt': 'Optional student' };

interface Run {
  key: string;
  file: ModelEvalFile;
  summary: ModelEvalSummary;
}

function validResult(x: unknown): x is ModelEvalFile {
  const f = x as ModelEvalFile;
  return !!f && f.format === 'egoversa.model-eval' && Array.isArray(f.items) && !!f.model?.id;
}
const shortName = (r: Run) => `${r.file.model.label.replace(/\s*\(.*\)$/, '')}${r.file.model.quantization ? ` ${r.file.model.quantization}` : ''}`;

function Registry({ listing, error, onRetry }: { listing: ModelListing | null; error: string | null; onRetry: () => void }) {
  if (error)
    return (
      <div className="rounded-xl border border-dashed border-night-600 px-5 py-6 text-[13px] leading-relaxed text-muted" data-testid="server-down">
        <p className="font-bold text-ink">The model server is not running</p>
        <p className="mt-1">{error} The lab, the arena and the geometry benchmark work without it. With it, this page lists which models are installed and lets you run them.</p>
        <p className="num mt-2 text-ink">npm run model-server</p>
        <button className="btn mt-3" onClick={onRetry}>Check again</button>
      </div>
    );
  if (!listing) return <p className="text-[13px] text-muted" role="status">Looking for the model server…</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[12.5px]" data-testid="registry">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1.5 pr-3 font-semibold">Model</th>
            <th className="px-3 font-semibold">Role</th>
            <th className="px-3 text-right font-semibold">Parameters</th>
            <th className="px-3 font-semibold">Licence</th>
            <th className="px-3 font-semibold">Status on this machine</th>
          </tr>
        </thead>
        <tbody>
          {listing.models.map((m) => (
            <tr key={m.id} className="border-t hairline align-top">
              <th scope="row" className="py-2 pr-3 text-left">
                <span className="block font-bold text-ink">{m.label}</span>
                <span className="num block text-[11.5px] font-medium text-dim">{m.hf_id}</span>
              </th>
              <td className="px-3 py-2 text-muted">{ROLE[m.role] ?? m.role}</td>
              <td className="num px-3 py-2 text-right text-ink">{(m.params_millions / 1000).toFixed(2)}B</td>
              <td className="px-3 py-2">
                <span className="block text-ink">{m.license}</span>
                <span className={`text-[11.5px] font-semibold ${m.track === 'research-nc' ? 'text-world' : 'text-dim'}`}>{m.track === 'research-nc' ? 'research only, non-commercial' : 'permissive track'}</span>
              </td>
              <td className="px-3 py-2">
                {m.available ? (
                  <span className="text-mint"><span className="font-bold">Installed</span> <span className="num text-muted">{m.quantization}, {m.size_bytes ? `${(m.size_bytes / 1e9).toFixed(2)} GB` : ''}, rev {m.revision?.slice(0, 10)}</span></span>
                ) : (
                  <span className="text-muted"><span className="font-bold text-ink">Not installed.</span> {m.how_to_get}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Models() {
  const server = useStudio((s) => s.modelServer);
  const notify = useStudio((s) => s.notify);
  const [listing, setListing] = useState<ModelListing | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [thetaTask, setThetaTask] = useState<'obs_lateral' | 'obs_frontback'>('obs_lateral');
  const [exTask, setExTask] = useState<TaskType | 'all'>('all');
  const [exOnly, setExOnly] = useState<'all' | 'wrong' | 'disagree'>('wrong');
  const [exShown, setExShown] = useState(6);

  const addRun = (file: ModelEvalFile, key: string) =>
    setRuns((prev) => (prev.some((r) => r.key === key) ? prev : [...prev, { key, file, summary: summarizeModelEval(file.items) }]));

  const load = async () => {
    setServerError(null);
    setLoading(true);
    try {
      setListing(await fetchModels(server));
      const list = (await (await fetch(`${server}/results`)).json()) as { files: { file: string }[] };
      const keys: string[] = [];
      for (const { file } of list.files.filter((f) => !f.file.includes('.partial'))) {
        const data: unknown = await (await fetch(`${server}/results/${encodeURIComponent(file)}`)).json();
        if (validResult(data)) {
          addRun(data, file);
          keys.push(file);
        }
      }
      setSelected((s) => (s.length ? s : keys.slice(0, 4)));
    } catch (e) {
      setListing(null);
      setServerError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  const importFiles = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      try {
        const data: unknown = JSON.parse(await f.text());
        if (!validResult(data)) throw new Error('not an EgoVersa model-evaluation file');
        addRun(data, f.name);
        setSelected((s) => (s.includes(f.name) || s.length >= 4 ? s : [...s, f.name]));
      } catch (e) {
        notify(`Could not import ${f.name}: ${(e as Error).message}`, 'warn');
      }
    }
  };

  const active = runs.filter((r) => selected.includes(r.key)).slice(0, 4);
  const color = (r: Run) => RUN_COLORS[active.indexOf(r) % RUN_COLORS.length];
  const tasks = TASK_TYPES.filter((t) => active.some((r) => r.summary.byTask[t]?.n));
  const major = useMemo(() => (active[0] ? majorityByTask(active[0].file.items) : {}), [active]);
  const collapse = useMemo(() => active.map((r) => answerCollapse(r.file.items)), [active]);
  const anyNC = active.some((r) => r.file.model.track === 'research-nc');
  const sameItems = active.length > 1 && active.every((r) => r.file.items.length === active[0].file.items.length && r.file.dataset.name === active[0].file.dataset.name && r.file.dataset.splits.join() === active[0].file.dataset.splits.join());

  const thetaSeries: LineSeries[] = active.map((r) => ({ id: r.key, name: shortName(r), color: color(r), points: THETA.map((x) => ({ x, a: r.summary.byTheta[thetaTask]?.[x] as Acc })).filter((p) => p.a) }));

  // Sample explorer: rows aligned by sample id across the selected runs.
  const examples = useMemo(() => {
    if (!active.length) return [];
    const maps = active.map((r) => new Map(r.file.items.map((i) => [i.sample_id, i])));
    return active[0].file.items
      .filter((it) => exTask === 'all' || it.task_type === exTask)
      .map((it) => ({ it, preds: maps.map((m) => m.get(it.sample_id)) }))
      .filter(({ preds }) => (exOnly === 'all' ? true : exOnly === 'wrong' ? preds.some((p) => p && !p.correct) : new Set(preds.map((p) => p?.pred ?? 'missing')).size > 1));
  }, [active, exTask, exOnly]);
  useEffect(() => setExShown(6), [exTask, exOnly, selected]);

  return (
    <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-1" data-testid="models-workspace">
      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold text-ink">Model registry</h2>
          <Info align="start" text="Availability is probed from the local runtime each time this page loads. A model that is not installed cannot be selected for inference, and no stand-in output is ever shown." />
          <button className="btn ml-auto" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <Registry listing={listing} error={serverError} onRetry={() => void load()} />
      </section>

      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-bold text-ink">Evaluation runs</h2>
          <Info align="start" text="Each run is one model on one locked dataset split, produced by `npm run eval:models` or research/scripts/evaluate_models.py. Select up to four to compare." />
          <span className="ml-auto flex gap-2">
            <button className="btn" onClick={() => fileRef.current?.click()}>Import result JSON</button>
            <input ref={fileRef} type="file" accept="application/json,.json" multiple className="hidden" aria-label="Import evaluation result files" onChange={(e) => { void importFiles(e.target.files); e.target.value = ''; }} />
          </span>
        </div>
        {runs.length === 0 ? (
          <Empty title="No model has been evaluated yet">
            Nothing is shown until a real run exists. With Ollama running: <span className="num text-ink">ollama pull qwen3.5:0.8b</span>, then{' '}
            <span className="num text-ink">npm run eval:models -- --dataset research/data/egoversa-smoke --model qwen3.5-0.8b-base</span>. Result files appear here, or can be imported.
          </Empty>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2" data-testid="run-list">
            {runs.map((r) => {
              const on = selected.includes(r.key);
              const i = active.indexOf(r);
              return (
                <li key={r.key}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${on ? 'border-indigo bg-indigo/10' : 'border-night-600 hover:border-night-500'}`}>
                    <input type="checkbox" className="mt-1 accent-indigo" checked={on} disabled={!on && selected.length >= 4} onChange={() => setSelected((s) => (on ? s.filter((k) => k !== r.key) : [...s, r.key]))} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-[13px] font-bold text-ink">
                        {i >= 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RUN_COLORS[i] }} />}
                        {r.file.model.label}
                      </span>
                      <span className="num mt-0.5 block text-[11.5px] text-muted">
                        {r.file.dataset.name} [{r.file.dataset.splits.join(', ')}], n={r.summary.n}, {r.file.model.quantization ?? 'n/a'}, {r.file.model.runtime}
                      </span>
                      <span className="num block text-[11.5px] text-dim">rev {r.file.model.revision?.slice(0, 12) ?? 'unknown'}, {r.file.finished_at.slice(0, 16).replace('T', ' ')}</span>
                    </span>
                    <span className="num text-[15px] font-bold text-ink">{pc(r.summary.overall)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {active.length > 0 && (
        <>
          <p className="rounded-xl border border-world/30 bg-world/5 px-4 py-2.5 text-[12.5px] leading-relaxed text-muted">
            <span className="font-bold text-world">How to read this.</span> Every number is measured on this machine by running the listed checkpoint on rendered images; the model saw only images and question text.
            Scores are on synthetic EgoVersa scenes and say nothing about other benchmarks. Compare each score with the majority-answer column: a model that repeats one word gets that much for free, and cells marked “one-answer” are exactly that.
            {active.length > 1 && !sameItems && <span className="font-semibold text-ink"> The selected runs do not cover the same items, so their columns are not directly comparable.</span>}
            {anyNC && <span className="font-semibold text-world"> A selected model is licensed CC BY-NC 4.0: non-commercial research use only.</span>}
          </p>

          <section className="panel p-5">
            <h2 className="mb-3 text-[15px] font-bold text-ink">Accuracy by task <span className="text-[12px] font-medium text-muted">± half-width of the 95% Wilson interval, in points</span></h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-separate border-spacing-1 text-[12.5px]" data-testid="task-table">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="px-2 py-1 font-semibold">Task</th>
                    <th className="px-2 py-1 text-right font-semibold">n</th>
                    <th className="px-2 py-1 text-right font-semibold"><span className="inline-flex items-center gap-1">Majority answer <Info align="end" text="Accuracy of always giving the most common correct answer for this task. A model that has collapsed to one reply scores about this much without looking at the image." /></span></th>
                    {active.map((r) => (
                      <th key={r.key} className="px-2 py-1 text-right font-semibold text-ink"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: color(r) }} />{shortName(r)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t}>
                      <th scope="row" className="px-2 py-1.5 text-left font-semibold text-ink">{TASK_TITLES[t]}</th>
                      <td className="num px-2 text-right text-muted">{active[0].summary.byTask[t]?.n ?? 0}</td>
                      <td className="num px-2 text-right text-muted">{major[t] !== undefined ? `${(100 * major[t]).toFixed(0)}%` : ''}</td>
                      {active.map((r) => {
                        const a = r.summary.byTask[t];
                        return (
                          <td key={r.key} className="num rounded-md px-2 py-1.5 text-right text-ink" style={{ background: a?.n ? `rgba(124,135,255,${(0.06 + 0.5 * a.acc).toFixed(3)})` : 'transparent' }} title={a?.n ? `${a.correct}/${a.n} correct, 95% CI ${(100 * a.lo).toFixed(1)}–${(100 * a.hi).toFixed(1)}%; ${(100 * (collapse[active.indexOf(r)][t] ?? 0)).toFixed(0)}% of replies are the same answer` : 'no items'}>
                            {pc(a)} <span className="text-[10.5px] text-muted">{half(a)}</span>
                            {(collapse[active.indexOf(r)][t] ?? 0) >= 0.9 && <span className="ml-1.5 rounded bg-world/20 px-1 text-[10px] font-semibold text-world" title="90% or more of this model's replies on this task are the same word">one-answer</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row" className="border-t hairline px-2 py-2 text-left font-bold text-ink">All tasks</th>
                    <td className="num border-t hairline px-2 text-right text-muted">{active[0].summary.n}</td>
                    <td className="border-t hairline" />
                    {active.map((r) => <td key={r.key} className="num border-t hairline px-2 py-2 text-right font-bold text-ink">{pc(r.summary.overall)} <span className="text-[10.5px] font-medium text-muted">{half(r.summary.overall)}</span></td>)}
                  </tr>
                  {Object.keys(active[0].summary.bySplit).map((sp) => (
                    <tr key={sp}>
                      <th scope="row" className="px-2 py-1 text-left font-medium text-muted">Split {sp}</th>
                      <td className="num px-2 text-right text-muted">{active[0].summary.bySplit[sp].n}</td>
                      <td />
                      {active.map((r) => <td key={r.key} className="num px-2 py-1 text-right text-ink">{pc(r.summary.bySplit[sp])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-3 2xl:grid-cols-2">
            <section className="panel p-5">
              <h2 className="mb-3 text-[15px] font-bold text-ink">Behaviour and cost</h2>
              <table className="w-full text-[12.5px]" data-testid="behaviour-table">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 pr-2 font-semibold">Measure</th>
                    {active.map((r) => <th key={r.key} className="px-2 text-right font-semibold text-ink">{shortName(r)}</th>)}
                  </tr>
                </thead>
                <tbody className="[&_td]:num [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-right [&_td]:text-ink [&_th]:py-1.5 [&_th]:pr-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted [&_tr]:border-t [&_tr]:border-night-700/70">
                  {(
                    [
                      ['Left/right inversion', 'Among parseable replies to left/right questions: share that name the opposite side.', (s) => `${pc(s.leftRightInversion)} (n=${s.leftRightInversion.n})`],
                      ['Abstains when the object is hidden', 'Recall of “unknown” on questions about a fully hidden object.', (s) => `${pc(s.abstentionRecall)} (n=${s.abstentionRecall.n})`],
                      ['Asserts a relation about a hidden object', 'Hallucination rate: gave a concrete answer although the object cannot be seen.', (s) => `${pc(s.hiddenHallucination)} (n=${s.hiddenHallucination.n})`],
                      ['Says “unknown” when the answer is visible', 'Over-abstention on answerable questions.', (s) => `${pc(s.overAbstention)} (n=${s.overAbstention.n})`],
                      ['Unparseable replies', 'Replies naming no single admissible option. Scored as wrong.', (s) => pc(s.unparseable)],
                      ['Latency, warm mean', 'Mean wall time per question after the first (which pays the model load).', (s) => `${(s.latency.warm_mean_ms / 1000).toFixed(2)} s`],
                      ['Latency, p95', '95th percentile wall time per question.', (s) => `${(s.latency.p95_ms / 1000).toFixed(2)} s`],
                      ['Prompt tokens, mean', 'Image tokens plus text tokens per question.', (s) => s.latency.mean_prompt_tokens.toFixed(0)],
                    ] as [string, string, (s: ModelEvalSummary) => string][]
                  ).map(([name, tip, f]) => (
                    <tr key={name}>
                      <th scope="row"><span className="inline-flex items-center gap-1.5">{name} <Info align="start" text={tip} /></span></th>
                      {active.map((r) => <td key={r.key}>{f(r.summary)}</td>)}
                    </tr>
                  ))}
                  <tr><th scope="row">Weights on disk (GGUF incl. vision projector)</th>{active.map((r) => <td key={r.key}>{r.file.model.size_bytes ? `${(r.file.model.size_bytes / 1e9).toFixed(2)} GB` : 'n/a'}</td>)}</tr>
                  <tr><th scope="row">Precision</th>{active.map((r) => <td key={r.key}>{r.file.model.quantization ?? 'n/a'}</td>)}</tr>
                  <tr><th scope="row">Hardware</th>{active.map((r) => <td key={r.key} className="!text-[11px] !text-muted">{r.file.hardware.cpu.replace(/\(R\)|\(TM\)|CPU /g, '')}</td>)}</tr>
                </tbody>
              </table>
            </section>

            <section className="panel p-5">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-[15px] font-bold text-ink">Perspective taking by heading offset θ</h2>
                <span className="ml-auto"><Segmented size="sm" label="Observer task" value={thetaTask} onChange={setThetaTask} options={[{ value: 'obs_lateral', label: 'Left / right' }, { value: 'obs_frontback', label: 'Front / behind' }]} /></span>
              </div>
              <LineChart xs={THETA} series={thetaSeries} chance={1 / 3} xLabel="Heading offset θ between the camera and the observer" ariaLabel="Model accuracy on observer-frame questions by heading offset" />
              <p className="mt-2 text-[12px] text-dim">Bins hold few items each on small test sets; hover for n before reading a trend into it.</p>
            </section>
          </div>

          <section className="panel p-5" data-testid="sample-explorer">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-[15px] font-bold text-ink">Sample explorer <span className="num text-[12.5px] font-medium text-muted">{examples.length} items</span></h2>
              <Segmented size="sm" label="Which items" value={exOnly} onChange={setExOnly} options={[{ value: 'wrong', label: 'Any model wrong' }, { value: 'disagree', label: 'Models disagree' }, { value: 'all', label: 'All' }]} />
              <select aria-label="Task" className="field w-auto py-1" value={exTask} onChange={(e) => setExTask(e.target.value as TaskType | 'all')}>
                <option value="all">All tasks</option>
                {tasks.map((t) => <option key={t} value={t}>{TASK_TITLES[t]}</option>)}
              </select>
            </div>
            {examples.length === 0 ? (
              <p className="rounded-xl border border-dashed border-night-600 px-4 py-8 text-center text-[13px] text-muted">No items match. Try “All”.</p>
            ) : (
              <ul className="grid gap-3 xl:grid-cols-2">
                {examples.slice(0, exShown).map(({ it, preds }) => (
                  <li key={it.sample_id} className="rounded-xl border hairline bg-night-900/60 p-3">
                    <div className="flex gap-2">
                      {it.image_paths.map((p, i) => (
                        <img key={p} loading="lazy" src={`${server}/data/${active[0].file.dataset.name}/${p}`} alt={`Rendered view ${i + 1} for this question`} className="aspect-[4/3] min-w-0 flex-1 rounded-lg border hairline bg-night-800 object-cover" style={{ maxWidth: it.image_paths.length > 1 ? '50%' : '62%' }} />
                      ))}
                    </div>
                    <p className="mt-2 text-[12.5px] font-semibold leading-snug text-ink">{it.prompt.split('\n')[0]}</p>
                    <p className="num mt-1 text-[11.5px] text-dim">{TASK_TITLES[it.task_type as TaskType] ?? it.task_type}, {it.split}, {it.difficulty}{it.theta_deg !== null ? `, θ ${it.theta_deg.toFixed(0)}°` : ''}</p>
                    <p className="mt-1.5 text-[12.5px] text-muted">Geometric ground truth <span className="font-bold capitalize text-ink">{it.gold}</span></p>
                    <ul className="mt-1 space-y-0.5 text-[12.5px]">
                      {preds.map((p, i) => (
                        <li key={active[i].key} className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RUN_COLORS[i] }} />
                          <span className="min-w-0 truncate text-muted">{shortName(active[i])}</span>
                          <span className="num ml-auto truncate text-ink">“{p?.raw.trim() ?? 'not run'}”</span>
                          <span className={`w-4 text-right font-bold ${p?.correct ? 'text-mint' : 'text-rose'}`} aria-label={p?.correct ? 'correct' : 'wrong'}>{p ? (p.correct ? '✓' : '✗') : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {exShown < examples.length && <div className="mt-4 text-center"><button className="btn" onClick={() => setExShown((n) => n + 12)}>Show 12 more of {examples.length - exShown}</button></div>}
            {serverError && <p className="mt-3 text-[12px] text-dim">Images are served by the model server; start it to see them.</p>}
          </section>
        </>
      )}
    </div>
  );
}
