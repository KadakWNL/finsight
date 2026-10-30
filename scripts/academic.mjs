import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { acceptanceConnections, assertFreshAcceptanceDatabase } from './acceptance-safety.mjs';
import { academicMongoConnection } from './academic-safety.mjs';
import { demonstrateAcademicSql } from './academic-sql.mjs';
import { seedMongoTelemetry } from './mongo-telemetry-seed.mjs';
import { TELEMETRY_COLLECTION } from './telemetry-schema.mjs';
import { syntheticId } from './financial-seed.mjs';
import { vitestRecords, playwrightRecords } from './acceptance-matrix.mjs';

if (existsSync('.env.local')) loadEnvFile('.env.local');
const runId = `${Date.now()}_${randomBytes(6).toString('hex')}`;
const output = path.resolve('test-results/academic', runId);
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), technicalStatus: 'blocking', academicComplete: false,
  humanGates: { instructorDeleteAcceptance: 'pending', independentShrikarDemonstration: 'pending', teammateReview: 'pending' },
  checks: [], defects: [], limitations: [
    'The project owner approved the SQL DELETE scope; instructor acceptance has not been confirmed.',
    'Merged implementation and automated tests do not prove an independent teammate demonstration or academic originality.',
    'The timed final report/demo and independent clean-machine setup remain separate under #19.',
    'Vector retrieval, Mongo notes/recovery, rule edits and redaction are deferred and are not counted as delivered.',
  ] };
let owner;
let runtime;
let mongo;
let mongoDatabase;
let ownsMongo = false;
let acceptance;

async function check(id, action) {
  console.log(`Academic: ${id} started.`);
  try {
    const evidence = await action();
    report.checks.push({ id, status: 'passed', evidence });
    console.log(`Academic: ${id} passed.`);
    return evidence;
  } catch (error) {
    report.checks.push({ id, status: 'blocking', errorCode: error.code ?? error.name });
    throw error;
  }
}

try {
  const connections = acceptanceConnections();
  const mongoConfig = academicMongoConnection(process.env, runId);
  owner = new pg.Client({ connectionString: connections.owner, connectionTimeoutMillis: 5000 });
  runtime = new pg.Client({ connectionString: connections.runtime, connectionTimeoutMillis: 5000 });
  await owner.connect();
  await runtime.connect();
  report.environment = await check('fresh-postgres-and-role-isolation', () => assertFreshAcceptanceDatabase(owner, runtime));
  mongo = new MongoClient(mongoConfig.uri, { serverSelectionTimeoutMS: 3000 });
  await mongo.connect();
  mongoDatabase = mongo.db(mongoConfig.database);
  assert.equal((await mongoDatabase.listCollections().toArray()).length, 0, 'Academic Mongo database must be new and empty.');
  ownsMongo = true;
  report.runtime = { node: process.version, platform: process.platform, mongoVersion: (await mongoDatabase.admin().serverInfo()).version };

  await check('mvp-and-full-regression', async () => {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/acceptance.mjs'], {
        env: { ...process.env, MONGODB_URI: mongoConfig.uri, MONGODB_DB_NAME: mongoConfig.database, MONGODB_TEST_DB_NAME: mongoConfig.database },
        stdio: 'inherit', windowsHide: true,
      });
      child.on('error', reject);
      child.on('close', resolve);
    });
    assert.equal(code, 0, 'MVP acceptance must pass before academic demonstrations.');
    const latest = JSON.parse(await readFile('test-results/acceptance/latest.json', 'utf8'));
    acceptance = JSON.parse(await readFile(path.join(latest.runDirectory, 'report.json'), 'utf8'));
    assert.equal(acceptance.technicalStatus, 'passed');
    assert.equal(acceptance.source.dirty, false, 'Run retained academic evidence from a clean committed checkout.');
    report.source = acceptance.source;
    report.migrations = acceptance.migrations;
    const api = vitestRecords(JSON.parse(await readFile(path.join(latest.runDirectory, 'api-raw.json'), 'utf8')), 'api');
    const db = vitestRecords(JSON.parse(await readFile(path.join(latest.runDirectory, 'db-raw.json'), 'utf8')), 'db');
    const browser = playwrightRecords(JSON.parse(await readFile(path.join(latest.runDirectory, 'browser-raw.json'), 'utf8')));
    const required = [...api, ...db, ...browser].filter(row => /(?:telemetry\.test|session-cleanup\.(?:test|spec))\.ts$/.test(row.file));
    for (const [stage, file] of [['api', 'telemetry.test.ts'], ['api', 'session-cleanup.test.ts'], ['db', 'session-cleanup.test.ts'], ['browser', 'session-cleanup.spec.ts']]) {
      assert.ok(required.some(row => row.stage === stage && row.file.endsWith(file)), `Missing required evidence: ${stage}/${file}`);
    }
    assert.ok(required.length > 0 && required.every(row => row.status === 'passed'), 'Required academic tests must execute and pass without skips/retries.');
    await copyFile(path.join(latest.runDirectory, 'query-plans.json'), path.join(output, 'query-plans.json'));
    return { command: 'npm run test:acceptance', directory: latest.runDirectory,
      scenarios: acceptance.scenarios.map(({ id, status }) => ({ id, status })),
      counts: { api: api.length, database: db.length, browser: browser.length }, requiredTests: required };
  });

  await check('ddl-dml-queries-and-protected-delete', async () => {
    const sql = await demonstrateAcademicSql(owner, runtime);
    await writeFile(path.join(output, 'sql-results.json'), JSON.stringify(sql, null, 2) + '\n');
    return { file: 'sql-results.json', demonstrations: sql.map(row => row.id) };
  });
  await check('indexes-and-full-text-search', async () => {
    const plans = JSON.parse(await readFile(path.join(output, 'query-plans.json'), 'utf8'));
    assert.equal(plans.length, 5);
    for (const item of plans) assert.ok(JSON.stringify(item.plan).includes(item.expectedIndex));
    return plans.map(({ name, expectedIndex }) => ({ name, expectedIndex }));
  });
  await check('merged-contribution-provenance', async () => {
    const text = await readFile('docs/academic/contributions.json', 'utf8');
    const records = JSON.parse(text);
    for (const record of records) {
      assert.match(record.mergeCommit, /^[0-9a-f]{40}$/);
      execFileSync('git', ['merge-base', '--is-ancestor', record.mergeCommit, 'HEAD'], { stdio: 'pipe', windowsHide: true });
      for (const file of record.files) execFileSync('git', ['cat-file', '-e', `${record.mergeCommit}:${file}`], { stdio: 'pipe', windowsHide: true });
    }
    for (const author of ['KadakWNL', 'ShrikarDesai07']) {
      const contributions = records.filter(row => row.author === author);
      assert.ok(contributions.filter(row => row.databaseIssue).length >= 2);
      assert.ok(contributions.some(row => row.files.some(file => file.startsWith('src/'))));
      assert.ok(contributions.some(row => row.files.some(file => file.startsWith('tests/'))));
    }
    return { ledger: 'docs/academic/contributions.json', sha256: createHash('sha256').update(text).digest('hex'), records,
      limitation: 'PR authorship and committed changes establish source provenance; independent demonstration and originality assessment remain human gates.' };
  });
  await check('mongo-heterogeneous-validator-and-aggregation', async () => {
    await seedMongoTelemetry(mongoDatabase);
    const collection = mongoDatabase.collection(TELEMETRY_COLLECTION);
    const subject = (await runtime.query('SELECT device_id,occurred_at FROM public.transaction WHERE transaction_id=$1', [syntheticId(105)])).rows[0];
    assert.equal(subject.device_id, syntheticId(40));
    const pipeline = [
      { $match: { device_id: subject.device_id, captured_at: { $lte: subject.occurred_at } } },
      { $sort: { captured_at: -1 } }, { $limit: 100 },
      { $group: { _id: '$shape_type', observations: { $sum: 1 }, earliest: { $min: '$captured_at' }, latest: { $max: '$captured_at' } } },
      { $sort: { _id: 1 } },
    ];
    const rows = await collection.aggregate(pipeline, { maxTimeMS: 2000 }).toArray();
    assert.deepEqual(rows.map(row => ({ shape: row._id, count: row.observations })), [
      { shape: 'client_environment', count: 6 }, { shape: 'connection_telemetry', count: 6 },
    ]);
    const valid = await collection.findOne({ shape_type: 'connection_telemetry' });
    await assert.rejects(collection.insertOne({ ...valid, _id: randomUUID(), payload: {} }), { code: 121 });
    const indexes = (await collection.indexes()).map(({ name, key }) => ({ name, key }));
    return { pipeline, rows, indexes, invalidPayloadRejectedWith: 121,
      appIntegrationEvidence: 'tests/api/telemetry.test.ts: SQL authority, reference checks, masking, time bound and outage fallback' };
  });
  report.technicalStatus = 'passed';
} catch (error) {
  // Errors can include database credentials or raw SQL parameters. Publish only a code and failed check.
  report.defects.push({ status: 'blocking', summary: 'Academic verification failed; inspect the failed check in the isolated setup.', errorCode: error.code ?? error.name });
  console.error('Academic verification is blocking. No completion is claimed.');
  process.exitCode = 1;
} finally {
  if (mongo && ownsMongo) await mongoDatabase.dropDatabase().catch(() => {});
  if (mongo) await mongo.close().catch(() => {});
  await Promise.allSettled([owner, runtime].filter(Boolean).map(client => client.end()));
}
report.completedAt = new Date().toISOString();
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(output, 'report.md'), [
  '# Academic verification result', '', `Technical result: ${report.technicalStatus}. Academic completion: pending human gates.`, '',
  '| Check | Result |', '|---|---|', ...report.checks.map(row => `| ${row.id} | ${row.status} |`), '',
  'SQL commands and actual results: sql-results.json. Index plans: query-plans.json. Source hashes and Mongo results: report.json.', '',
  ...report.limitations.map(line => `- ${line}`), '',
].join('\n'));
await writeFile('test-results/academic/latest.json', JSON.stringify({ directory: path.relative(process.cwd(), output), technicalStatus: report.technicalStatus }, null, 2) + '\n');
console.log(`Academic technical result: ${report.technicalStatus}. Evidence: ${path.relative(process.cwd(), output)}. Human gates remain separate.`);
