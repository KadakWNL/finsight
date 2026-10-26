import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

if (existsSync('.env.local')) loadEnvFile('.env.local');

export default defineConfig({ test: { projects: [
  { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
  { test: { name: 'db', include: ['tests/db/**/*.test.ts'], testTimeout: 15000, fileParallelism: false } },
  { test: { name: 'api', include: ['tests/api/**/*.test.ts'] } },
] } });
