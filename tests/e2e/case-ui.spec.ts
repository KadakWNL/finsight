import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { seedFinancial, syntheticId } from '../../scripts/financial-seed.mjs';

const analyst1Id = '71000000-0000-0000-0000-000000000001';
const analyst1Email = 'analyst1_e2e@synthetic.invalid';

const analyst2Id = '71000000-0000-0000-0000-000000000002';
const analyst2Email = 'analyst2_e2e@synthetic.invalid';

const adminUserId = '71000000-0000-0000-0000-000000000003';
const adminEmail = 'admin_e2e@synthetic.invalid';

const testPassword = randomBytes(24).toString('hex');

let client: pg.Client;
let case1Id: string;
let case2Id: string;
let caseConflictId: string;
let case1Ref: string;
let case2Ref: string;
let unassignedCaseRef: string;

test.beforeAll(async () => {
  client = new pg.Client({ connectionString: requireTestDatabase() });
  await client.connect();
  await applyMigrations(client, new URL('../../migrations/', import.meta.url));
  await seedFinancial(client);

  // Clear active status on transactions 101, 102, 103, 107
  await client.query(
    `UPDATE public.investigation_case
     SET status = 'dismissed', closed_at = clock_timestamp(), resolution_code = 'false_positive', resolution_notes = 'Test reset'
     WHERE status IN ('open', 'in_review', 'escalated')
       AND transaction_id IN ($1, $2, $3, $4)`,
    [syntheticId(101), syntheticId(102), syntheticId(103), syntheticId(107)]
  );

  const hash = await argon2.hash(testPassword, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  // Create users
  await client.query(
    `INSERT INTO public.app_user (user_id, email, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'E2E Analyst 1', 'analyst'),
            ($4, $5, $3, 'E2E Analyst 2', 'analyst'),
            ($6, $7, $3, 'E2E Admin', 'admin')
     ON CONFLICT (user_id) DO NOTHING`,
    [analyst1Id, analyst1Email, hash, analyst2Id, analyst2Email, adminUserId, adminEmail]
  );

  const runId = Math.random().toString(36).substring(2, 7).toUpperCase();
  case1Ref = `CASE-E1-${runId}`;
  case2Ref = `CASE-E2-${runId}`;
  unassignedCaseRef = `CASE-UN-${runId}`;
  const caseConflictRef = `CASE-CF-${runId}`;

  // Create Case 1 assigned to Analyst 1 on transaction 101
  const res1 = await client.query(
    `SELECT * FROM public.execute_case_command(
       p_command_type := 'create',
       p_actor_user_id := $1,
       p_idempotency_key := gen_random_uuid(),
       p_request_hash := repeat('a', 64),
       p_transaction_id := $2,
       p_priority := 'high',
       p_reason := 'Synthetic initial reason for Case 1',
       p_case_ref := $3
     )`,
    [analyst1Id, syntheticId(101), case1Ref]
  );
  case1Id = res1.rows[0].case_id;

  // Create Case 2 assigned to Analyst 2 on transaction 102
  const res2 = await client.query(
    `SELECT * FROM public.execute_case_command(
       p_command_type := 'create',
       p_actor_user_id := $1,
       p_idempotency_key := gen_random_uuid(),
       p_request_hash := repeat('b', 64),
       p_transaction_id := $2,
       p_priority := 'medium',
       p_reason := 'Synthetic initial reason for Case 2',
       p_case_ref := $3
     )`,
    [analyst2Id, syntheticId(102), case2Ref]
  );
  case2Id = res2.rows[0].case_id;

  // Create Unassigned Case on transaction 103
  await client.query(
    `SELECT * FROM public.execute_case_command(
       p_command_type := 'create',
       p_actor_user_id := $1,
       p_idempotency_key := gen_random_uuid(),
       p_request_hash := repeat('c', 64),
       p_transaction_id := $2,
       p_priority := 'low',
       p_reason := 'Synthetic unassigned case',
       p_case_ref := $3
     )`,
    [analyst1Id, syntheticId(103), unassignedCaseRef]
  );
  await client.query(
    `UPDATE public.investigation_case SET assigned_to_user_id = NULL WHERE case_ref = $1`,
    [unassignedCaseRef]
  );

  // Create Case for Optimistic Concurrency test on transaction 107
  const resConflict = await client.query(
    `SELECT * FROM public.execute_case_command(
       p_command_type := 'create',
       p_actor_user_id := $1,
       p_idempotency_key := gen_random_uuid(),
       p_request_hash := repeat('d', 64),
       p_transaction_id := $2,
       p_priority := 'medium',
       p_reason := 'Synthetic conflict case',
       p_case_ref := $3
     )`,
    [analyst1Id, syntheticId(107), caseConflictRef]
  );
  caseConflictId = resConflict.rows[0].case_id;
});

test.afterAll(async () => {
  if (client) {
    await client.end();
  }
});

test.describe('Issue #15 — Case Queue, Lifecycle Dialogs, and Event History', () => {
  test('Analyst sees assigned queue, concealed peer case, and unassigned summary', async ({ page }) => {
    // 1. Sign in as Analyst 1
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(analyst1Email);
    await page.getByLabel('Password', { exact: true }).fill(testPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your overview' })).toBeVisible();

    // 2. Navigate to /cases
    await page.getByRole('link', { name: 'Cases' }).first().click();
    await expect(page).toHaveURL(/\/cases/);
    await expect(page.getByRole('heading', { name: 'Investigation Cases' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Assigned to me' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Live PostgreSQL 17')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/case-queue-desktop.png', fullPage: true });

    // In "Assigned to me" tab (default for analyst)
    await expect(page.getByRole('link', { name: case1Ref })).toBeVisible();

    await page.goto('/cases?offset=999999');
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByRole('link', { name: case1Ref })).toBeVisible();
    await expect(page.getByText(case2Ref)).not.toBeVisible(); // Peer case must not appear

    // Switch to "Unassigned summaries" tab
    await page.getByRole('button', { name: 'Unassigned summaries' }).click();
    await expect(page.getByRole('button', { name: 'Unassigned summaries' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(unassignedCaseRef)).toBeVisible();
    await expect(page.getByText('Unassigned summary')).toBeVisible();

    // 3. Concealed 404: Analyst 1 visits Case 2 (owned by Analyst 2)
    await page.goto('/cases/' + case2Id);
    await expect(page.getByRole('heading', { name: 'Case not found' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('body')).not.toContainText(case2Ref);
  });

  test('Full lifecycle progression: start_review, escalate, admin return_to_review, resolve, admin reopen', async ({
    page,
  }) => {
    test.setTimeout(120000);

    // 1. Sign in as Analyst 1
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(analyst1Email);
    await page.getByLabel('Password', { exact: true }).fill(testPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your overview' })).toBeVisible();

    // Navigate to Case 1
    await page.goto('/cases/' + case1Id);
    await expect(page.getByRole('heading', { name: `Case ${case1Ref}` })).toBeVisible();
    await expect(page.getByText('Subject Transaction', { exact: true })).toBeVisible();
    await expect(page.getByRole('feed', { name: 'Case event timeline' })).toBeVisible();
    await expect(page.getByText('Synthetic initial reason for Case 1')).toBeVisible();

    // Case is OPEN -> Start review button is visible
    const startReviewBtn = page.getByRole('button', { name: 'Start review' });
    await expect(startReviewBtn).toBeVisible();

    // Test Keyboard Cancel on Start Review Dialog
    await startReviewBtn.focus();
    await page.keyboard.press('Enter');
    const startDialog = page.getByRole('dialog', { name: 'Start review' });
    await expect(startDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(startDialog).not.toBeVisible();
    await expect(startReviewBtn).toBeFocused();

    // Actually confirm Start Review
    await startReviewBtn.click();
    await page.getByRole('button', { name: 'Confirm start review' }).click();

    // Status is now IN_REVIEW
    await expect(page.locator('.status-badge').first()).toContainText(/in review/i);
    await expect(page.getByRole('button', { name: 'Escalate' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resolve case' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dismiss case' })).toBeVisible();

    // Escalate the case
    await page.getByRole('button', { name: 'Escalate' }).click();
    const escalateDialog = page.getByRole('dialog', { name: 'Escalate case' });
    await expect(escalateDialog).toBeVisible();
    await page.getByLabel('Operational escalation reason (required)').fill('Escalating pattern for executive oversight.');
    await page.getByRole('button', { name: 'Confirm escalation' }).click();

    // Status is now ESCALATED
    await expect(page.locator('.status-badge').first()).toContainText(/escalated/i);
    await expect(page.getByText('This case is escalated to administration.')).toBeVisible();

    // 2. Sign out as Analyst 1
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to FinSight' })).toBeVisible();

    // Sign in as Admin to oversee and return to review
    await page.getByLabel('Email address').fill(adminEmail);
    await page.getByLabel('Password', { exact: true }).fill(testPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Team overview' })).toBeVisible();

    await page.goto('/cases/' + case1Id);
    await expect(page.getByRole('button', { name: 'Return to review' })).toBeVisible();

    // Admin returns to review
    await page.getByRole('button', { name: 'Return to review' }).click();
    await page.getByLabel('Return rationale (required)').fill('Administrative inquiry returned to desk.');
    await page.getByRole('button', { name: 'Confirm return to review' }).click();
    await expect(page.locator('.status-badge').first()).toContainText(/in review/i);

    // Admin resolves as confirmed suspicious
    await page.getByRole('button', { name: 'Resolve case' }).click();
    const resolveDialog = page.getByRole('dialog', { name: 'Resolve case (Confirmed Suspicious)' });
    await expect(resolveDialog).toBeVisible();
    await page.getByLabel('Resolution notes (required)').fill('Confirmed suspicious activity against fraud pattern.');
    await page.getByRole('button', { name: 'Confirm resolution' }).click();

    // Status is now CLOSED
    await expect(page.locator('.status-badge').first()).toContainText(/closed/i);
    await expect(page.getByRole('button', { name: 'Reopen case' })).toBeVisible();

    // Admin reopens the case
    await page.getByRole('button', { name: 'Reopen case' }).click();
    const reopenDialog = page.getByRole('dialog', { name: 'Reopen case (Administrator)' });
    await expect(reopenDialog).toBeVisible();
    await page.getByLabel('Reopening operational rationale (required)').fill('Reopening case on newly received merchant records.');
    await page.getByRole('button', { name: 'Confirm reopen' }).click();

    // Status transitions back to OPEN
    await expect(page.locator('.status-badge').first()).toContainText(/open/i);
    await expect(page.getByRole('button', { name: 'Start review' })).toBeVisible();
  });

  test('Optimistic concurrency (HTTP 409) preserves user draft on conflict', async ({ page }) => {
    // 1. Sign in as Analyst 1
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(analyst1Email);
    await page.getByLabel('Password', { exact: true }).fill(testPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your overview' })).toBeVisible();

    // Navigate to caseConflictId
    await page.goto('/cases/' + caseConflictId);
    await page.getByRole('button', { name: 'Start review' }).click();
    await page.getByRole('button', { name: 'Confirm start review' }).click();
    await expect(page.locator('.status-badge').first()).toContainText(/in review/i);

    // Open Escalate dialog
    await page.getByRole('button', { name: 'Escalate' }).click();
    const rationaleField = page.getByLabel('Operational escalation reason (required)');
    await rationaleField.fill('My valuable draft rationale that must not be lost');

    // A dropped connection must release the pending state without losing the draft.
    await page.route('**/api/v1/cases/*/commands', route => route.abort(), { times: 1 });
    await page.getByRole('button', { name: 'Confirm escalation' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Check your connection');
    await expect(rationaleField).toHaveValue('My valuable draft rationale that must not be lost');
    await expect(page.getByRole('button', { name: 'Confirm escalation' })).toBeEnabled();

    // Bump version behind the scenes in PostgreSQL
    await client.query('UPDATE public.investigation_case SET version = version + 1 WHERE case_id = $1', [caseConflictId]);

    // Attempt submission
    await page.getByRole('button', { name: 'Confirm escalation' }).click();

    // HTTP 409 conflict notice should appear
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/conflict occurred/i);
    // Verify draft input was preserved!
    await expect(rationaleField).toHaveValue('My valuable draft rationale that must not be lost');

    // Wait for the case version to reload to 3
    await expect(page.getByText('Current version: 3')).toBeVisible({ timeout: 15000 });

    // Resubmit after version refreshed automatically on conflict
    await page.getByRole('button', { name: 'Confirm escalation' }).click();
    await expect(page.locator('.status-badge').first()).toContainText(/escalated/i);
  });

  test('Dismissal flow supports false_positive and insufficient_evidence', async ({ page }) => {
    // Sign in as Analyst 1
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(analyst1Email);
    await page.getByLabel('Password', { exact: true }).fill(testPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your overview' })).toBeVisible();

    // Case 1 was reopened to open at the end of Test 2
    await page.goto('/cases/' + case1Id);
    await page.getByRole('button', { name: 'Start review' }).click();
    await page.getByRole('button', { name: 'Confirm start review' }).click();
    await expect(page.locator('.status-badge').first()).toContainText(/in review/i);

    // Click Dismiss case
    await page.getByRole('button', { name: 'Dismiss case' }).click();
    const dismissDialog = page.getByRole('dialog', { name: 'Dismiss case' });
    await expect(dismissDialog).toBeVisible();
    await dismissDialog.screenshot({ path: 'test-results/dismiss-dialog-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/dismiss-dialog-mobile.png' });
    expect(await page.getByRole('radio').first().evaluate(input => {
      const radio = input.getBoundingClientRect();
      const label = input.closest('label')!.getBoundingClientRect();
      return radio.width === 18 && radio.height === 18 && radio.top - label.top < 20;
    })).toBe(true);

    // Select false_positive
    await page.getByLabel(/False positive/i).check();
    await page.getByLabel('Dismissal rationale notes (required)').fill('Legitimate user behavior confirmed by customer contact.');
    await page.getByRole('button', { name: 'Confirm dismissal' }).click();

    await expect(page.locator('.status-badge').first()).toContainText(/dismissed/i);
    await expect(page.locator('body')).toContainText('false_positive');
  });
});
