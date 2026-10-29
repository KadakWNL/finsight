import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';

vi.mock('server-only', () => ({}));

import { executeCaseCommand } from '../../src/server/case-commands.js';

describe('Issue #9 Case Guards and Concurrency Integration Tests', () => {
  let client: pg.Client;
  let concurrentClient: pg.Client;

  const analystA = '40000000-0000-0000-0000-000000000001';
  const analystB = '40000000-0000-0000-0000-000000000002';
  const admin = '40000000-0000-0000-0000-000000000003';
  const inactiveUser = '40000000-0000-0000-0000-000000000004';
  const systemUser = '40000000-0000-0000-0000-000000000005';

  const customerId = '40000000-0000-0000-0000-000000000010';
  const accountId = '40000000-0000-0000-0000-000000000020';
  const merchantId = '40000000-0000-0000-0000-000000000030';
  const deviceId = '40000000-0000-0000-0000-000000000040';
  const txnId1 = '40000000-0000-0000-0000-000000000051';
  const txnId2 = '40000000-0000-0000-0000-000000000052';

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

    // Apply migrations 010 through 050
    await applyMigrations(client, new URL('../../migrations/', import.meta.url));

    // Seed test users
    await client.query(`
      INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
      VALUES
        ('${analystA}', 'db_analyst_a@synthetic.invalid', 'test-only', 'Analyst A', 'analyst', true),
        ('${analystB}', 'db_analyst_b@synthetic.invalid', 'test-only', 'Analyst B', 'analyst', true),
        ('${admin}', 'db_admin@synthetic.invalid', 'test-only', 'Admin User', 'admin', true),
        ('${inactiveUser}', 'db_inactive@synthetic.invalid', 'test-only', 'Inactive Analyst', 'analyst', false),
        ('${systemUser}', 'db_system@synthetic.invalid', NULL, 'System Actor', 'system', true)
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // Seed test financial facts
    await client.query(`
      INSERT INTO public.customer (customer_id, country_code, status)
      VALUES ('${customerId}', 'IN', 'active') ON CONFLICT DO NOTHING;

      INSERT INTO public.account (account_id, customer_id, account_number, account_type, currency_code, balance, status, opened_at)
      VALUES ('${accountId}', '${customerId}', 'SYN-DB-ACC', 'savings', 'INR', 10000, 'active', '2026-01-01') ON CONFLICT DO NOTHING;

      INSERT INTO public.merchant (merchant_id, merchant_name, category_code, country_code, risk_tier)
      VALUES ('${merchantId}', 'DB Test Merchant', '5411', 'IN', 'low') ON CONFLICT DO NOTHING;

      INSERT INTO public.device_fingerprint (device_id, device_hash, os_family, first_seen_at)
      VALUES ('${deviceId}', repeat('d', 64), 'synthetic', '2026-01-01T00:00:00Z') ON CONFLICT DO NOTHING;

      INSERT INTO public.transaction (transaction_id, account_id, merchant_id, device_id, amount, currency_code, exchange_rate, direction, txn_type, status, occurred_at, merchant_country_code, description)
      VALUES
        ('${txnId1}', '${accountId}', '${merchantId}', '${deviceId}', 100, 'INR', 1, 'debit', 'card_payment', 'posted', '2026-01-01T00:00:00Z', 'IN', 'Case guards test txn 1'),
        ('${txnId2}', '${accountId}', '${merchantId}', '${deviceId}', 200, 'INR', 1, 'debit', 'card_payment', 'posted', '2026-01-01T00:00:00Z', 'IN', 'Case guards test txn 2')
      ON CONFLICT DO NOTHING;
    `);
  });

  afterAll(async () => {
    try {
      await client.query(`
        DROP TABLE IF EXISTS
          public.app_session_cleanup,
          public.case_command_receipt,
          public.case_event,
          public.investigation_case,
          public.app_session,
          public.app_user,
          public.transaction_label,
          public.fraud_scenario,
          public.risk_signal,
          public.risk_rule,
          public.transaction,
          public.device_fingerprint,
          public.merchant,
          public.payment_method,
          public.account,
          public.address,
          public.customer,
          public.schema_migrations
        CASCADE;
        DROP VIEW IF EXISTS public.v_transaction_risk CASCADE;
        DROP PROCEDURE IF EXISTS public.grant_runtime_privileges(regrole) CASCADE;
        DROP PROCEDURE IF EXISTS public.grant_auth_privileges(regrole) CASCADE;
        DROP PROCEDURE IF EXISTS public.grant_cleanup_privileges(regrole) CASCADE;
        DROP FUNCTION IF EXISTS public.preview_app_session_cleanup(uuid) CASCADE;
        DROP FUNCTION IF EXISTS public.confirm_app_session_cleanup(uuid, uuid, uuid, text) CASCADE;
        DROP FUNCTION IF EXISTS public.reject_cleanup_audit_mutation CASCADE;
        DROP FUNCTION IF EXISTS public.validate_app_session(uuid, uuid) CASCADE;
        DROP FUNCTION IF EXISTS public.execute_case_command(text, uuid, uuid, text, bigint, uuid, uuid, text, text, text, text, text) CASCADE;
        DROP FUNCTION IF EXISTS
          public.reject_case_event_mutation,
          public.guard_case_event_insert,
          public.reject_case_receipt_mutation,
          public.guard_case_receipt_insert,
          public.guard_investigation_case_dml,
          public.reject_investigation_case_truncate,
          public.freeze_merchant_tier,
          public.risk_band,
          public.score_transaction,
          public.reject_retained_financial_change,
          public.valid_case_snapshot,
          public.valid_case_event
        CASCADE;
      `);
    } finally {
      await client.end();
      await concurrentClient.end();
    }
  });

  it('atomically creates case with ordered created and assigned events', async () => {
    const caseId = '40000000-0000-0000-0000-000000000061';
    const idempotencyKey = '40000000-0000-0000-0000-000000000071';

    const result = await executeCaseCommand(client, {
      commandType: 'create',
      actorUserId: analystA,
      idempotencyKey,
      caseId,
      transactionId: txnId1,
      priority: 'high',
      reason: 'Synthetic high-risk pattern detected',
      caseRef: 'CASE-TEST-1',
    });

    expect(result.status).toBe('open');
    expect(result.version).toBe(1);
    expect(result.responseStatus).toBe(201);
    expect(result.replayed).toBe(false);

    // Verify events: ordinal 1 = created, ordinal 2 = assigned
    const events = (await client.query(
      'SELECT * FROM public.case_event WHERE case_id = $1 ORDER BY event_ordinal',
      [caseId]
    )).rows;

    expect(events.length).toBe(2);
    expect(events[0].event_type).toBe('created');
    expect(events[0].event_ordinal).toBe(1);
    expect(events[0].from_state).toBeNull();
    expect(events[0].to_state.status).toBe('open');
    expect(events[0].reason).toBe('Synthetic high-risk pattern detected');

    expect(events[1].event_type).toBe('assigned');
    expect(events[1].event_ordinal).toBe(2);
    expect(events[1].from_state.assigned_to_user_id).toBeNull();
    expect(events[1].to_state.assigned_to_user_id).toBe(analystA);

    // Verify receipt was inserted
    const receipts = (await client.query(
      'SELECT * FROM public.case_command_receipt WHERE case_id = $1',
      [caseId]
    )).rows;
    expect(receipts.length).toBe(1);
    expect(receipts[0].response_status).toBe(201);
  });

  it('rejects competing active case creation on the same transaction', async () => {
    const caseId2 = '40000000-0000-0000-0000-000000000062';
    const idempotencyKey = '40000000-0000-0000-0000-000000000072';

    await expect(
      executeCaseCommand(client, {
        commandType: 'create',
        actorUserId: analystB,
        idempotencyKey,
        caseId: caseId2,
        transactionId: txnId1, // already has active case from previous test
        priority: 'low',
        reason: 'Competing attempt on same transaction',
      })
    ).rejects.toThrow();
  });

  it('handles idempotency replay versus changed payload conflict', async () => {
    const caseId = '40000000-0000-0000-0000-000000000061';
    const idempotencyKey = '40000000-0000-0000-0000-000000000071';

    // Same key, same payload -> returns replayed: true without creating extra events
    const replay = await executeCaseCommand(client, {
      commandType: 'create',
      actorUserId: analystA,
      idempotencyKey,
      caseId,
      transactionId: txnId1,
      priority: 'high',
      reason: 'Synthetic high-risk pattern detected',
      caseRef: 'CASE-TEST-1',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.responseStatus).toBe(201);

    const eventCount = (await client.query(
      'SELECT count(*)::int AS count FROM public.case_event WHERE case_id = $1',
      [caseId]
    )).rows[0].count;
    expect(eventCount).toBe(2);

    // Same key, different payload -> throws 409 conflict
    await expect(
      executeCaseCommand(client, {
        commandType: 'create',
        actorUserId: analystA,
        idempotencyKey,
        caseId,
        transactionId: txnId1,
        priority: 'medium', // different
        reason: 'Changed reason',
      })
    ).rejects.toThrow(/conflict/i);
  });

  it('enforces optimistic concurrency: stale expected_version is rejected', async () => {
    const caseId = '40000000-0000-0000-0000-000000000061';

    // Stale version: current version is 1, passing 99
    await expect(
      executeCaseCommand(client, {
        commandType: 'start_review',
        actorUserId: analystA,
        idempotencyKey: '40000000-0000-0000-0000-000000000073',
        caseId,
        expectedVersion: 99,
      })
    ).rejects.toThrow(/version conflict/i);

    // State remains unchanged
    const current = (await client.query(
      'SELECT version, status FROM public.investigation_case WHERE case_id = $1',
      [caseId]
    )).rows[0];
    expect(Number(current.version)).toBe(1);
    expect(current.status).toBe('open');
  });

  it('advances lifecycle and version on valid transitions', async () => {
    const caseId = '40000000-0000-0000-0000-000000000061';

    // 1. start_review (v1 -> v2)
    const reviewRes = await executeCaseCommand(client, {
      commandType: 'start_review',
      actorUserId: analystA,
      idempotencyKey: '40000000-0000-0000-0000-000000000074',
      caseId,
      expectedVersion: 1,
    });
    expect(reviewRes.status).toBe('in_review');
    expect(reviewRes.version).toBe(2);

    // 2. escalate (v2 -> v3)
    const escalateRes = await executeCaseCommand(client, {
      commandType: 'escalate',
      actorUserId: analystA,
      idempotencyKey: '40000000-0000-0000-0000-000000000075',
      caseId,
      expectedVersion: 2,
      reason: 'Requires senior admin assessment',
    });
    expect(escalateRes.status).toBe('escalated');
    expect(escalateRes.version).toBe(3);

    // 3. return_to_review (v3 -> v4) by admin
    const returnRes = await executeCaseCommand(client, {
      commandType: 'return_to_review',
      actorUserId: admin,
      idempotencyKey: '40000000-0000-0000-0000-000000000076',
      caseId,
      expectedVersion: 3,
      reason: 'Please cross-reference merchant history first',
    });
    expect(returnRes.status).toBe('in_review');
    expect(returnRes.version).toBe(4);

    // 4. resolve as confirmed_suspicious (v4 -> v5)
    const resolveRes = await executeCaseCommand(client, {
      commandType: 'resolve',
      actorUserId: analystA,
      idempotencyKey: '40000000-0000-0000-0000-000000000077',
      caseId,
      expectedVersion: 4,
      resolutionCode: 'confirmed_suspicious',
      resolutionNotes: 'Concluded fraudulent velocity across multiple synthetic accounts',
    });
    expect(resolveRes.status).toBe('closed');
    expect(resolveRes.version).toBe(5);

    // 5. reopen by admin (v5 -> v6)
    const reopenRes = await executeCaseCommand(client, {
      commandType: 'reopen',
      actorUserId: admin,
      idempotencyKey: '40000000-0000-0000-0000-000000000078',
      caseId,
      expectedVersion: 5,
      reason: 'New customer evidence provided to overturn prior conclusion',
    });
    expect(reopenRes.status).toBe('open');
    expect(reopenRes.version).toBe(6);
  });

  it('rechecks current case access before replaying an earlier admin command', async () => {
    const created = await executeCaseCommand(client, {
      commandType: 'create',
      actorUserId: analystA,
      idempotencyKey: '40000000-0000-0000-0000-000000000079',
      transactionId: txnId2,
      priority: 'low',
      reason: 'Synthetic replay permission fixture',
    });
    const command = {
      commandType: 'start_review' as const,
      actorUserId: admin,
      idempotencyKey: '40000000-0000-0000-0000-000000000080',
      caseId: created.caseId,
      expectedVersion: 1,
    };
    const accepted = await executeCaseCommand(client, command);
    expect((await executeCaseCommand(client, command)).replayed).toBe(true);
    const before = (await client.query(`SELECT c.version,
      (SELECT count(*) FROM public.case_event e WHERE e.case_id=c.case_id) AS events,
      (SELECT count(*) FROM public.case_command_receipt r WHERE r.case_id=c.case_id) AS receipts
      FROM public.investigation_case c WHERE c.case_id=$1`, [created.caseId])).rows[0];

    await client.query("UPDATE public.app_user SET role='analyst' WHERE user_id=$1", [admin]);
    try {
      await expect(executeCaseCommand(client, command)).rejects.toMatchObject({ code: 'P0002' });
      const after = (await client.query(`SELECT c.version,
        (SELECT count(*) FROM public.case_event e WHERE e.case_id=c.case_id) AS events,
        (SELECT count(*) FROM public.case_command_receipt r WHERE r.case_id=c.case_id) AS receipts
        FROM public.investigation_case c WHERE c.case_id=$1`, [created.caseId])).rows[0];
      expect(after).toEqual(before);
    } finally {
      await client.query("UPDATE public.app_user SET role='admin' WHERE user_id=$1", [admin]);
    }

    const replay = await executeCaseCommand(client, command);
    expect(replay.operationId).toBe(accepted.operationId);
    expect(replay.replayed).toBe(true);
  });

  it('protects case_event and case_command_receipt against direct mutation', async () => {
    // Direct UPDATE on case_event blocked (immutability)
    await expect(
      client.query("UPDATE public.case_event SET metadata = '{}'::jsonb")
    ).rejects.toThrow(/Case events are immutable/);

    // Direct DELETE on case_event blocked (immutability)
    await expect(
      client.query('DELETE FROM public.case_event')
    ).rejects.toThrow(/Case events are immutable/);

    // Direct TRUNCATE on case_event blocked (immutability)
    await expect(
      client.query('TRUNCATE public.case_event')
    ).rejects.toThrow(/Case events are immutable/);

    // Direct UPDATE on case_command_receipt blocked (immutability)
    await expect(
      client.query('UPDATE public.case_command_receipt SET response_status = 200')
    ).rejects.toThrow(/Case command receipts are immutable/);

    // Direct DELETE on case_command_receipt blocked (immutability)
    await expect(
      client.query('DELETE FROM public.case_command_receipt')
    ).rejects.toThrow(/Case command receipts are immutable/);

    // Direct TRUNCATE on case_command_receipt blocked (immutability)
    await expect(
      client.query('TRUNCATE public.case_command_receipt')
    ).rejects.toThrow(/Case command receipts are immutable/);
  });
});
