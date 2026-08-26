import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.join(currentDir, 'tests'),
  globalSetup: path.join(currentDir, 'tools/global-setup.ts'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: path.join(currentDir, 'artifacts/test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(currentDir, 'artifacts/html-report'), open: 'never' }],
    ['junit', { outputFile: path.join(currentDir, 'artifacts/junit.xml') }],
  ],
  use: {
    baseURL: process.env.POS_QA_BASE_URL || 'http://localhost:5275',
    storageState: path.join(currentDir, '.auth/owner-a.json'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
  },
  projects: [
    {
      name: 'chromium-desktop',
      grepInvert: /@responsive/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      grep: /@responsive/,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'webkit-smoke',
      grep: /@webkit/,
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
});

