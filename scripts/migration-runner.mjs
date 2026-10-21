import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export async function discoverMigrations(directory) {
  const files = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const versions = new Set();
  return Promise.all(files.map(async filename => {
    const version = filename.slice(0, 3);
    if (versions.has(version)) throw new Error(`Duplicate migration version ${version}`);
    versions.add(version);
    const sql = await readFile(new URL(filename, directory), 'utf8');
    return { version, filename, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function applyMigrations(client, directory) {
  const migrations = await discoverMigrations(directory);
  await client.query('SELECT pg_advisory_lock(71048501)');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    const { rows } = await client.query('SELECT version, filename, checksum FROM public.schema_migrations ORDER BY version');
    const applied = new Map(rows.map(row => [row.version, row]));
    for (const row of rows) {
      const file = migrations.find(migration => migration.version === row.version);
      if (!file || file.filename !== row.filename || file.checksum !== row.checksum) {
        throw new Error(`Applied migration ${row.version} is missing or changed`);
      }
    }
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      if (rows.some(row => row.version > migration.version)) throw new Error('Cannot apply an older migration after a newer version');
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO public.schema_migrations (version, filename, checksum) VALUES ($1,$2,$3)', [migration.version, migration.filename, migration.checksum]);
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.filename} failed and was rolled back`);
      }
    }
    return migrations.length;
  } finally {
    await client.query('SELECT pg_advisory_unlock(71048501)');
  }
}
