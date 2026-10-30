import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { requireTestDatabase } from '../database-safety.mjs';
import { applyMigrations, discoverMigrations } from '../migration-runner.mjs';
import { DEVICE_TELEMETRY_VALIDATOR, DEVICE_TELEMETRY_INDEXES } from '../telemetry-schema.mjs';

const connectionString = requireTestDatabase({ ...process.env, TEST_DATABASE_URL: process.env.DIAGRAM_DATABASE_URL || process.env.TEST_DATABASE_URL });
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  await applyMigrations(client, new URL('../../migrations/', import.meta.url));
  const tables = (await client.query(`SELECT c.relname AS name,c.relkind AS kind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','v') ORDER BY c.relname`)).rows;
  for (const table of tables) {
    table.columns = (await client.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null,a.attgenerated<>'' AS generated,a.attidentity<>'' AS identity,
      pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=('public.'||$1)::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table.name])).rows;
    table.constraints = (await client.query(`SELECT conname AS name,contype AS type,pg_get_constraintdef(oid) AS definition,
      ARRAY(SELECT attname::text FROM unnest(conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
      CASE WHEN contype='f' THEN confrelid::regclass::text END AS references_table,
      CASE WHEN contype='f' THEN ARRAY(SELECT attname::text FROM unnest(confkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=confrelid AND a.attnum=k.num ORDER BY k.ord) END AS references_columns
      FROM pg_constraint WHERE conrelid=('public.'||$1)::regclass ORDER BY contype,conname`, [table.name])).rows;
  }
  const catalog = { title: 'FinSight', members: ['Shrikar Desai', 'Shreyas P Kulkarni'],
    sourceCommit: execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(),
    postgresVersion: (await client.query('SHOW server_version')).rows[0].server_version,
    migrations: (await discoverMigrations(new URL('../../migrations/', import.meta.url))).map(({ filename, checksum }) => ({ filename, checksum })),
    tables, mongo: { collection: 'device_telemetry', validator: DEVICE_TELEMETRY_VALIDATOR, indexes: DEVICE_TELEMETRY_INDEXES } };
  await writeFile(new URL('../../docs/printable/schema-catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n');
  console.log(tables.map(table => ({ name: table.name, kind: table.kind, attributes: table.columns.length })));
} finally { await client.end(); }
