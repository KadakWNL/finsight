import pg from 'pg';
import { requireSyntheticDatabase } from './database-safety.mjs';
import { seedFinancial } from './financial-seed.mjs';

let client;
try {
  client = new pg.Client({ connectionString: requireSyntheticDatabase() });
  await client.connect();
  const major = Math.floor(Number((await client.query('SHOW server_version_num')).rows[0].server_version_num) / 10000);
  if (major !== 17) throw new Error('PostgreSQL 17 is required.');
  const role = (await client.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
  if (role.rolsuper) throw new Error('Synthetic seeds require a non-superuser migrator.');
  await seedFinancial(client);
  console.log('Verified eight synthetic financial scenarios and once-only risk signals.');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  console.error(/^(Set MIGRATOR_|Seeds require|Synthetic seed conflict|Synthetic seeds require|PostgreSQL 17)/.test(message)
    ? message : 'Synthetic seed failed and was rolled back; connection details omitted.');
  process.exitCode = 1;
} finally {
  if (client) await client.end();
}
