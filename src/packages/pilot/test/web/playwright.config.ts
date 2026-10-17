import os from 'node:os'
import path from 'node:path'
import { defineConfig } from '@stablyai/playwright-test'

// Pilot's browser-version check: one headless serve process and one headless Chromium, never in CI.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: path.join(os.tmpdir(), 'pilot-web-pages-results'),
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
