import pg from 'pg';
import { requireTestDatabase } from './database-safety.mjs';
import { applyMigrations } from './migration-runner.mjs';

let client;
try {
  const connectionString = process.argv.includes('--test') ? requireTestDatabase() : process.env.MIGRATOR_DATABASE_URL;
  if (!connectionString) throw new Error('MIGRATOR_DATABASE_URL is required; application credentials are never used for migrations.');
  client = new pg.Client({ connectionString });
  await client.connect();
  const { rows } = await client.query('SHOW server_version_num');
  if (Math.floor(Number(rows[0].server_version_num) / 10000) !== 17) throw new Error('PostgreSQL 17 is required.');
  const count = await applyMigrations(client, new URL('../migrations/', import.meta.url));
  console.log(`Migration files verified: ${count}.`);
} catch (error) {
  const safe = error instanceof Error && /^(Set TEST_|Tests require|MIGRATOR_|PostgreSQL 17|Applied migration|Duplicate migration|Cannot apply|Migration \d)/.test(error.message);
  console.error(safe ? error.message : 'Database migration failed. Check connectivity and migrator privileges; connection details omitted.');
  process.exitCode = 1;
} finally {
  if (client) await client.end();
}
