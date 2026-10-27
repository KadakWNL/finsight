import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomBytes } from 'node:crypto';
import { requireTestDatabase } from './scripts/database-safety.mjs';

if (existsSync('.env.local')) loadEnvFile('.env.local');
const databaseUrl = requireTestDatabase();
const testSecret = randomBytes(32).toString('hex');

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    env: { DATABASE_URL: databaseUrl, AUTH_SECRET: testSecret, NEXTAUTH_URL: 'http://127.0.0.1:3100' },
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
