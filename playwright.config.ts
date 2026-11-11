import { defineConfig } from '@playwright/test';

// Smoke test against the production build. Uses the locally installed Google
// Chrome (channel: 'chrome') so no browser download is required. If Chrome is
// not installed, run `npx playwright install chromium` and remove `channel`.
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] },
  },
  webServer: [
    { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
    // Optional model server. The app must work whether or not a model runtime (Ollama) is running behind it.
    { command: 'npm run model-server', url: 'http://127.0.0.1:8787/health', reuseExistingServer: true, timeout: 30_000 },
  ],
});
