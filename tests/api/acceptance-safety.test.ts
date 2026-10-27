import { expect, test } from 'vitest';
import pg from 'pg';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { assertFreshAcceptanceDatabase } from '../../scripts/acceptance-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';

test('acceptance refuses a populated test database without changing its sentinel or migration ledger', async () => {
  const owner = new pg.Client({ connectionString: requireTestDatabase() });
  const runtime = new pg.Client({ connectionString: requireTestDatabase() });
  await owner.connect();
  await runtime.connect();
  try {
    await applyMigrations(owner, new URL('../../migrations/', import.meta.url));
    await owner.query('CREATE TABLE public.acceptance_preserved_probe(id integer PRIMARY KEY); INSERT INTO public.acceptance_preserved_probe VALUES (17)');
    const before = (await owner.query('SELECT * FROM public.schema_migrations ORDER BY version')).rows;
    await runtime.query('SET ROLE finsight_auth_probe');
    await expect(assertFreshAcceptanceDatabase(owner, runtime)).rejects.toThrow('fresh empty test database');
    expect((await owner.query('SELECT * FROM public.acceptance_preserved_probe')).rows).toEqual([{ id: 17 }]);
    expect((await owner.query('SELECT * FROM public.schema_migrations ORDER BY version')).rows).toEqual(before);
  } finally {
    await runtime.end();
    await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await owner.end();
  }
});
