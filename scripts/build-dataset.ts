/**
 * EgoVersa dataset builder: deterministic scenes -> real rendered images + oracle-verified VQA records.
 *
 *   npm run dataset -- --config research/configs/dataset.smoke.json
 *   npm run dataset -- --config research/configs/dataset.pilot.json --splits train,val
 *   flags: --out <dir>  --splits a,b  --relock (discard and rebuild the locked test splits)  --dry-run
 *
 * Output layout (under research/data/<name>/):
 *   images/<split>/<hash>.png      rendered viewer images; file names are opaque content hashes
 *   registry/<split>.jsonl         FULL records incl. oracle answers and scene metadata  (private)
 *   model_inputs/<split>.jsonl     {sample_id, image_paths, prompt} only                 (model-visible)
 *   sft/<split>.jsonl              chat-format supervised examples (train / val only)
 *   manifest.json                  config, counts, hashes
 *   holdout.lock.json              frozen test splits: ids, scene fingerprints, image hashes, file digests
 *
 * The test splits are built FIRST and locked. A later run refuses to touch them unless --relock is given,
 * and refuses to write any train / val sample whose scene fingerprint or image hash is in the lock.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { wrapDeg, type ViewerPose } from '../src/geometry/camera';
import { RNG } from '../src/geometry/rng';
import { ENGINE_VERSION } from '../src/evaluation/evaluator';
import { ENVIRONMENTS } from '../src/scenes/environments';
import { generateScene } from '../src/scenes/generate';
import { clampViewer } from '../src/scenes/scenario';
import type { EnvId, LightingId, SceneSpec } from '../src/scenes/types';
import { buildPairItems, buildViewItems, modelPrompt, TASK_TYPES, type DatasetItem, type TaskType, type TemplateId } from '../src/tasks/dataset';
import { scaledTolerances } from '../src/tasks/generator';

export const SPLITS = ['test_iid', 'test_ood', 'val', 'train'] as const;
export type Split = (typeof SPLITS)[number];
const TEST_SPLITS: Split[] = ['test_iid', 'test_ood'];

export interface DatasetConfig {
  name: string;
  version: string;
  baseSeed: string;
  imageWidth: number;
  envs: EnvId[];
  /** Scenes per environment for each split. */
  scenes: Record<Split, number>;
  /** Max items kept per task type from one view (two-view tasks: per view pair). */
  perViewPerTask: number;
  toleranceScale: number;
  license_track: 'permissive';
}

export interface RegistryRecord {
  sample_id: string;
  split: Split;
  image_paths: string[];
  prompt: string;
  task_type: TaskType;
  oracle: { answer: string; answerable: boolean; reference_frame: string; options: string[]; explanation: string; relation: string | null };
  teacher: { status: 'not_queried'; answer: null; verified: null };
  metadata: {
    env: EnvId; scene_seed: string; scene_fingerprint: string; scene_spec: SceneSpec; lighting_id: LightingId;
    cameras: ViewerPose[]; difficulty: string; template_id: TemplateId; object_ids: string[]; object_names: string[];
    n_objects: number; theta_deg: number | null; ood_factors: string[]; image_sha256: string[];
  };
  provenance: { source: 'egoversa-procedural'; engine: string; license_track: 'permissive'; license: string };
}

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

/** Everything that distinguishes the splits lives here, so the protocol is readable in one place. */
function splitPolicy(split: Split, namespace?: string) {
  const ood = split === 'test_ood';
  return {
    seedNamespace: namespace ?? split, // disjoint procedural seeds per split
    excludeHeldOut: !ood, // held-out object nouns never appear outside test_ood
    lightings: (ood ? ['backlit'] : ['studio', 'warm', 'dim']) as LightingId[],
    templates: (ood ? [2] : [0, 1]) as TemplateId[],
    /** Fraction of the allowed height / distance range the camera may use, centred on the default. */
    cameraBand: ood ? 1 : 0.7,
  };
}

function sceneSpecFor(cfg: DatasetConfig, split: Split, env: EnvId, i: number, namespace?: string): SceneSpec {
  const seed = `${cfg.baseSeed}/${splitPolicy(split, namespace).seedNamespace}/${env}/${i}`;
  const r = new RNG(`${seed}|params`);
  return {
    env, seed,
    objectCount: r.int(6, 9),
    occlusion: Math.round(r.range(0.2, 0.9) * 20) / 20,
    distractors: r.int(0, 2),
    jitter: Math.round(r.range(0.3, 1) * 20) / 20,
    agents: r.int(1, 2),
    exclude: splitPolicy(split).excludeHeldOut ? ENVIRONMENTS[env].heldOutNouns : [],
  };
}

interface Counts { [task: string]: { [label: string]: number } }

/** Prefer the least-represented answer label so each task stays balanced within a split. */
function selectBalanced(cands: DatasetItem[], k: number, counts: Counts, rng: RNG): DatasetItem[] {
  const out: DatasetItem[] = [];
  const byTask = new Map<TaskType, DatasetItem[]>();
  for (const c of rng.shuffle(cands)) byTask.set(c.taskType, [...(byTask.get(c.taskType) ?? []), c]);
  for (const [task, list] of byTask) {
    const tc = (counts[task] ??= {});
    for (let n = 0; n < k && list.length; n++) {
      list.sort((a, b) => (tc[a.answer] ?? 0) - (tc[b.answer] ?? 0));
      const pick = list.shift()!;
      tc[pick.answer] = (tc[pick.answer] ?? 0) + 1;
      out.push(pick);
    }
  }
  return out;
}

async function buildSplit(cfg: DatasetConfig, split: Split, outDir: string, page: Page | null, forbid: { fingerprints: Set<string>; images: Set<string> }, namespace?: string, fileTag?: string) {
  const policy = splitPolicy(split, namespace);
  const tag = fileTag ?? split;
  const tol = scaledTolerances(cfg.toleranceScale);
  const records: RegistryRecord[] = [];
  const counts: Counts = {};
  const imgDir = join(outDir, 'images', split);
  if (page) mkdirSync(imgDir, { recursive: true });
  const fingerprints = new Set<string>();
  const imageHashes = new Set<string>();

  for (const env of cfg.envs) {
    for (let i = 0; i < cfg.scenes[split]; i++) {
      const spec = sceneSpecFor(cfg, split, env, i, namespace);
      const scene = generateScene(spec);
      if (forbid.fingerprints.has(scene.fingerprint)) throw new Error(`Split integrity: scene ${scene.fingerprint} of ${split} is in the locked holdout.`);
      if (fingerprints.has(scene.fingerprint)) continue; // identical world drawn twice: keep one
      fingerprints.add(scene.fingerprint);

      const rc = new RNG(`${spec.seed}|camera`);
      const rl = new RNG(`${spec.seed}|lighting`);
      const rq = new RNG(`${spec.seed}|questions`);
      const lim = scene.limits;
      const band = policy.cameraBand;
      const jitter = (def: number, lo: number, hi: number) => def + rc.range(-1, 1) * 0.5 * band * (hi - lo);
      const poseA = clampViewer({ azimuthDeg: wrapDeg(rc.range(-180, 180)), height: jitter(scene.defaultViewer.height, lim.minHeight, lim.maxHeight), distance: jitter(scene.defaultViewer.distance, lim.minDistance, lim.maxDistance) }, scene);
      const delta = rc.range(30, 100) * (rc.chance(0.5) ? 1 : -1);
      const poseB = clampViewer({ azimuthDeg: wrapDeg(poseA.azimuthDeg + delta), height: jitter(scene.defaultViewer.height, lim.minHeight, lim.maxHeight), distance: jitter(scene.defaultViewer.distance, lim.minDistance, lim.maxDistance) }, scene);
      const round = (p: ViewerPose): ViewerPose => ({ azimuthDeg: Math.round(p.azimuthDeg * 100) / 100, height: Math.round(p.height * 1000) / 1000, distance: Math.round(p.distance * 1000) / 1000 });
      const poses = [round(poseA), round(poseB)];
      const lighting = rl.pick(policy.lightings);

      const opts = { tolerances: tol, templates: policy.templates, salt: split };
      const A = buildViewItems(scene, poses[0], opts);
      const B = buildViewItems(scene, poses[1], opts);
      const pair = buildPairItems(scene, poses[0], poses[1], A.set, B.set, opts);
      const chosen: { item: DatasetItem; views: number[] }[] = [
        ...selectBalanced(A.items, cfg.perViewPerTask, counts, rq).map((item) => ({ item, views: [0] })),
        ...selectBalanced(B.items, cfg.perViewPerTask, counts, rq).map((item) => ({ item, views: [1] })),
        ...selectBalanced(pair, cfg.perViewPerTask, counts, rq).map((item) => ({ item, views: [0, 1] })),
      ];
      if (!chosen.length) continue;

      // Render the two views once. File names are content hashes: they reveal nothing about pose or answer.
      const rel: string[] = [];
      const hashes: string[] = [];
      for (const pose of poses) {
        if (!page) {
          rel.push(`images/${split}/dryrun.png`);
          hashes.push('dryrun');
          continue;
        }
        const dataUrl = await page.evaluate(([s, p, l]) => window.__egoversaRender!(s as SceneSpec, p as ViewerPose, l as LightingId), [spec, pose, lighting] as const);
        const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
        const h = sha(buf);
        if (forbid.images.has(h)) throw new Error(`Split integrity: image ${h.slice(0, 12)} of ${split} duplicates a locked holdout image.`);
        imageHashes.add(h);
        const file = `images/${split}/${h.slice(0, 20)}.png`;
        writeFileSync(join(outDir, file), buf);
        rel.push(file);
        hashes.push(h);
      }

      const nouns = new Set(scene.objects.map((o) => o.noun));
      const held = ENVIRONMENTS[env].heldOutNouns.filter((n) => nouns.has(n));
      for (const { item, views } of chosen) {
        const heldInQuestion = scene.objects.filter((o) => item.objectIds.includes(o.id) && ENVIRONMENTS[env].heldOutNouns.includes(o.noun)).length > 0;
        const ood: string[] = [];
        if (split === 'test_ood') {
          ood.push('template', 'lighting', 'camera_range');
          if (held.length) ood.push('heldout_noun_in_scene');
          if (heldInQuestion) ood.push('heldout_noun_in_question');
        }
        const id = `${tag}_${sha(`${scene.fingerprint}|${JSON.stringify(views.map((v) => poses[v]))}|${item.key}`).slice(0, 16)}`;
        records.push({
          sample_id: id,
          split: tag as Split,
          image_paths: views.map((v) => rel[v]),
          prompt: modelPrompt(item),
          task_type: item.taskType,
          oracle: { answer: item.answer, answerable: item.answerable, reference_frame: item.referenceFrame, options: item.options, explanation: item.explanation, relation: item.relation },
          teacher: { status: 'not_queried', answer: null, verified: null },
          metadata: {
            env, scene_seed: spec.seed, scene_fingerprint: scene.fingerprint, scene_spec: scene.spec, lighting_id: lighting,
            cameras: views.map((v) => poses[v]), difficulty: item.difficulty, template_id: item.templateId, object_ids: item.objectIds, object_names: item.objectNames,
            n_objects: scene.objects.length, theta_deg: item.thetaDeg === undefined ? null : Math.round(item.thetaDeg * 10) / 10, ood_factors: ood, image_sha256: views.map((v) => hashes[v]),
          },
          provenance: { source: 'egoversa-procedural', engine: ENGINE_VERSION, license_track: cfg.license_track, license: 'MIT (procedurally generated by this repository; no third-party assets)' },
        });
      }
    }
    process.stdout.write(`  ${split}/${env}: ${records.length} samples so far\n`);
  }
  return { records, counts, fingerprints, imageHashes };
}

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');

function writeSplit(outDir: string, split: string, records: RegistryRecord[]) {
  for (const d of ['registry', 'model_inputs', 'sft']) mkdirSync(join(outDir, d), { recursive: true });
  writeFileSync(join(outDir, 'registry', `${split}.jsonl`), jsonl(records));
  // Model-visible view: an explicit allow-list of three fields. Nothing else may be added here.
  writeFileSync(join(outDir, 'model_inputs', `${split}.jsonl`), jsonl(records.map((r) => ({ sample_id: r.sample_id, image_paths: r.image_paths, prompt: r.prompt }))));
  if (!TEST_SPLITS.includes(split as Split)) {
    writeFileSync(
      join(outDir, 'sft', `${split}.jsonl`),
      jsonl(records.map((r) => ({
        sample_id: r.sample_id,
        supervision: 'oracle',
        license_track: r.provenance.license_track,
        messages: [
          { role: 'user', content: [...r.image_paths.map((p) => ({ type: 'image', path: p })), { type: 'text', text: r.prompt }] },
          { role: 'assistant', content: [{ type: 'text', text: r.oracle.answer }] },
        ],
      }))),
    );
  }
}

async function main() {
  const cfgPath = arg('config');
  if (!cfgPath || flag('help')) {
    console.log('usage: npm run dataset -- --config research/configs/dataset.smoke.json [--out dir] [--splits train,val] [--relock] [--dry-run] [--extra-train N]');
    process.exit(cfgPath ? 0 : 1);
  }
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as DatasetConfig;
  const outDir = resolve(arg('out') ?? join('research', 'data', cfg.name));
  const want = (arg('splits')?.split(',') ?? [...SPLITS]) as Split[];
  const dry = flag('dry-run');
  const lockPath = join(outDir, 'holdout.lock.json');
  const testCfgDigest = sha(JSON.stringify({ ...cfg, scenes: { test_iid: cfg.scenes.test_iid, test_ood: cfg.scenes.test_ood } }));
  mkdirSync(outDir, { recursive: true });

  let lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
  if (lock && flag('relock')) {
    console.log('--relock: discarding the locked test splits. Any result computed on them is no longer comparable.');
    for (const s of TEST_SPLITS) rmSync(join(outDir, 'images', s), { recursive: true, force: true });
    lock = null;
  }
  if (lock && lock.test_config_sha256 !== testCfgDigest) {
    throw new Error('The config no longer matches the locked holdout (test settings changed). Use a new dataset name, or pass --relock to rebuild the holdout deliberately.');
  }

  // --extra-train N: N more training scenes per environment from a fresh seed namespace, written as
  // registry/model_inputs/sft "train_extra". Used by the data-matched control run (D). Never touches tests.
  const extraScenes = arg('extra-train') ? Number(arg('extra-train')) : 0;
  if (extraScenes && !lock) throw new Error('Build the dataset (and its locked holdout) before adding extra training data.');
  let server: ViteDevServer | null = null;
  let page: Page | null = null;
  let browser = null;
  if (!dry) {
    server = await createServer({ server: { port: 0, strictPort: false }, logLevel: 'error' });
    await server.listen();
    const base = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
    page = await browser.newPage({ viewport: { width: cfg.imageWidth + 40, height: Math.round((cfg.imageWidth * 3) / 4) + 40 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${base}?render=1&w=${cfg.imageWidth}`);
    await page.waitForFunction(() => window.__egoversaReady === true, undefined, { timeout: 60000 });
  }

  const summary: Record<string, { samples: number; scenes: number; images: number; by_task: Counts }> = {};
  try {
    const forbid = { fingerprints: new Set<string>(lock?.scene_fingerprints ?? []), images: new Set<string>(lock?.image_sha256 ?? []) };
    if (extraScenes) {
      const trainFps = new Set(readFileSync(join(outDir, 'registry', 'train.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).metadata.scene_fingerprint as string));
      const built = await buildSplit({ ...cfg, scenes: { ...cfg.scenes, train: extraScenes } }, 'train', outDir, page, { fingerprints: new Set([...forbid.fingerprints, ...trainFps]), images: forbid.images }, 'train-extra', 'train_extra');
      if (!dry) writeSplit(outDir, 'train_extra', built.records);
      summary.train_extra = { samples: built.records.length, scenes: built.fingerprints.size, images: built.imageHashes.size, by_task: built.counts };
      want.length = 0; // nothing else to build
    }
    for (const split of SPLITS) {
      if (!want.includes(split)) continue;
      if (TEST_SPLITS.includes(split) && lock) {
        const file = join(outDir, 'registry', `${split}.jsonl`);
        const ok = existsSync(file) && sha(readFileSync(file)) === lock.registry_sha256[split];
        if (!ok) throw new Error(`Locked split ${split} is missing or was modified on disk (digest mismatch).`);
        console.log(`${split}: locked, verified, left untouched (${lock.counts[split]} samples)`);
        continue;
      }
      console.log(`${split}: building`);
      const built = await buildSplit(cfg, split, outDir, page, TEST_SPLITS.includes(split) ? { fingerprints: new Set(), images: new Set() } : forbid);
      summary[split] = { samples: built.records.length, scenes: built.fingerprints.size, images: built.imageHashes.size, by_task: built.counts };
      if (dry) continue;
      writeSplit(outDir, split, built.records);
      if (TEST_SPLITS.includes(split)) {
        const partial = existsSync(lockPath + '.partial') ? JSON.parse(readFileSync(lockPath + '.partial', 'utf8')) : { sample_ids: [], scene_fingerprints: [], image_sha256: [], registry_sha256: {}, counts: {} };
        partial.sample_ids.push(...built.records.map((r) => r.sample_id));
        partial.scene_fingerprints.push(...built.fingerprints);
        partial.image_sha256.push(...built.imageHashes);
        partial.registry_sha256[split] = sha(readFileSync(join(outDir, 'registry', `${split}.jsonl`)));
        partial.counts[split] = built.records.length;
        writeFileSync(lockPath + '.partial', JSON.stringify(partial));
        for (const f of built.fingerprints) forbid.fingerprints.add(f);
        for (const h of built.imageHashes) forbid.images.add(h);
      }
    }
    if (!dry && !lock && existsSync(lockPath + '.partial')) {
      const partial = JSON.parse(readFileSync(lockPath + '.partial', 'utf8'));
      if (TEST_SPLITS.every((s) => partial.registry_sha256[s])) {
        writeFileSync(lockPath, JSON.stringify({ format: 'egoversa.holdout-lock', version: 1, dataset: cfg.name, dataset_version: cfg.version, locked_at: new Date().toISOString(), test_config_sha256: testCfgDigest, splits: TEST_SPLITS, ...partial }, null, 2));
        rmSync(lockPath + '.partial');
        console.log(`holdout locked: ${partial.sample_ids.length} test samples, ${partial.scene_fingerprints.length} scenes`);
      }
    }
  } finally {
    await browser?.close();
    await server?.close();
  }

  if (!dry) {
    const manifestPath = join(outDir, 'manifest.json');
    const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { splits: {} };
    writeFileSync(manifestPath, JSON.stringify({
      format: 'egoversa.dataset', version: 1, name: cfg.name, dataset_version: cfg.version, engine: ENGINE_VERSION, license_track: cfg.license_track,
      config: cfg, task_types: TASK_TYPES, updated_at: new Date().toISOString(), splits: { ...prev.splits, ...summary },
    }, null, 2));
  }
  for (const [s, v] of Object.entries(summary)) {
    console.log(`${s}: ${v.samples} samples, ${v.scenes} scenes, ${v.images} images`);
    for (const [t, c] of Object.entries(v.by_task)) console.log(`   ${t.padEnd(18)} ${Object.entries(c).map(([l, n]) => `${l}=${n}`).join(' ')}`);
  }
  console.log(dry ? 'dry run: nothing written' : `written to ${outDir}`);
}

// Only run when executed directly (the helpers above are imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(new URL(import.meta.url).pathname), 'build-dataset.ts')) {
  main().catch((e) => {
    console.error(`\nERROR: ${e.message}`);
    process.exit(1);
  });
}
