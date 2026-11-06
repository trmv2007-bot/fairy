import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 0,
  // Electron e2e on Linux CI needs a virtual display; run via `xvfb-run -a npm run test:e2e`.
  use: { headless: true },
});
