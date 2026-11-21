import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Generous: GPU-less runners render WebGL in software at a few frames per second.
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
    // Allow CI/sandboxes with a preinstalled Chromium to reuse it: PW_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
