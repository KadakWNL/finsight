import { expect, test, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { acceptanceConnections } from '../../scripts/acceptance-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { seedFinancial, syntheticId } from '../../scripts/financial-seed.mjs';

test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } } });
const password = randomBytes(24).toString('hex');
const analyst = randomUUID();
const peer = randomUUID();
const admin = randomUUID();
const analystEmail = `acceptance_analyst_${analyst.slice(0, 8)}@synthetic.invalid`;
const adminEmail = `acceptance_admin_${admin.slice(0, 8)}@synthetic.invalid`;
const journeySubject = randomUUID();
const privateSubject = randomUUID();
const runtimeSubject = randomUUID();
const concurrencySubject = randomUUID();
let db: pg.Client;
let privateCase: string;

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: requireTestDatabase() });
  await db.connect();
  await applyMigrations(db, new URL('../../migrations/', import.meta.url));
  await seedFinancial(db);
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await db.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role)
    VALUES ($1,$2,$3,'Acceptance analyst','analyst'),($4,$7,$3,'Acceptance peer','analyst'),
      ($5,$6,$3,'Acceptance administrator','admin')`, [analyst, analystEmail, hash, peer, admin, adminEmail, `acceptance_peer_${peer.slice(0, 8)}@synthetic.invalid`]);
  for (const value of [journeySubject, privateSubject, runtimeSubject, concurrencySubject]) {
    await db.query(`INSERT INTO public.transaction(transaction_id,account_id,method_id,merchant_id,device_id,amount,currency_code,
      exchange_rate,direction,txn_type,status,occurred_at,merchant_country_code,description)
      SELECT $1,account_id,method_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,
        occurred_at,merchant_country_code,'Synthetic acceptance journey' FROM public.transaction WHERE transaction_id=$2`,
    [value, syntheticId(105)]);
    await db.query('SELECT public.score_transaction($1)', [value]);
  }
  privateCase = (await db.query(`SELECT * FROM public.execute_case_command('create',$1,gen_random_uuid(),repeat('d',64),
    NULL,NULL,$2,'low','Synthetic private-case fixture',NULL,NULL,$3)`, [peer, privateSubject, `ACCEPTANCE-PRIVATE-${privateSubject.slice(0, 8)}`])).rows[0].case_id;
});

test.afterAll(async () => { if (db) await db.end(); });

async function signIn(page: Page, email: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to FinSight' })).toBeVisible();
}

test('recorded analyst/admin investigation preserves evidence through review, escalation, outcome and reopen', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto('/transactions/' + journeySubject);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await signIn(page, analystEmail);
  await expect(page.getByRole('heading', { name: 'Transaction detail', exact: true })).toBeVisible();
  await expect(page.getByText('65 points · 2 signals', { exact: true })).toBeVisible();
  await page.goto('/cases/' + privateCase);
  await expect(page.getByRole('heading', { name: 'Case not found' })).toBeVisible();
  expect((await page.request.get('/api/v1/cases/' + privateCase)).status()).toBe(404);
  await expect(page.locator('body')).not.toContainText('ACCEPTANCE-PRIVATE');
  await page.goto('/transactions/' + journeySubject);
  await page.getByRole('button', { name: 'Create case', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Synthetic recorded investigation rationale');
  await page.getByRole('button', { name: 'Save case', exact: true }).click();
  await page.getByRole('link', { name: /^CASE-/ }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}/);
  const caseId = /\/cases\/([0-9a-f-]{36})/.exec(page.url())![1];
  await page.getByRole('button', { name: 'Start review', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Confirm start review', exact: true }).click();
  await expect(page.locator('.status-badge').first()).toContainText(/in review/i);
  await page.getByRole('button', { name: 'Escalate', exact: true }).click();
  await page.getByLabel('Operational escalation reason (required)').fill('Synthetic review requires administrative oversight');
  await page.getByRole('button', { name: 'Confirm escalation', exact: true }).click();
  await expect(page.locator('.status-badge').first()).toContainText(/escalated/i);
  await signOut(page);

  await signIn(page, adminEmail);
  await expect(page.getByRole('heading', { name: 'Team overview' })).toBeVisible();
  await page.goto('/cases?tab=escalated');
  await expect(page.getByRole('button', { name: 'Escalated', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/cases/' + caseId);
  await page.getByRole('button', { name: 'Return to review', exact: true }).click();
  await page.getByLabel('Return rationale (required)').fill('Synthetic administrative evidence cross-check complete');
  await page.getByRole('button', { name: 'Confirm return to review', exact: true }).click();
  await expect(page.locator('.status-badge').first()).toContainText(/in review/i);
  await page.getByRole('button', { name: 'Resolve case', exact: true }).click();
  await page.getByLabel('Resolution notes (required)').fill('Synthetic recorded confirmed-suspicious outcome');
  await page.getByRole('button', { name: 'Confirm resolution (Closed)', exact: true }).click();
  await expect(page.locator('.status-badge').first()).toContainText(/closed/i);
  const terminal = (await db.query("SELECT * FROM public.case_event WHERE case_id=$1 AND to_state->>'status'='closed'", [caseId])).rows[0];
  expect(terminal.reason).toBe('Synthetic recorded confirmed-suspicious outcome');
  await page.getByRole('button', { name: 'Reopen case', exact: true }).click();
  await page.getByLabel('Reopening operational rationale (required)').fill('Synthetic new evidence warrants another review');
  await page.getByRole('button', { name: /Confirm reopen/ }).click();
  await expect(page.locator('.status-badge').first()).toContainText(/open/i);
  await signOut(page);

  await signIn(page, analystEmail);
  await expect(page.getByRole('heading', { name: 'Your overview' })).toBeVisible();
  await page.goto('/cases/' + caseId);
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm start review', exact: true }).click();
  await expect(page.locator('.status-badge').first()).toContainText(/in review/i);
  await page.getByRole('button', { name: 'Dismiss case', exact: true }).click();
  await page.getByRole('radio', { name: /Insufficient evidence/ }).check();
  await page.getByLabel('Dismissal rationale notes (required)').fill('Synthetic evidence remains inconclusive after reopened review');
  await page.getByRole('button', { name: 'Confirm dismissal', exact: true }).click();
  await expect(page.locator('.status-badge').first()).toContainText(/dismissed/i);
  await expect(page.getByRole('heading', { name: 'Audit Event History' })).toBeVisible();
  const events = (await db.query('SELECT * FROM public.case_event WHERE case_id=$1 ORDER BY event_id', [caseId])).rows;
  expect(events).toContainEqual(terminal);
  expect(events[0].event_type).toBe('created');
  expect(events[1].event_type).toBe('assigned');
  expect(events[0].operation_id).toBe(events[1].operation_id);
  expect(events.every(event => !('reason' in event.to_state) && !('resolution_notes' in event.to_state))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('investigation-journey.png'), fullPage: true });
});

async function immutableDigest() {
  const result: Record<string, string> = {};
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('app_session','schema_migrations') ORDER BY tablename")).rows;
  for (const { tablename } of tables) {
    const identifier = '"' + String(tablename).replaceAll('"', '""') + '"';
    result[tablename] = (await db.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM public.${identifier} t`)).rows[0].digest;
  }
  return result;
}

test('VS14: two real tabs preserve an outcome draft when a concurrent transition removes that action', async ({ page }) => {
  await page.goto('/sign-in');
  await signIn(page, analystEmail);
  await expect(page.getByRole('heading', { name: 'Your overview' })).toBeVisible();
  const created = await page.request.post('/api/v1/cases', { headers: { origin: 'http://127.0.0.1:3100', 'idempotency-key': randomUUID() },
    data: { transaction_id: concurrencySubject, priority: 'high', reason: 'Synthetic two-tab conflict fixture' } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).data.case_id;
  await page.goto('/cases/' + id);
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm start review', exact: true }).click();
  await expect(page.locator('.status-badge').first()).toContainText(/in review/i);
  await page.getByRole('button', { name: 'Resolve case', exact: true }).click();
  const draft = page.getByLabel('Resolution notes (required)');
  await draft.fill('Synthetic draft must survive the other tab escalating this case');
  const second = await page.context().newPage();
  try {
    await second.goto('/cases/' + id);
    await second.getByRole('button', { name: 'Escalate', exact: true }).click();
    await second.getByLabel('Operational escalation reason (required)').fill('Synthetic escalation from the second tab');
    await second.getByRole('button', { name: 'Confirm escalation', exact: true }).click();
    await expect(second.locator('.status-badge').first()).toContainText(/escalated/i);
    const response = page.waitForResponse(value => value.url().endsWith('/commands') && value.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirm resolution (Closed)', exact: true }).click();
    expect((await response).status()).toBe(409);
    await expect(page.locator('.status-badge').first()).toContainText(/escalated/i);
    await expect(draft).toBeVisible();
    await expect(draft).toHaveValue('Synthetic draft must survive the other tab escalating this case');
    await expect(page.getByRole('button', { name: 'Confirm resolution (Closed)', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('main')).toBeFocused();
  } finally { await second.close(); }
});

test('VS16: admin mutation gates reject direct HTTP requests without data changes or actionable UI', async ({ page }) => {
  await page.goto('/sign-in');
  await signIn(page, adminEmail);
  await expect(page.getByRole('heading', { name: 'Team overview' })).toBeVisible();
  const before = await immutableDigest();
  const paths = [
    '/api/v1/users', '/api/v1/users/' + analyst, '/api/v1/operators/' + analyst,
    '/api/v1/rules', '/api/v1/rules/' + syntheticId(50), '/api/v1/risk-rules/' + syntheticId(50),
    '/api/v1/redactions', '/api/v1/redaction-requests', '/api/v1/cleanup', '/api/v1/session-cleanup',
    '/api/v1/telemetry-cleanups',
    '/api/v1/cases/' + privateCase + '/notes',
  ];
  for (const endpoint of paths) {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const response = await page.request.fetch(endpoint, { method, headers: { origin: 'http://127.0.0.1:3100' },
        data: { user_id: analyst, is_active: false, weight: 999, confirm: true, reason: 'Synthetic gated request' } });
      expect([403, 404, 405], `${method} ${endpoint}`).toContain(response.status());
    }
  }
  expect(await immutableDigest()).toEqual(before);
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(nav.getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /Manage users|Edit rules|Redact|Cleanup|Telemetry|Add note/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Manage users|Edit rules|Redact|Cleanup|Add note/ })).toHaveCount(0);
});

test('runtime database role rejects direct writes and immutable-event triggers also reject the privileged fixture owner', async () => {
  test.skip(test.info().config.metadata.acceptance !== true, 'The acceptance command provisions and verifies a separate runtime login.');
  const app = new pg.Client({ connectionString: acceptanceConnections().runtime });
  await app.connect();
  try {
    const current = (await app.query('SELECT current_user AS name')).rows[0].name;
    expect(current).toBe('finsight_runtime');
    const before = await immutableDigest();
    for (const statement of [
      'INSERT INTO public.case_event(case_id) SELECT case_id FROM public.investigation_case LIMIT 1',
      'UPDATE public.case_event SET reason=reason', 'DELETE FROM public.case_event',
      'UPDATE public.transaction SET amount=amount', 'DELETE FROM public.risk_signal',
      'TRUNCATE public.case_event', 'UPDATE public.app_user SET is_active=false',
    ]) await expect(app.query(statement)).rejects.toMatchObject({ code: '42501' });
    for (const statement of ['UPDATE public.case_event SET reason=reason', 'DELETE FROM public.case_event']) {
      await expect(db.query(statement)).rejects.toMatchObject({ code: '55000' });
    }
    expect(await immutableDigest()).toEqual(before);
    const accepted = (await app.query(`SELECT * FROM public.execute_case_command('create',$1,gen_random_uuid(),repeat('e',64),
      NULL,NULL,$2,'low','Synthetic permitted runtime writer',NULL,NULL,$3)`, [analyst, runtimeSubject, `ACCEPTANCE-RUNTIME-${runtimeSubject.slice(0, 8)}`])).rows[0];
    expect(accepted.status).toBe('open');
    expect((await db.query('SELECT count(*)::int AS n FROM public.case_event WHERE case_id=$1', [accepted.case_id])).rows[0].n).toBe(2);
  } finally { await app.end(); }
});
