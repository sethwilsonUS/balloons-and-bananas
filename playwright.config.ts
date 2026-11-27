import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 3103;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx next start --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/api/catalog`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      ARCHIVE_LOCAL_DATA: path.resolve('tests/fixtures/archive.json'),
      ARCHIVE_LOCAL_ASSETS_DIR: path.resolve('tests/fixtures/files'),
      VERCEL: '',
      VERCEL_ENV: '',
      VERCEL_URL: '',
      VERCEL_OIDC_TOKEN: '',
      BLOB_READ_WRITE_TOKEN: '',
      ARCHIVE_DATA_PATH: '',
    },
  },
});
