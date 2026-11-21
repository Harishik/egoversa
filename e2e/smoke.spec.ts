import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('main flows work end to end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));

  await page.goto('/');
  // Hero lives inside the working app, over the live viewport.
  await expect(page.getByRole('heading', { name: /Same world/ })).toBeVisible();
  await expect(page.locator('[data-testid=viewport] canvas').first()).toBeVisible();
  await page.getByRole('button', { name: 'Open the lab' }).click();
  await expect(page.getByRole('heading', { name: /Same world/ })).toBeHidden();

  // The 3D viewport actually draws something (not a blank canvas).
  const distinctColours = () =>
    page.evaluate(() => {
      const c = document.querySelector('figure canvas') as HTMLCanvasElement | null; // viewer inset, preserveDrawingBuffer
      if (!c) return 0;
      const tmp = document.createElement('canvas');
      tmp.width = 64;
      tmp.height = 48;
      const ctx = tmp.getContext('2d')!;
      ctx.drawImage(c, 0, 0, 64, 48);
      const d = ctx.getImageData(0, 0, 64, 48).data;
      const px = new Set<string>();
      for (let i = 0; i < d.length; i += 4) px.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      return px.size;
    });
  await expect.poll(distinctColours, { timeout: 20_000 }).toBeGreaterThan(8);

  // Switch scene: fingerprint changes; same seed reproduces it.
  const fp = page.getByTestId('fingerprint');
  const tabletop = await fp.textContent();
  await page.getByRole('button', { name: /Compact room/ }).click();
  await expect(fp).not.toHaveText(tabletop!);
  await page.getByRole('button', { name: /Tabletop/ }).click();
  await expect(fp).toHaveText(tabletop!);

  // Move the camera with the keyboard and with a preset.
  const pose = page.getByTestId('pose-readout');
  const before = await pose.textContent();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(pose).not.toHaveText(before!);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(pose).toContainText('az 180°');
  await page.getByRole('radio', { name: 'Viewer’s eyes' }).click();
  await expect(page.getByText('You are looking through the viewer camera')).toBeVisible();
  await page.getByRole('radio', { name: 'World view' }).click();

  // Save + export a scenario.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTitle('Load this scenario')).toHaveCount(1);
  const [scenario] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  const scenarioJson = JSON.parse(readFileSync((await scenario.path())!, 'utf8'));
  expect(scenarioJson.format).toBe('egoversa.scenario');
  expect(scenarioJson.fingerprint).toBe(tabletop);
  expect(scenarioJson.viewer.azimuthDeg).toBe(180);

  // Question Arena: generate, answer, see ground truth vs predictions.
  await page.getByTestId('nav-arena').click();
  await page.getByTestId('generate-questions').click();
  await expect(page.getByTestId('question-text')).toBeVisible();
  expect(Number((await page.getByTestId('question-count').textContent())!.split(' ')[0])).toBeGreaterThan(0);
  await page.getByTestId('option-0').click();
  const reveal = page.getByTestId('reveal');
  await expect(reveal).toContainText('Geometric ground truth');
  await expect(reveal).toContainText('World-axis heuristic');
  await expect(page.getByTestId('arena-score')).toContainText('/1');
  const q1 = await page.getByTestId('question-text').textContent();
  await page.getByTestId('next-question').click();
  await expect(page.getByTestId('question-text')).not.toHaveText(q1!);

  // Physics Lab: recorded MuJoCo scenes replay, what-if rollouts list real displacements, oracle questions shown.
  await page.getByTestId('nav-physics').click();
  await expect(page.getByTestId('physics-lab')).toContainText('MuJoCo');
  await expect(page.getByTestId('physics-viewport').locator('canvas')).toBeVisible();
  await page.getByTestId('rollout-button').first().click();
  await expect(page.getByTestId('physics-lab')).toContainText('were removed?');
  await expect(page.getByTestId('physics-questions')).toContainText('Answer');
  await page.getByTestId('nav-arena').click();

  // Real model in the arena: either a genuine reply, or an explicit "not available" — never a canned answer.
  const panel = page.getByTestId('model-panel');
  await expect(panel).toContainText('Answer with a model');
  const listing = await (await page.request.get('http://127.0.0.1:8787/models')).json();
  const base = listing.models.find((m: { id: string }) => m.id === 'qwen3.5-0.8b-base');
  await page.getByTestId('model-select').selectOption('spatialaxiom-9b');
  await expect(page.getByTestId('model-unavailable')).toContainText('Not available on this machine');
  await expect(panel).toContainText('non-commercial');
  await page.getByTestId('model-select').selectOption('qwen3.5-0.8b-base');
  if (base.available) {
    await page.getByTestId('ask-model').click();
    const reply = page.getByTestId('model-reply');
    await expect(reply).toBeVisible({ timeout: 120_000 });
    await expect(reply).toContainText('Parsed answer');
    await expect(reply).toContainText(' ms');
  } else {
    await expect(page.getByTestId('model-unavailable')).toBeVisible();
  }

  // Models workspace: registry with live availability, and real result files if any exist.
  await page.getByTestId('nav-models').click();
  await expect(page.getByTestId('registry')).toContainText('Qwen/Qwen3.5-0.8B');
  await expect(page.getByTestId('registry')).toContainText('cc-by-nc-4.0');
  if ((await page.getByTestId('run-list').count()) > 0) {
    await expect(page.getByTestId('task-table')).toContainText('Left / right (camera)');
    await expect(page.getByTestId('behaviour-table')).toContainText('Left/right inversion');
    await expect(page.getByTestId('sample-explorer').locator('img').first()).toBeVisible();
  }

  // Benchmark: run, read real numbers, open a failure, export.
  await page.getByTestId('nav-bench').click();
  await expect(page.getByText('No measurements yet')).toBeVisible();
  await page.getByTestId('run-benchmark').click();
  const items = page.getByTestId('bench-items');
  await expect(items).toBeVisible({ timeout: 90_000 });
  expect(Number(await items.textContent())).toBeGreaterThan(500);
  await expect(page.getByTestId('theta-section')).toContainText('Perspective taking');
  await expect(page.getByTestId('theta-section').locator('svg[role=img]')).toBeVisible();
  await page.getByTestId('failure-card').first().click();
  const playback = page.getByTestId('playback');
  await expect(playback).toContainText('Geometric ground truth');
  await expect(playback.locator('canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(playback).toBeHidden();
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const csvText = readFileSync((await csv.path())!, 'utf8');
  expect(csvText.split('\n')[0]).toContain('pred_world');
  expect(csvText.trim().split('\n').length).toBe(Number(await items.textContent()) + 1);
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  expect(JSON.parse(readFileSync((await json.path())!, 'utf8')).summary.overall.oracle.acc).toBe(1);
  const [report] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export report' }).click()]);
  expect(readFileSync((await report.path())!, 'utf8')).toContain('No vision-language model was evaluated');

  // About panel and guided tour.
  await page.getByTestId('open-about').click();
  await expect(page.getByTestId('about')).toContainText('Ground truth is not a prediction');
  await page.getByRole('button', { name: 'Start the guided tour' }).click();
  await expect(page.getByTestId('tour')).toContainText('Step 1 of');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('tour')).toContainText('Step 2 of');
  await page.getByRole('button', { name: 'End tour' }).click();

  // Saved scenario survives a reload (local persistence).
  await page.reload();
  await expect(page.getByTitle('Load this scenario')).toHaveCount(1);

  expect(errors, errors.join('\n')).toEqual([]);
});
