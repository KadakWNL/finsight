import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';

const adminId = '80000000-0000-0000-0000-000000000001';
const adminEmail = 'e2e_admin@synthetic.invalid';
const analystId = '80000000-0000-0000-0000-000000000002';
const analystEmail = 'e2e_analyst@synthetic.invalid';
const password = randomBytes(24).toString('hex');

let client: pg.Client;

test.beforeAll(async () => {
  client = new pg.Client({ connectionString: requireTestDatabase() });
  await client.connect();
  await applyMigrations(client, new URL('../../migrations/', import.meta.url));

  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  await client.query(`
    INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
    VALUES
      ($1, $2, $3, 'E2E Admin', 'admin', true),
      ($4, $5, $3, 'E2E Analyst', 'analyst', true)
    ON CONFLICT (user_id) DO UPDATE SET password_hash = $3, role = EXCLUDED.role, is_active = true
  `, [adminId, adminEmail, hash, analystId, analystEmail]);
});

test.afterAll(async () => {
  if (client) {
    try {
      await client.query(`
        ALTER TABLE public.app_session_cleanup DISABLE TRIGGER cleanup_audit_immutable_stmt;
        ALTER TABLE public.app_session_cleanup DISABLE TRIGGER cleanup_audit_immutable_row;
        DELETE FROM public.app_session_cleanup;
        ALTER TABLE public.app_session_cleanup ENABLE TRIGGER cleanup_audit_immutable_stmt;
        ALTER TABLE public.app_session_cleanup ENABLE TRIGGER cleanup_audit_immutable_row;
        DELETE FROM public.app_session;
        DELETE FROM public.app_user WHERE user_id::text LIKE '80000000-%';
      `);
    } finally {
      await client.end();
    }
  }
});

test('administrator can preview and confirm session cleanup, while analyst has no access', async ({ page }) => {
  test.setTimeout(90000);

  // 1. Analyst signs in and cannot access admin maintenance
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(analystEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/overview/);

  // Verify session cleanup panel is NOT visible on analyst overview
  await expect(page.getByRole('heading', { name: 'Session cleanup (Admin maintenance)' })).not.toBeVisible();

  // Attempting to navigate directly to /admin as an analyst is rejected
  await page.goto('/admin');
  await expect(page).not.toHaveURL('/admin');

  // Sign out
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  // 2. Admin signs in
  await page.getByLabel('Email address').fill(adminEmail);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);

  // Session cleanup panel is visible
  const cleanupHeading = page.getByRole('heading', { name: 'Session cleanup (Admin maintenance)' });
  await expect(cleanupHeading).toBeVisible();
  await expect(page.getByText('7-Day Session Cleanup Policy')).toBeVisible();

  // Seed an eligible expired session
  const testSessionId = randomUUID();
  await client.query(`
    INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
    VALUES ($1, $2, clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
  `, [testSessionId, adminId]);

  // Click Preview
  await page.getByRole('button', { name: 'Preview eligible sessions' }).click();

  // Preview results appear
  await expect(page.getByText(/Preview results/)).toBeVisible();
  await expect(page.getByText(/Captured cutoff/)).toBeVisible();
  await expect(page.getByText(/Bounded guarantee/)).toBeVisible();

  // Confirm deletion button is visible
  const confirmBtn = page.getByRole('button', { name: /Confirm deletion/ });
  await expect(confirmBtn).toBeVisible();

  // Click Confirm
  await confirmBtn.click();

  // Completed status appears
  await expect(page.getByText('Cleanup operation completed')).toBeVisible();
  await expect(page.getByText(/sessions removed/)).toBeVisible();

  // Click Done to reset back to idle
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Preview eligible sessions' })).toBeVisible();

  // Ensure no raw session IDs, tokens, or credentials are visible on the page
  const pageText = await page.textContent('body');
  expect(pageText).not.toContain(testSessionId);
  expect(pageText).not.toContain('password');
});
