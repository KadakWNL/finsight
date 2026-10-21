import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { expect, test } from 'vitest';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';

test('migration retries, checksum validation and rollback against PostgreSQL 17', async () => {
  const client = new pg.Client({ connectionString: requireTestDatabase() });
  const directory = await mkdtemp(join(tmpdir(), 'finsight-migrations-'));
  const url = pathToFileURL(directory + '/');
  let ownsObjects = false;
  try {
    await client.connect();
    const version = await client.query('SHOW server_version_num');
    expect(Math.floor(Number(version.rows[0].server_version_num) / 10000)).toBe(17);
    const role = await client.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
    expect(role.rows[0].rolsuper).toBe(false);
    const existing = await client.query("SELECT to_regclass('public.schema_migrations') AS ledger");
    if (existing.rows[0].ledger) throw new Error('Migration harness requires a fresh disposable database.');
    ownsObjects = true;
    await writeFile(new URL('001_probe.sql', url), 'CREATE TABLE public.migration_probe (id integer PRIMARY KEY);');
    expect(await applyMigrations(client, url)).toBe(1);
    expect(await applyMigrations(client, url)).toBe(1);
    await writeFile(new URL('002_failure.sql', url), 'CREATE TABLE public.failed_probe (id integer); SELECT 1/0;');
    await expect(applyMigrations(client, url)).rejects.toThrow('rolled back');
    const failed = await client.query("SELECT to_regclass('public.failed_probe') AS probe");
    expect(failed.rows[0].probe).toBeNull();
    expect((await client.query('SELECT version FROM public.schema_migrations')).rows).toEqual([{ version: '001' }]);
    await writeFile(new URL('001_probe.sql', url), 'SELECT 1;');
    await expect(applyMigrations(client, url)).rejects.toThrow('missing or changed');
  } finally {
    if (ownsObjects) await client.query('DROP TABLE IF EXISTS public.migration_probe, public.schema_migrations');
    await client.end();
    await rm(directory, { recursive: true, force: true });
  }
});
