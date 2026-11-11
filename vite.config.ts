import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base keeps the static build portable: it works at a domain root and
// under any GitHub Pages sub-path (https://<user>.github.io/<repo>/) unchanged.
// Override with VITE_BASE=/my-repo/ if absolute asset URLs are required.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1400 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
