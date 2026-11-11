/**
 * Evaluate a real vision-language model on an EgoVersa dataset split.
 *
 *   npm run eval:models -- --dataset research/data/egoversa-smoke --split test_iid,test_ood --model qwen3.5-0.8b-base
 *   flags: --limit N   --out file.json   --ollama http://127.0.0.1:11434   --resume   --tag run-label
 *
 * Leakage control is structural: `askModel` receives a ModelInput read from model_inputs/<split>.jsonl
 * ({sample_id, image_paths, prompt}). The registry with the answers is opened only AFTER every reply
 * has been collected, to score them.
 *
 * Nothing is simulated. If the model is not installed the script stops with instructions.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { answerCollapse, majorityByTask, summarizeModelEval, chanceByTask, type ModelEvalFile, type ModelEvalItem } from '../src/evaluation/modelEval';
import { normalizeAnswer } from '../src/evaluation/parse';
import { pct } from '../src/evaluation/export';

interface ModelInput {
  sample_id: string;
  image_paths: string[];
  prompt: string;
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const readJsonl = <T>(p: string): T[] => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);

const GEN = { temperature: 0, max_new_tokens: 12, seed: 7, thinking: false };

async function askModel(ollama: string, tag: string, datasetDir: string, input: ModelInput) {
  const images = input.image_paths.map((p) => readFileSync(join(datasetDir, p)).toString('base64'));
  const t0 = performance.now();
  const r = await fetch(`${ollama}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(300000),
    body: JSON.stringify({
      model: tag, stream: false, think: GEN.thinking,
      messages: [{ role: 'user', content: input.prompt, images }],
      options: { temperature: GEN.temperature, seed: GEN.seed, num_predict: GEN.max_new_tokens },
    }),
  });
  if (!r.ok) throw new Error(`runtime returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = (await r.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
  return { raw: String(d.message?.content ?? ''), latency_ms: Math.round(performance.now() - t0), prompt_tokens: d.prompt_eval_count ?? null, output_tokens: d.eval_count ?? null };
}

async function main() {
  if (flag('help') || !arg('dataset') || !arg('model')) {
    console.log('usage: npm run eval:models -- --dataset <dir> --model <registry id> [--split test_iid,test_ood] [--limit N] [--out file] [--resume] [--tag label]');
    process.exit(flag('help') ? 0 : 1);
  }
  const datasetDir = resolve(arg('dataset')!);
  const splits = (arg('split') ?? 'test_iid,test_ood').split(',');
  const limit = arg('limit') ? Number(arg('limit')) : null;
  const ollama = (arg('ollama') ?? process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  const reg = (JSON.parse(readFileSync('research/configs/models.json', 'utf8')).models as Record<string, unknown>[]).find((m) => m.id === arg('model')) as
    | { id: string; label: string; role: string; hf_id: string; runtime: string; ollama_tag: string; params_millions: number; license: string; track: string; how_to_get: string }
    | undefined;
  if (!reg) throw new Error(`Unknown model id "${arg('model')}". See research/configs/models.json.`);

  let tags: { name: string; digest: string; size: number; details?: { quantization_level?: string } }[];
  try {
    tags = ((await (await fetch(`${ollama}/api/tags`)).json()) as { models: typeof tags }).models;
  } catch {
    throw new Error(`The model runtime at ${ollama} is not reachable. Start Ollama and retry. No results were produced.`);
  }
  const t = tags.find((x) => x.name === reg.ollama_tag || x.name === `${reg.ollama_tag}:latest`);
  if (!t) throw new Error(`Model "${reg.id}" is not installed (${reg.ollama_tag}). ${reg.how_to_get}\nNo results were produced.`);

  const manifest = JSON.parse(readFileSync(join(datasetDir, 'manifest.json'), 'utf8'));
  const lockPath = join(datasetDir, 'holdout.lock.json');
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
  const runId = `${manifest.name}__${reg.id}${arg('tag') ? `__${arg('tag')}` : ''}__${splits.join('+')}${limit ? `__n${limit}` : ''}`;
  const outPath = resolve(arg('out') ?? join('research', 'results', `${runId}.json`));
  mkdirSync(resolve(outPath, '..'), { recursive: true });

  // ---- Phase 1: collect replies. Only model-visible records are in scope here. ----
  const inputs: { split: string; input: ModelInput }[] = [];
  for (const s of splits) {
    const rows = readJsonl<ModelInput>(join(datasetDir, 'model_inputs', `${s}.jsonl`));
    // Deterministic, task-interleaved subset when --limit is used (records are already scene-ordered).
    const take = limit ? rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / Math.ceil(limit / splits.length))) === 0).slice(0, Math.ceil(limit / splits.length)) : rows;
    for (const input of take) inputs.push({ split: s, input: { sample_id: input.sample_id, image_paths: input.image_paths, prompt: input.prompt } });
  }
  const partialPath = outPath + '.partial.json';
  const replies: Record<string, Awaited<ReturnType<typeof askModel>>> = flag('resume') && existsSync(partialPath) ? JSON.parse(readFileSync(partialPath, 'utf8')) : {};
  const started = new Date().toISOString();
  console.log(`${reg.label}  [${t.details?.quantization_level ?? '?'}, ${t.digest.slice(0, 12)}]  on ${inputs.length} items from ${splits.join(', ')}`);
  let done = 0;
  for (const { input } of inputs) {
    if (!replies[input.sample_id]) {
      replies[input.sample_id] = await askModel(ollama, reg.ollama_tag, datasetDir, input);
      if (++done % 20 === 0) {
        writeFileSync(partialPath, JSON.stringify(replies));
        process.stdout.write(`  ${Object.keys(replies).length}/${inputs.length}\n`);
      }
    }
  }
  let runtimeBytes: number | null = null;
  try {
    const ps = (await (await fetch(`${ollama}/api/ps`)).json()) as { models: { name: string; size: number }[] };
    runtimeBytes = ps.models.find((m) => m.name === t.name)?.size ?? null;
  } catch { /* optional */ }

  // ---- Phase 2: scoring. The registry (with answers) is opened only now. ----
  const items: ModelEvalItem[] = [];
  for (const s of splits) {
    const registry = new Map(readJsonl<Record<string, any>>(join(datasetDir, 'registry', `${s}.jsonl`)).map((r) => [r.sample_id as string, r]));
    for (const { split, input } of inputs) {
      if (split !== s) continue;
      const r = registry.get(input.sample_id)!;
      const reply = replies[input.sample_id];
      const pred = normalizeAnswer(reply.raw, r.oracle.options);
      items.push({
        sample_id: input.sample_id, split, task_type: r.task_type, relation: r.oracle.relation, reference_frame: r.oracle.reference_frame, env: r.metadata.env,
        difficulty: r.metadata.difficulty, theta_deg: r.metadata.theta_deg, ood_factors: r.metadata.ood_factors, image_paths: r.image_paths, prompt: r.prompt,
        options: r.oracle.options, gold: r.oracle.answer, answerable: r.oracle.answerable, raw: reply.raw, pred, correct: pred === r.oracle.answer,
        latency_ms: reply.latency_ms, prompt_tokens: reply.prompt_tokens, output_tokens: reply.output_tokens,
      });
    }
  }
  const gpu = os.cpus()[0].model;
  const file: ModelEvalFile = {
    format: 'egoversa.model-eval', version: 1, run_id: runId,
    model: { id: reg.id, label: reg.label, role: reg.role, hf_id: reg.hf_id, runtime: 'ollama', tag: reg.ollama_tag, revision: t.digest, quantization: t.details?.quantization_level ?? null, params_millions: reg.params_millions, license: reg.license, track: reg.track, size_bytes: t.size },
    dataset: { name: manifest.name, version: manifest.dataset_version, splits, lock_sha256: lock ? Object.values(lock.registry_sha256 as Record<string, string>).join(':').slice(0, 64) : null, limit },
    generation: GEN,
    hardware: { cpu: gpu, cores: os.cpus().length, ram_gb: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.arch()}`, accelerator: 'CPU (llama.cpp via Ollama)' },
    started_at: started, finished_at: new Date().toISOString(), runtime_model_bytes: runtimeBytes, items,
  };
  writeFileSync(outPath, JSON.stringify(file, null, 1));

  const s = summarizeModelEval(items);
  const chance = chanceByTask(items);
  const major = majorityByTask(items);
  const collapse = answerCollapse(items);
  console.log(`\noverall ${pct(s.overall)}  [${(100 * s.overall.lo).toFixed(1)}, ${(100 * s.overall.hi).toFixed(1)}]  n=${s.n}`);
  for (const [task, a] of Object.entries(s.byTask)) console.log(`  ${task.padEnd(18)} ${pct(a).padStart(6)}  n=${String(a.n).padStart(3)}  majority-answer ${(100 * major[task]).toFixed(0)}%  uniform ${(100 * chance[task]).toFixed(0)}%  top-reply share ${(100 * collapse[task]).toFixed(0)}%`);
  for (const [sp, a] of Object.entries(s.bySplit)) console.log(`  split ${sp.padEnd(12)} ${pct(a).padStart(6)}  n=${a.n}`);
  console.log(`  unparseable ${pct(s.unparseable)}   abstention recall ${pct(s.abstentionRecall)} (n=${s.abstentionRecall.n})   over-abstention ${pct(s.overAbstention)}   left/right inversion ${pct(s.leftRightInversion)}`);
  console.log(`  latency warm mean ${s.latency.warm_mean_ms.toFixed(0)} ms, p50 ${s.latency.p50_ms} ms, p95 ${s.latency.p95_ms} ms, first ${s.latency.first_ms} ms; ~${s.latency.mean_prompt_tokens.toFixed(0)} prompt tokens`);
  console.log(`wrote ${outPath}`);
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
});
