#!/usr/bin/env node
/**
 * EgoVersa model server (zero dependencies, Node >= 18). Optional: the web app is fully usable without it.
 *
 *   npm run model-server            -> http://127.0.0.1:8787
 *
 *   GET  /health                    liveness
 *   GET  /models                    registry + live availability (never guessed; probed from the runtime)
 *   POST /predict                   { model, images[], question, options[], generation? } -> real inference
 *   GET  /results                   list of evaluation result files in research/results
 *   GET  /results/<file>.json       one result file
 *   GET  /data/<dataset>/images/<split>/<file>.png   dataset images for the sample explorer
 *
 * Safety properties
 *   - The model receives ONLY the image(s) and the prompt text built from {question, options}. The request
 *     schema is an allow-list: any other field (coordinates, seeds, gold answers...) is dropped unread.
 *   - A model that is not installed yields HTTP 409 with an explanation. There is no fallback and no
 *     canned output.
 *   - Images must be PNG/JPEG data URLs; nothing is read from client-supplied paths or URLs and nothing
 *     is passed to a shell. File routes resolve inside fixed directories and reject traversal.
 *   - Research-only (CC BY-NC) models carry a licence notice in every response.
 *
 * Environment: PORT (8787), OLLAMA_URL (http://127.0.0.1:11434), PREDICT_TIMEOUT_MS (120000)
 */
import http from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8787);
const OLLAMA = (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
const TIMEOUT = Number(process.env.PREDICT_TIMEOUT_MS ?? 120000);
const RESULTS_DIR = join(ROOT, 'research', 'results');
const DATA_DIR = join(ROOT, 'research', 'data');
const ORIGIN_OK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const MAX_BODY = 14e6;
const MAX_IMAGES = 4;

const registry = () => JSON.parse(readFileSync(join(ROOT, 'research', 'configs', 'models.json'), 'utf8')).models;

function send(res, status, body, origin, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': origin && ORIGIN_OK.test(origin) ? origin : 'http://localhost:5173',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function ollamaTags() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { up: false, tags: new Map() };
    const data = await r.json();
    return { up: true, tags: new Map(data.models.map((m) => [m.name, m])) };
  } catch {
    return { up: false, tags: new Map() };
  }
}

async function listModels() {
  const { up, tags } = await ollamaTags();
  return {
    runtime: { name: 'ollama', url: OLLAMA, reachable: up },
    models: registry().map((m) => {
      const t = tags.get(m.ollama_tag) ?? tags.get(`${m.ollama_tag}:latest`);
      return {
        ...m,
        available: Boolean(t),
        unavailable_reason: t ? null : up ? `Not installed in the local runtime. ${m.how_to_get}` : `The local model runtime at ${OLLAMA} is not reachable. Start Ollama, then: ${m.how_to_get}`,
        revision: t?.digest ?? null,
        size_bytes: t?.size ?? null,
        quantization: t?.details?.quantization_level ?? null,
        license_notice: m.track === 'research-nc' ? 'Non-commercial research use only (CC BY-NC 4.0). Outputs must stay in the research track.' : null,
      };
    }),
  };
}

/** The single place where model-visible text is assembled. */
export function buildPrompt(question, options) {
  const list = options.length === 2 ? `${options[0]} or ${options[1]}` : `${options.slice(0, -1).join(', ')}, or ${options[options.length - 1]}`;
  const hint = options.includes('unknown') ? ' If it cannot be determined from what is shown, answer unknown.' : '';
  return `${question}\nAnswer with exactly one word: ${list}.${hint}`;
}

function validatePredict(body) {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const { model, images, question, options, prompt } = body;
  if (typeof model !== 'string') return 'model must be a string id from GET /models';
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGES) return `images must contain 1 to ${MAX_IMAGES} items`;
  for (const im of images) {
    if (typeof im !== 'string' || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(im)) return 'each image must be a PNG or JPEG base64 data URL';
    if (im.length > 5.5e6) return 'each image must be under 4 MB';
  }
  if (prompt !== undefined) {
    if (typeof prompt !== 'string' || prompt.length > 1200) return 'prompt must be a string of at most 1200 characters';
    return null;
  }
  if (typeof question !== 'string' || !question.trim() || question.length > 800) return 'question must be a non-empty string of at most 800 characters';
  if (!Array.isArray(options) || options.length < 2 || options.length > 4 || options.some((o) => typeof o !== 'string' || !/^[a-z]{2,16}$/.test(o))) return 'options must be 2 to 4 lowercase words';
  return null;
}

async function predict(body, signal) {
  const all = await listModels();
  const m = all.models.find((x) => x.id === body.model);
  if (!m) return { status: 404, body: { error: `Unknown model "${body.model}".` } };
  if (!m.available) return { status: 409, body: { error: 'model_unavailable', message: m.unavailable_reason, model: m.id } };
  const gen = body.generation && typeof body.generation === 'object' ? body.generation : {};
  const maxNew = Math.min(64, Math.max(1, Number(gen.maxNewTokens) || 12));
  const temperature = Math.min(1.5, Math.max(0, Number(gen.temperature) || 0));
  const prompt = typeof body.prompt === 'string' ? body.prompt : buildPrompt(body.question, body.options);
  const t0 = performance.now();
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: m.ollama_tag,
      stream: false,
      think: false,
      messages: [{ role: 'user', content: prompt, images: body.images.map((d) => d.slice(d.indexOf(',') + 1)) }],
      options: { temperature, seed: 7, num_predict: maxNew },
    }),
  });
  if (!r.ok) return { status: 502, body: { error: 'runtime_error', message: `Ollama returned ${r.status}: ${(await r.text()).slice(0, 300)}` } };
  const d = await r.json();
  const raw = String(d?.message?.content ?? '');
  return {
    status: 200,
    body: {
      model: m.id,
      rawOutput: raw,
      answer: raw.trim(),
      latencyMs: Math.round(performance.now() - t0),
      modelRevision: m.revision,
      quantization: m.quantization,
      promptTokens: d.prompt_eval_count ?? null,
      outputTokens: d.eval_count ?? null,
      evalMs: d.eval_duration ? Math.round(d.eval_duration / 1e6) : null,
      promptEvalMs: d.prompt_eval_duration ? Math.round(d.prompt_eval_duration / 1e6) : null,
      loadMs: d.load_duration ? Math.round(d.load_duration / 1e6) : null,
      prompt,
      license: m.license,
      track: m.track,
      licenseNotice: m.license_notice,
    },
  };
}

/** Resolve `parts` under `base` and refuse anything that escapes it. */
function safeJoin(base, parts) {
  if (parts.some((p) => !/^[\w][\w.+-]*$/.test(p) || p.includes(".."))) return null;
  const full = resolve(base, ...parts);
  return full.startsWith(base + sep) ? full : null;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
    if (req.method === 'GET' && path[0] === 'health') return send(res, 200, { ok: true, service: 'egoversa-model-server' }, origin);
    if (req.method === 'GET' && path[0] === 'models' && path.length === 1) return send(res, 200, await listModels(), origin);
    if (req.method === 'GET' && path[0] === 'results') {
      if (path.length === 1) {
        const files = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, bytes: statSync(join(RESULTS_DIR, f)).size, modified: statSync(join(RESULTS_DIR, f)).mtime })) : [];
        return send(res, 200, { files }, origin);
      }
      const f = path.length === 2 && path[1].endsWith('.json') ? safeJoin(RESULTS_DIR, [path[1]]) : null;
      if (!f || !existsSync(f)) return send(res, 404, { error: 'no such result file' }, origin);
      return send(res, 200, readFileSync(f), origin, 'application/json; charset=utf-8');
    }
    if (req.method === 'GET' && path[0] === 'data' && path.length === 5 && path[2] === 'images' && path[4].endsWith('.png')) {
      const f = safeJoin(DATA_DIR, path.slice(1));
      if (!f || !existsSync(f)) return send(res, 404, { error: 'no such image' }, origin);
      return send(res, 200, readFileSync(f), origin, 'image/png');
    }
    if (req.method === 'POST' && path[0] === 'predict' && path.length === 1) {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) return send(res, 413, { error: 'payload too large' }, origin);
        chunks.push(c);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return send(res, 400, { error: 'body is not valid JSON' }, origin);
      }
      const bad = validatePredict(body);
      if (bad) return send(res, 400, { error: bad }, origin);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT);
      res.on('close', () => !res.writableEnded && ac.abort()); // client went away -> cancel the generation
      try {
        const out = await predict(body, ac.signal);
        return send(res, out.status, out.body, origin);
      } catch (e) {
        if (ac.signal.aborted) return send(res, 504, { error: 'timeout_or_cancelled', message: `No answer within ${TIMEOUT} ms, or the request was cancelled.` }, origin);
        return send(res, 502, { error: 'runtime_unreachable', message: `Could not reach the model runtime at ${OLLAMA}: ${e.message}` }, origin);
      } finally {
        clearTimeout(timer);
      }
    }
    return send(res, 404, { error: 'not found' }, origin);
  } catch (e) {
    return send(res, 500, { error: String(e?.message ?? e) }, origin);
  }
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', async () => {
    const m = await listModels();
    console.log(`EgoVersa model server on http://127.0.0.1:${PORT}  (runtime ${OLLAMA}: ${m.runtime.reachable ? 'reachable' : 'NOT reachable'})`);
    for (const x of m.models) console.log(`  ${x.available ? 'available  ' : 'unavailable'}  ${x.id.padEnd(24)} ${x.license}`);
  });
}
