import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';

vi.mock('server-only', () => ({}));

import {
  previewSessionCleanup,
  confirmSessionCleanup,
} from '../../src/server/session-cleanup';

describe('FinSight Issue #23: Audited Admin Session Cleanup Integration Tests', () => {
  let client: pg.Client;
  let concurrentClient: pg.Client;

  const adminAlice = '60000000-0000-0000-0000-000000000001';
  const adminBob = '60000000-0000-0000-0000-000000000002';
  const inactiveAdmin = '60000000-0000-0000-0000-000000000003';
  const demotedAdmin = '60000000-0000-0000-0000-000000000004';
  const analystEve = '60000000-0000-0000-0000-000000000005';
  const systemActor = '60000000-0000-0000-0000-000000000006';

  beforeAll(async () => {
    client = new pg.Client({ connectionString: requireTestDatabase() });
    concurrentClient = new pg.Client({ connectionString: requireTestDatabase() });
    await client.connect();
    await concurrentClient.connect();

    // Verify non-superuser and PostgreSQL 17
    const v = await client.query('SHOW server_version_num');
    expect(Math.floor(Number(v.rows[0].server_version_num) / 10000)).toBe(17);
    const role = await client.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
    expect(role.rows[0].rolsuper).toBe(false);

    // Apply migrations 010 through 060
    await applyMigrations(client, new URL('../../migrations/', import.meta.url));

    // Seed test actors
    await client.query(`
      INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
      VALUES
        ('${adminAlice}', 'db_admin_alice@synthetic.invalid', 'test-only', 'Admin Alice', 'admin', true),
        ('${adminBob}', 'db_admin_bob@synthetic.invalid', 'test-only', 'Admin Bob', 'admin', true),
        ('${inactiveAdmin}', 'db_inactive_admin@synthetic.invalid', 'test-only', 'Inactive Admin', 'admin', false),
        ('${demotedAdmin}', 'db_demoted_admin@synthetic.invalid', 'test-only', 'Demoted Admin', 'analyst', true),
        ('${analystEve}', 'db_analyst_eve@synthetic.invalid', 'test-only', 'Analyst Eve', 'analyst', true),
        ('${systemActor}', 'db_system_actor@synthetic.invalid', NULL, 'System Actor', 'system', true)
      ON CONFLICT (user_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    try {
      await client.query(`
        ALTER TABLE public.app_session_cleanup DISABLE TRIGGER cleanup_audit_immutable_stmt;
        ALTER TABLE public.app_session_cleanup DISABLE TRIGGER cleanup_audit_immutable_row;
        DELETE FROM public.app_session_cleanup;
        ALTER TABLE public.app_session_cleanup ENABLE TRIGGER cleanup_audit_immutable_stmt;
        ALTER TABLE public.app_session_cleanup ENABLE TRIGGER cleanup_audit_immutable_row;
        DELETE FROM public.app_session;
        DELETE FROM public.app_user WHERE user_id::text LIKE '60000000-%';
      `);
    } finally {
      await client.end();
      await concurrentClient.end();
    }
  });

  it('1-8: correctly discriminates eligibility across active, idle, absolute, revoked, cutoff and null revocation sessions', async () => {
    await client.query('DELETE FROM public.app_session');

    const sActive = randomUUID();
    const sIdleOld = randomUUID();
    const sAbsOld = randomUUID();
    const sRevOld = randomUUID();
    const sEarliestWins = randomUUID();
    const sRecentExpired = randomUUID();
    const sExactCutoff = randomUUID();
    const sNullRevocation = randomUUID();

    // 1. Active session (expires in future) -> survives
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '20 minutes', clock_timestamp() + interval '7 hours')
    `, [sActive]);

    // 2. Idle-expired older than 7 days (created 8 days ago, idle expired 8 days ago) -> eligible
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
    `, [sIdleOld]);

    // 3. Absolute-expired older than 7 days -> eligible
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '9 days', clock_timestamp() - interval '9 days', clock_timestamp() - interval '9 days' + interval '20 minutes', clock_timestamp() - interval '9 days' + interval '4 hours')
    `, [sAbsOld]);

    // 4. Revoked older than 7 days -> eligible
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revocation_reason)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days 2 hours', clock_timestamp() - interval '8 days 2 hours', clock_timestamp() - interval '8 days 2 hours' + interval '20 minutes', clock_timestamp() - interval '8 days 2 hours' + interval '4 hours', clock_timestamp() - interval '8 days 1 hour', 'sign_out')
    `, [sRevOld]);

    // 5. Earliest unusable timestamp is older than cutoff, regardless of later absolute expiry -> eligible
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revocation_reason)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours', clock_timestamp() - interval '8 days' + interval '10 minutes', 'sign_out')
    `, [sEarliestWins]);

    // 6. Recent expired session (expired 3 days ago, under 7 days old) -> survives
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '3 days', clock_timestamp() - interval '3 days', clock_timestamp() - interval '3 days' + interval '20 minutes', clock_timestamp() - interval '3 days' + interval '4 hours')
    `, [sRecentExpired]);

    // 7. Session at/after cutoff (idle expired 6 days 23 hours ago, strictly NOT < 7-day cutoff) -> survives
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '6 days 23 hours', clock_timestamp() - interval '6 days 23 hours', clock_timestamp() - interval '6 days 23 hours' + interval '20 minutes', clock_timestamp() - interval '6 days 23 hours' + interval '3 hours')
    `, [sExactCutoff]);

    // 8. Nullable revoked_at does not break eligibility (revoked_at IS NULL, idle expired 9 days ago) -> eligible
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '9 days', clock_timestamp() - interval '9 days', clock_timestamp() - interval '9 days' + interval '20 minutes', clock_timestamp() - interval '9 days' + interval '4 hours', NULL)
    `, [sNullRevocation]);

    // Run preview
    const preview = await previewSessionCleanup(client, adminAlice);
    // Exactly 5 sessions are strictly < cutoff: sIdleOld, sAbsOld, sRevOld, sEarliestWins, sNullRevocation
    expect(preview.candidateCount).toBe(5);

    // Confirm deletion
    const key = randomUUID();
    const result = await confirmSessionCleanup(client, {
      operationId: preview.operationId,
      adminUserId: adminAlice,
      idempotencyKey: key,
    });

    expect(result.status).toBe('completed');
    expect(result.deletedCount).toBe(5);

    // Verify survivors: active, recent expired, and session at/after cutoff survive
    const remaining = (await client.query('SELECT session_id FROM public.app_session')).rows.map(r => r.session_id);
    expect(remaining).toContain(sActive);
    expect(remaining).toContain(sRecentExpired);
    expect(remaining).toContain(sExactCutoff);
  });

  it('9: preview is capped at 100 and deterministic when > 100 candidates exist', async () => {
    await client.query('DELETE FROM public.app_session');

    // Insert 120 eligible sessions
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      SELECT
        gen_random_uuid(),
        '${adminAlice}',
        clock_timestamp() - interval '10 days' - (n || ' minutes')::interval,
        clock_timestamp() - interval '10 days' - (n || ' minutes')::interval,
        clock_timestamp() - interval '10 days' - (n || ' minutes')::interval + interval '20 minutes',
        clock_timestamp() - interval '10 days' - (n || ' minutes')::interval + interval '4 hours'
      FROM generate_series(1, 120) n;
    `);

    const preview = await previewSessionCleanup(client, adminAlice);
    expect(preview.candidateCount).toBe(100);

    // Verify exactly 100 are deleted
    const result = await confirmSessionCleanup(client, {
      operationId: preview.operationId,
      adminUserId: adminAlice,
      idempotencyKey: randomUUID(),
    });

    expect(result.deletedCount).toBe(100);
    const countRemaining = (await client.query('SELECT count(*)::int as c FROM public.app_session')).rows[0].c;
    expect(countRemaining).toBe(20);
  });

  it('10-11: does not delete newly eligible sessions after preview, and missing candidate is not replaced', async () => {
    await client.query('DELETE FROM public.app_session');

    const s1 = randomUUID();
    const s2 = randomUUID();
    const s3 = randomUUID();

    // 2 eligible sessions
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES
        ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours'),
        ($2, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
    `, [s1, s2]);

    const preview = await previewSessionCleanup(client, adminAlice);
    expect(preview.candidateCount).toBe(2);

    // Delete s1 manually before confirm (candidate removed)
    await client.query('DELETE FROM public.app_session WHERE session_id = $1', [s1]);

    // Add a newly eligible session s3 after preview was captured
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '9 days', clock_timestamp() - interval '9 days', clock_timestamp() - interval '9 days' + interval '20 minutes', clock_timestamp() - interval '9 days' + interval '4 hours')
    `, [s3]);

    // Confirm preview
    const result = await confirmSessionCleanup(client, {
      operationId: preview.operationId,
      adminUserId: adminAlice,
      idempotencyKey: randomUUID(),
    });

    // Only s2 was deleted! (count is 1 instead of 2, s3 was NOT deleted, no replacement)
    expect(result.deletedCount).toBe(1);

    const remaining = (await client.query('SELECT session_id FROM public.app_session')).rows.map(r => r.session_id);
    expect(remaining).toContain(s3);
  });

  it('12: expired preview fails without deletion', async () => {
    await client.query('DELETE FROM public.app_session');
    const s1 = randomUUID();

    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
    `, [s1]);

    const preview = await previewSessionCleanup(client, adminAlice);

    // Backdate preview expiry to the past while keeping preview_at <= expires_at
    await client.query(`
      UPDATE public.app_session_cleanup
      SET preview_at = preview_at - interval '11 minutes',
          cutoff_at = cutoff_at - interval '11 minutes',
          expires_at = expires_at - interval '11 minutes'
      WHERE operation_id = $1
    `, [preview.operationId]);

    await expect(
      confirmSessionCleanup(client, {
        operationId: preview.operationId,
        adminUserId: adminAlice,
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow(/expired/i);

    // Session survives
    const exists = (await client.query('SELECT 1 FROM public.app_session WHERE session_id = $1', [s1])).rows.length;
    expect(exists).toBe(1);
  });

  it('13: direct DELETE on public.app_session is denied to nonowner/runtime callers', async () => {
    // Call grant_cleanup_privileges for finsight_auth_probe
    await client.query("CALL public.grant_cleanup_privileges('finsight_auth_probe'::regrole)");
    await client.query("CALL public.grant_runtime_privileges('finsight_auth_probe'::regrole)");

    const probeClient = new pg.Client({ connectionString: requireTestDatabase() });
    await probeClient.connect();
    try {
      await probeClient.query('SET ROLE finsight_auth_probe');
      await expect(
        probeClient.query('DELETE FROM public.app_session WHERE session_id = $1', [randomUUID()])
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await probeClient.end();
    }
  });

  it('14-16: denies analyst, service, inactive admin, demoted admin, and mismatched operation ownership', async () => {
    // Analyst preview denied
    await expect(previewSessionCleanup(client, analystEve)).rejects.toThrow(/active administrator/i);

    // System service preview denied
    await expect(previewSessionCleanup(client, systemActor)).rejects.toThrow(/active administrator/i);

    // Inactive admin preview denied
    await expect(previewSessionCleanup(client, inactiveAdmin)).rejects.toThrow(/active administrator/i);

    // Demoted admin preview denied
    await expect(previewSessionCleanup(client, demotedAdmin)).rejects.toThrow(/active administrator/i);

    // Create a valid preview by Alice
    const preview = await previewSessionCleanup(client, adminAlice);

    // Bob tries to confirm Alice's preview -> ownership mismatch denied
    await expect(
      confirmSessionCleanup(client, {
        operationId: preview.operationId,
        adminUserId: adminBob,
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow(/belong to administrator/i);

    // Inactive admin confirm denied
    await expect(
      confirmSessionCleanup(client, {
        operationId: preview.operationId,
        adminUserId: inactiveAdmin,
        idempotencyKey: randomUUID(),
      })
    ).rejects.toThrow(/active administrator/i);
  });

  it('17-19: idempotency replay returns committed result once; changed payload conflicts; completed op cannot delete again', async () => {
    await client.query('DELETE FROM public.app_session');
    const s1 = randomUUID();

    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
    `, [s1]);

    const preview = await previewSessionCleanup(client, adminAlice);
    const key = randomUUID();

    // 17. First confirmation
    const res1 = await confirmSessionCleanup(client, {
      operationId: preview.operationId,
      adminUserId: adminAlice,
      idempotencyKey: key,
    });
    expect(res1.status).toBe('completed');
    expect(res1.deletedCount).toBe(1);
    expect(res1.replayed).toBe(false);

    // 17. Same confirmation retried -> returns committed result with replayed = true
    const res2 = await confirmSessionCleanup(client, {
      operationId: preview.operationId,
      adminUserId: adminAlice,
      idempotencyKey: key,
    });
    expect(res2.deletedCount).toBe(1);
    expect(res2.replayed).toBe(true);

    // 18. Changed idempotency payload conflicts
    await expect(
      confirmSessionCleanup(client, {
        operationId: preview.operationId,
        adminUserId: adminAlice,
        idempotencyKey: key,
        rawPayloadForHash: { changed: 'different payload' },
      })
    ).rejects.toThrow(/Idempotency conflict/i);

    // 19. A completed operation cannot delete again even if re-confirmed with a new key
    const res3 = await confirmSessionCleanup(client, {
      operationId: preview.operationId,
      adminUserId: adminAlice,
      idempotencyKey: randomUUID(),
    });
    expect(res3.replayed).toBe(true);
    expect(res3.deletedCount).toBe(1);
  });

  it('20: concurrent confirmations yield only one committed cleanup result without errors', async () => {
    await client.query('DELETE FROM public.app_session');
    const s1 = randomUUID();

    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
    `, [s1]);

    const preview = await previewSessionCleanup(client, adminAlice);
    const key = randomUUID();

    const [r1, r2] = await Promise.all([
      confirmSessionCleanup(client, {
        operationId: preview.operationId,
        adminUserId: adminAlice,
        idempotencyKey: key,
      }),
      confirmSessionCleanup(concurrentClient, {
        operationId: preview.operationId,
        adminUserId: adminAlice,
        idempotencyKey: key,
      }),
    ]);

    expect([r1.replayed, r2.replayed].sort()).toEqual([false, true]);
    expect(r1.deletedCount).toBe(1);
    expect(r2.deletedCount).toBe(1);
  });

  it('21: concurrent session validation/refresh cannot revive expired sessions or delete active sessions', async () => {
    await client.query('DELETE FROM public.app_session');
    const sActive = randomUUID();
    const sExpired = randomUUID();

    // Active session
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '5 minutes', clock_timestamp() + interval '20 minutes', clock_timestamp() + interval '7 hours')
    `, [sActive]);

    // Expired session
    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
    `, [sExpired]);

    // Validate active session refreshes properly
    const activeVal = await client.query('SELECT * FROM public.validate_app_session($1)', [sActive]);
    expect(activeVal.rows[0].is_idle_expired).toBe(false);

    // Validate expired session fails to refresh
    const expiredVal = await client.query('SELECT * FROM public.validate_app_session($1)', [sExpired]);
    expect(expiredVal.rows[0].is_idle_expired).toBe(true);

    // Cleanup preview & confirm
    const preview = await previewSessionCleanup(client, adminAlice);
    expect(preview.candidateCount).toBe(1);

    await confirmSessionCleanup(client, {
      operationId: preview.operationId,
      adminUserId: adminAlice,
      idempotencyKey: randomUUID(),
    });

    // Active session survived
    const activeSurvives = (await client.query('SELECT 1 FROM public.app_session WHERE session_id = $1', [sActive])).rows.length;
    expect(activeSurvives).toBe(1);

    // Expired session was deleted
    const expiredSurvives = (await client.query('SELECT 1 FROM public.app_session WHERE session_id = $1', [sExpired])).rows.length;
    expect(expiredSurvives).toBe(0);
  });

  it('22: injected audit-completion failure rolls the deletion back', async () => {
    await client.query('DELETE FROM public.app_session');
    const s1 = randomUUID();

    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
    `, [s1]);

    const preview = await previewSessionCleanup(client, adminAlice);

    // Inject trigger failure on UPDATE of app_session_cleanup
    await client.query(`
      CREATE OR REPLACE FUNCTION test_injected_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Simulated audit completion failure';
      END;
      $$;

      CREATE TRIGGER trigger_test_audit_fail
      BEFORE UPDATE ON public.app_session_cleanup
      FOR EACH ROW EXECUTE FUNCTION test_injected_audit_fail();
    `);

    try {
      await expect(
        confirmSessionCleanup(client, {
          operationId: preview.operationId,
          adminUserId: adminAlice,
          idempotencyKey: randomUUID(),
        })
      ).rejects.toThrow(/Simulated audit completion failure/i);

      // Verify full rollback: session was NOT deleted, and cleanup is NOT completed
      const sessionCount = (await client.query('SELECT count(*)::int as c FROM public.app_session WHERE session_id = $1', [s1])).rows[0].c;
      expect(sessionCount).toBe(1);

      const opStatus = (await client.query('SELECT status FROM public.app_session_cleanup WHERE operation_id = $1', [preview.operationId])).rows[0].status;
      expect(opStatus).toBe('previewed');
    } finally {
      await client.query(`
        DROP TRIGGER IF EXISTS trigger_test_audit_fail ON public.app_session_cleanup;
        DROP FUNCTION IF EXISTS test_injected_audit_fail();
      `);
    }
  });

  it('23: restrictive foreign-key failure rolls back safely', async () => {
    await client.query('DELETE FROM public.app_session');
    const s1 = randomUUID();

    await client.query(`
      INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
    `, [s1]);

    const preview = await previewSessionCleanup(client, adminAlice);

    // Create table with RESTRICT foreign key to app_session
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.test_session_fk (
        id uuid PRIMARY KEY,
        session_id uuid REFERENCES public.app_session (session_id) ON DELETE RESTRICT
      );
      INSERT INTO public.test_session_fk VALUES (gen_random_uuid(), '${s1}');
    `);

    try {
      await expect(
        confirmSessionCleanup(client, {
          operationId: preview.operationId,
          adminUserId: adminAlice,
          idempotencyKey: randomUUID(),
        })
      ).rejects.toThrow(/violates foreign key constraint/i);

      // Verify full rollback
      const sessionCount = (await client.query('SELECT count(*)::int as c FROM public.app_session WHERE session_id = $1', [s1])).rows[0].c;
      expect(sessionCount).toBe(1);

      const opStatus = (await client.query('SELECT status FROM public.app_session_cleanup WHERE operation_id = $1', [preview.operationId])).rows[0].status;
      expect(opStatus).toBe('previewed');
    } finally {
      await client.query('DROP TABLE IF EXISTS public.test_session_fk');
    }
  });

  it('24-25: user, financial, case, event, and receipt tables remain intact; deleted count strictly matches persisted completion', async () => {
    await client.query('DELETE FROM public.app_session');

    // Check row counts of protected tables before cleanup
    const tables = ['app_user', 'investigation_case', 'case_event', 'case_command_receipt', 'customer', 'account', 'transaction'];
    const beforeCounts: Record<string, number> = {};
    for (const t of tables) {
      const res = await client.query(`SELECT count(*)::int as c FROM public.${t}`);
      beforeCounts[t] = res.rows[0].c;
    }

    // Seed 3 eligible sessions
    const sIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const sid of sIds) {
      await client.query(`
        INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
        VALUES ($1, '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
      `, [sid]);
    }

    const preview = await previewSessionCleanup(client, adminAlice);
    const confirmRes = await confirmSessionCleanup(client, {
      operationId: preview.operationId,
      adminUserId: adminAlice,
      idempotencyKey: randomUUID(),
    });

    expect(confirmRes.deletedCount).toBe(3);

    // Verify persisted completion row matches exactly
    const auditRow = (await client.query('SELECT * FROM public.app_session_cleanup WHERE operation_id = $1', [preview.operationId])).rows[0];
    expect(auditRow.status).toBe('completed');
    expect(auditRow.deleted_count).toBe(3);
    expect(auditRow.candidate_count).toBe(3);

    // Verify protected table row counts are 100% unchanged
    for (const t of tables) {
      const res = await client.query(`SELECT count(*)::int as c FROM public.${t}`);
      expect(res.rows[0].c).toBe(beforeCounts[t]);
    }
  });
});
