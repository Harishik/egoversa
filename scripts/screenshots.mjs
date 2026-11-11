// Captures README screenshots from a running instance (default: the dev server).
//   npm run dev            (in one terminal)
//   npm run screenshots    (in another)
import { chromium } from '@playwright/test';

const url = process.env.EGOVERSA_URL ?? 'http://localhost:5173/';
const out = 'docs/screenshots';
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('saved', name); };

await page.goto(url);
await page.waitForSelector('canvas');
await page.waitForTimeout(3000);
await shot('01-hero');
await page.getByRole('button', { name: 'Open the lab' }).click();
await page.waitForTimeout(1200);
await page.locator('tbody tr').nth(2).click();
await page.waitForTimeout(800);
await shot('02-scene-lab');
await page.getByRole('button', { name: /Compact room/ }).click();
await page.waitForTimeout(1500);
await shot('02b-room');
await page.getByRole('button', { name: /Shelf & workbench/ }).click();
await page.waitForTimeout(1500);
await shot('02c-workbench');
await page.getByRole('button', { name: /Tabletop/ }).click();
await page.waitForTimeout(800);
await page.keyboard.press('v');
await page.waitForTimeout(2500);
await shot('03-viewer-eyes');
await page.keyboard.press('v');
await page.getByTestId('nav-arena').click();
await page.getByTestId('generate-questions').click();
await page.waitForTimeout(1500);
await page.getByLabel('Question type').selectOption('obs_lateral');
await page.waitForTimeout(800);
await page.getByTestId('option-0').click();
await page.waitForTimeout(800);
await page.getByTestId('model-select').selectOption('qwen3.5-0.8b-base');
if (await page.getByTestId('ask-model').count()) {
  await page.getByTestId('ask-model').click();
  await page.getByTestId('model-reply').waitFor({ timeout: 120000 });
}
await page.getByTestId('model-panel').scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await shot('04-question-arena');
await page.getByTestId('nav-bench').click();
await page.getByTestId('run-benchmark').click();
await page.getByTestId('bench-items').waitFor({ timeout: 120000 });
await page.waitForTimeout(600);
await shot('05-benchmark');
await page.getByTestId('failures').scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await shot('06-failure-gallery');
await page.getByTestId('failure-card').first().click();
await page.waitForTimeout(2000);
await shot('07-playback');
await page.keyboard.press('Escape');
await page.getByTestId('theta-section').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot('05b-perspective');
await page.getByTestId('nav-models').click();
await page.getByTestId('task-table').waitFor({ timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
await shot('10-models');
await page.getByTestId('behaviour-table').scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(400);
await shot('11-models-behaviour');
await page.getByTestId('sample-explorer').scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(1500);
await shot('12-sample-explorer');
if (process.env.MOBILE) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('nav-lab').click();
  await page.waitForTimeout(1500);
  await shot('08-mobile-lab');
  await page.getByTestId('nav-bench').click();
  await page.waitForTimeout(800);
  await shot('09-mobile-bench');
}
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
