import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import config from './playwright.config';
import { acceptanceConnections } from './scripts/acceptance-safety.mjs';

const connections = acceptanceConnections();
const output = process.env.ACCEPTANCE_OUTPUT_DIR ?? 'test-results/acceptance';
export default defineConfig({
  ...config,
  metadata: { acceptance: true },
  retries: 0,
  outputDir: path.join(output, 'browser'),
  reporter: [['json', { outputFile: path.join(output, 'browser-raw.json') }], ['dot']],
  use: { ...config.use, trace: 'off' },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: false, timeout: 120000,
    env: { DATABASE_URL: connections.runtime, TEST_DATABASE_URL: connections.owner,
      AUTH_SECRET: randomBytes(32).toString('hex'), NEXTAUTH_URL: 'http://127.0.0.1:3100', ACCEPTANCE_MODE: 'true' },
  },
});
