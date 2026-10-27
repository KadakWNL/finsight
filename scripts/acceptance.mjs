import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import pg from 'pg';
import { acceptanceConnections, assertFreshAcceptanceDatabase } from './acceptance-safety.mjs';
import { evaluateMatrix, vitestRecords, playwrightRecords } from './acceptance-matrix.mjs';
import { applyMigrations, discoverMigrations } from './migration-runner.mjs';

if (existsSync('.env.local')) loadEnvFile('.env.local');
const runId = new Date().toISOString().replace(/[^0-9]/g, '') + '-' + randomBytes(3).toString('hex');
const output = path.resolve('test-results/acceptance', runId);
const stages = [];
const records = [];
const started = new Date().toISOString();
let owner;
let runtime;
let environment;
let failure;
let ownsSchema = false;
let childEnv;

await mkdir(output, { recursive: true });

function sanitize(text) {
  let result = String(text).replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[database URL omitted]');
  for (const name of ['TEST_DATABASE_URL', 'ACCEPTANCE_RUNTIME_DATABASE_URL']) {
    try {
      const secret = decodeURIComponent(new URL(process.env[name]).password);
      if (secret) result = result.replaceAll(secret, '[omitted]');
    } catch { /* Invalid inputs are rejected before execution. */ }
  }
  return result;
}

async function stage(id, command, args, label) {
  console.log(`Acceptance: ${id} started.`);
  const start = performance.now();
  const result = await new Promise(resolve => {
    const child = spawn(command, args, { env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', value => { log += value; });
    child.stderr.on('data', value => { log += value; });
    child.on('error', error => resolve({ code: 1, log: `${log}\nTool could not start: ${error.code}` }));
    child.on('close', code => resolve({ code: code ?? 1, log }));
  });
  await writeFile(path.join(output, `${id}.log`), sanitize(result.log));
  stages.push({ id, command: label, status: result.code === 0 ? 'passed' : 'failed', exitCode: result.code, durationMs: Math.round(performance.now() - start) });
  console.log(`Acceptance: ${id} ${result.code === 0 ? 'passed' : 'failed'}.`);
  if (result.code !== 0) throw new Error(`Acceptance stage ${id} failed; inspect ${path.relative(process.cwd(), output)}/${id}.log.`);
}

async function resetSchema() {
  if (!ownsSchema) throw new Error('Schema reset refused before fresh-database verification.');
  await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

async function migrate() {
  const migrations = new URL('../migrations/', import.meta.url);
  await applyMigrations(owner, migrations);
  await applyMigrations(owner, migrations);
}

async function sourceRevision() {
  const revision = { commit: 'unavailable', dirty: true, hashes: {} };
  try {
    revision.commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    revision.dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  } catch { /* Exported source trees still have file hashes. */ }
  const directories = ['scripts', 'src', 'tests', 'migrations'];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (/\.(?:ts|tsx|mjs|sql)$/.test(filename)) revision.hashes[filename.replaceAll('\\', '/')] = createHash('sha256').update(await readFile(filename)).digest('hex');
    }
  }
  for (const directory of directories) await visit(directory);
  for (const filename of ['package-lock.json', 'playwright.config.ts', 'playwright.acceptance.config.ts', 'vitest.config.ts', 'next.config.ts']) {
    revision.hashes[filename] = createHash('sha256').update(await readFile(filename)).digest('hex');
  }
  return revision;
}

try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Acceptance requires Node.js 24.');
  const connections = acceptanceConnections();
  owner = new pg.Client({ connectionString: connections.owner, connectionTimeoutMillis: 5000 });
  runtime = new pg.Client({ connectionString: connections.runtime, connectionTimeoutMillis: 5000 });
  await owner.connect();
  await runtime.connect();
  environment = await assertFreshAcceptanceDatabase(owner, runtime);
  ownsSchema = true;
  await runtime.end();
  runtime = undefined;
  const url = new URL(connections.owner);
  childEnv = { ...process.env, TEST_DATABASE_URL: connections.owner, ACCEPTANCE_RUNTIME_DATABASE_URL: connections.runtime,
    DATABASE_URL: connections.runtime, MIGRATOR_DATABASE_URL: connections.owner,
    ALLOW_TEST_DATABASE: 'true', ALLOW_SYNTHETIC_SEED: 'true', NEXT_TELEMETRY_DISABLED: '1',
    AUTH_SECRET: randomBytes(32).toString('hex'), PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: '5', ACCEPTANCE_PLAN_OUTPUT: path.join(output, 'query-plans.json'), ACCEPTANCE_OUTPUT_DIR: output };
  delete childEnv.NEXTAUTH_URL;

  await stage('unit', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--project', 'unit'], 'npm run test:unit');
  await stage('build', process.execPath, ['node_modules/next/dist/bin/next', 'build'], 'npm run build');
  for (const project of ['api', 'db']) {
    await resetSchema();
    const report = path.join(output, `${project}-raw.json`);
    await stage(project, process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--project', project, '--reporter=json', `--outputFile=${report}`], `npm run test:${project} -- --reporter=json`);
    records.push(...vitestRecords(JSON.parse(await readFile(report, 'utf8')), project));
  }

  await resetSchema();
  await stage('financial-schema', 'psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', 'migrations/010_financial_baseline.sql'], 'psql --single-transaction -f migrations/010_financial_baseline.sql');
  await stage('financial-baseline', 'psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-f', 'tests/sql/financial_baseline.sql'], 'psql -X -v ON_ERROR_STOP=1 -f tests/sql/financial_baseline.sql');
  await stage('operational-schema', 'psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', 'migrations/020_operational_schema.sql'], 'psql --single-transaction -f migrations/020_operational_schema.sql');
  await stage('operational-sql', 'psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-f', 'tests/sql/operational_schema.sql'], 'psql -X -v ON_ERROR_STOP=1 -f tests/sql/operational_schema.sql');
  await resetSchema();
  await migrate();
  const sqlFiles = [['financial-sql', 'financial_guards.sql'], ['case-sql', 'case_guards.sql']];
  for (const [id, filename] of sqlFiles) {
    await stage(id, 'psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-v', 'runtime_role=finsight_runtime', '-f', `tests/sql/${filename}`], `psql -X -v ON_ERROR_STOP=1 -v runtime_role=finsight_runtime -f tests/sql/${filename}`);
  }
  await stage('risk', process.execPath, ['--conditions=react-server', 'tests/risk-verification.mjs'], 'node --conditions=react-server tests/risk-verification.mjs');
  await resetSchema();
  await migrate();
  await stage('financial-plans', process.execPath, ['tests/financial-verification.mjs'], 'node tests/financial-verification.mjs');
  await resetSchema();
  await stage('browser', process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.acceptance.config.ts'], 'playwright test --config playwright.acceptance.config.ts');
  records.push(...playwrightRecords(JSON.parse(await readFile(path.join(output, 'browser-raw.json'), 'utf8'))));
} catch (error) {
  failure = error instanceof Error && /^(Acceptance|Provision|Schema)/.test(error.message)
    ? error.message : 'Acceptance could not complete; inspect the isolated test setup and stage logs.';
  console.error(failure);
} finally {
  if (runtime) await runtime.end().catch(() => {});
  if (owner) await owner.end().catch(() => {});
}

const scenarios = evaluateMatrix(stages, records);
const passed = !failure && scenarios.every(value => value.status === 'passed') && stages.every(value => value.status === 'passed');
const report = { startedAt: started, completedAt: new Date().toISOString(), technicalStatus: passed ? 'passed' : 'blocking',
  reviewStatus: 'pending_teammate_cross_review', mvpComplete: false, environment,
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  source: await sourceRevision(), fixtures: 'scripts/financial-seed.mjs',
  migrations: (await discoverMigrations(new URL('../migrations/', import.meta.url))).map(({ filename, checksum }) => ({ filename, checksum })),
  stages, scenarios, defects: failure ? [{ status: 'blocking', summary: failure }]
    : scenarios.filter(value => value.status === 'blocking').map(value => ({ status: 'blocking', summary: `${value.id} has missing or nonpassing required evidence.` })),
  limitations: ['Teammate contract/acceptance sign-off is required separately.', 'MongoDB and full academic acceptance remain outside this MVP run.'] };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const lines = ['# MVP acceptance result', '', `Technical result: ${report.technicalStatus}. Human cross-review: pending.`, '',
  '| Scenario | Responsible workstream | Result |', '|---|---|---|',
  ...scenarios.map(value => `| ${value.id}: ${value.title} | ${value.owner} | ${value.status} |`), '',
  'Detailed evidence, commands and source hashes: report.json. Query plans: query-plans.json.',
  'Browser recordings are under browser/. Raw logs and runner reports are local debugging artifacts; publish only the sanitized report and synthetic videos.', ''];
await writeFile(path.join(output, 'report.md'), lines.join('\n'));
await writeFile(path.resolve('test-results/acceptance/latest.json'), JSON.stringify({ runDirectory: path.relative(process.cwd(), output), technicalStatus: report.technicalStatus }, null, 2) + '\n');
console.log(`VS01-VS16 technical result: ${report.technicalStatus}. Teammate review remains pending.`);
console.log(`Evidence: ${path.relative(process.cwd(), output)}/report.json and report.md`);
if (!passed) process.exitCode = 1;
