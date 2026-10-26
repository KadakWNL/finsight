import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

if (existsSync('.env.local')) loadEnvFile('.env.local');
process.env.AUTH_SECRET = randomBytes(32).toString('hex');

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          testTimeout: 15000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
