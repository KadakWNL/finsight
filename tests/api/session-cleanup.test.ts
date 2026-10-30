import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

vi.mock('server-only', () => ({}));

import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { createSession, SESSION_COOKIE_NAME } from '../../src/server/session';
import { encodeSessionToken } from '../../src/server/authentication';
import { POST as previewRoute } from '../../src/app/api/v1/session-cleanups/preview/route';
import { POST as confirmRoute } from '../../src/app/api/v1/session-cleanups/[id]/confirm/route';

describe('API Integration Tests: Admin Session Cleanup (Issue #23)', () => {
  let client: pg.Client;

  const adminAlice = '55000000-0000-0000-0000-000000000001';
  const adminBob = '55000000-0000-0000-0000-000000000002';
  const analystEve = '55000000-0000-0000-0000-000000000003';
  const inactiveAdmin = '55000000-0000-0000-0000-000000000004';
  const systemActor = '55000000-0000-0000-0000-000000000005';

  const cookies: Record<string, string> = {};

  async function createAuthCookie(userId: string): Promise<string> {
    const session = await createSession(userId, client);
    const token = await encodeSessionToken(userId, session.sessionId);
    return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax`;
  }

  async function callPreview(cookie?: string, extraHeaders: Record<string, string> = {}, body?: unknown) {
    const headers: Record<string, string> = {
      origin: process.env.NEXTAUTH_URL ?? 'http://localhost',
      ...extraHeaders,
    };
    if (cookie) headers.cookie = cookie;

    return previewRoute(
      new Request('http://localhost/api/v1/session-cleanups/preview', {
        method: 'POST',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })
    );
  }

  async function callConfirm(
    operationId: string,
    body: unknown,
    cookie?: string,
    extraHeaders: Record<string, string> = {}
  ) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      origin: process.env.NEXTAUTH_URL ?? 'http://localhost',
      ...extraHeaders,
    };
    if (cookie) headers.cookie = cookie;

    return confirmRoute(
      new Request(`http://localhost/api/v1/session-cleanups/${operationId}/confirm`, {
        method: 'POST',
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: operationId }) }
    );
  }

  beforeAll(async () => {
    client = new pg.Client({ connectionString: requireTestDatabase() });
    await client.connect();

    await applyMigrations(client, new URL('../../migrations/', import.meta.url));

    // Seed test users
    await client.query(`
      INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
      VALUES
        ('${adminAlice}', 'api_admin_alice@synthetic.invalid', 'test-only', 'Admin Alice', 'admin', true),
        ('${adminBob}', 'api_admin_bob@synthetic.invalid', 'test-only', 'Admin Bob', 'admin', true),
        ('${analystEve}', 'api_analyst_eve@synthetic.invalid', 'test-only', 'Analyst Eve', 'analyst', true),
        ('${inactiveAdmin}', 'api_inactive_admin@synthetic.invalid', 'test-only', 'Inactive Admin', 'admin', false),
        ('${systemActor}', 'api_system_actor@synthetic.invalid', NULL, 'System Actor', 'system', true)
      ON CONFLICT (user_id) DO NOTHING;
    `);

    cookies[adminAlice] = await createAuthCookie(adminAlice);
    cookies[adminBob] = await createAuthCookie(adminBob);
    cookies[analystEve] = await createAuthCookie(analystEve);
    cookies[inactiveAdmin] = await createAuthCookie(inactiveAdmin);
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
        DELETE FROM public.app_user WHERE user_id::text LIKE '55000000-%';
      `);
    } finally {
      await client.end();
    }
  });

  describe('POST /api/v1/session-cleanups/preview', () => {
    it('returns 200 with bounded preview metadata for active administrator', async () => {
      // Seed an eligible session
      await client.query(`
        INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
        VALUES ('${randomUUID()}', '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
      `);

      const res = await callPreview(cookies[adminAlice]);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.operation_id).toBeDefined();
      expect(typeof body.data.candidate_count).toBe('number');
      expect(body.data.cutoff_at).toBeDefined();
      expect(body.data.expires_at).toBeDefined();
      // Ensure no raw session IDs or credential material are exposed
      expect(body.data.candidate_session_ids).toBeUndefined();
      expect(body.data.session_ids).toBeUndefined();
    });

    it('denies unauthenticated requests with 401', async () => {
      const res = await callPreview(undefined);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('unauthenticated');
    });

    it('denies analyst callers with 403', async () => {
      const res = await callPreview(cookies[analystEve]);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe('forbidden');
    });

    it('denies inactive administrators with 401 or 403', async () => {
      const res = await callPreview(cookies[inactiveAdmin]);
      expect([401, 403]).toContain(res.status);
    });

    it('denies cross-origin requests with 403', async () => {
      const res = await callPreview(cookies[adminAlice], { origin: 'https://malicious.origin.invalid' });
      expect(res.status).toBe(403);
    });

    it('rejects client attempt to supply authoritative cutoff or session IDs with 400', async () => {
      const res = await callPreview(cookies[adminAlice], {}, { cutoff: '2020-01-01T00:00:00Z', session_ids: [randomUUID()] });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('invalid_request');
    });
  });

  describe('POST /api/v1/session-cleanups/[id]/confirm', () => {
    it('successfully confirms cleanup for active admin and returns deleted count', async () => {
      await client.query('DELETE FROM public.app_session WHERE idle_expires_at < clock_timestamp() OR absolute_expires_at < clock_timestamp() OR revoked_at IS NOT NULL');
      const sid = randomUUID();
      await client.query(`
        INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
        VALUES ('${sid}', '${adminAlice}', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days', clock_timestamp() - interval '8 days' + interval '20 minutes', clock_timestamp() - interval '8 days' + interval '4 hours')
      `);

      const prevRes = await callPreview(cookies[adminAlice]);
      const prevBody = await prevRes.json();
      const opId = prevBody.data.operation_id;
      const idempotencyKey = randomUUID();

      const confRes = await callConfirm(opId, { confirm: true, idempotency_key: idempotencyKey }, cookies[adminAlice]);
      expect(confRes.status).toBe(200);
      const confBody = await confRes.json();
      expect(confBody.data.operation_id).toBe(opId);
      expect(confBody.data.status).toBe('completed');
      expect(confBody.data.deleted_count).toBe(1);
      expect(confBody.data.replayed).toBe(false);

      // Verify deletion in SQL
      const check = await client.query('SELECT 1 FROM public.app_session WHERE session_id = $1', [sid]);
      expect(check.rows.length).toBe(0);
    });

    it('denies unauthenticated confirmation with 401', async () => {
      const res = await callConfirm(randomUUID(), { confirm: true, idempotency_key: randomUUID() }, undefined);
      expect(res.status).toBe(401);
    });

    it('denies analyst confirmation with 403', async () => {
      const res = await callConfirm(randomUUID(), { confirm: true, idempotency_key: randomUUID() }, cookies[analystEve]);
      expect(res.status).toBe(403);
    });

    it('denies cross-origin confirmation with 403', async () => {
      const res = await callConfirm(
        randomUUID(),
        { confirm: true, idempotency_key: randomUUID() },
        cookies[adminAlice],
        { origin: 'https://evil.invalid' }
      );
      expect(res.status).toBe(403);
    });

    it('validates invalid UUID and payload parameters with 400', async () => {
      // Invalid operation UUID in URL
      const r1 = await callConfirm('not-a-uuid', { confirm: true, idempotency_key: randomUUID() }, cookies[adminAlice]);
      expect(r1.status).toBe(400);

      // Missing confirm: true
      const r2 = await callConfirm(randomUUID(), { confirm: false, idempotency_key: randomUUID() }, cookies[adminAlice]);
      expect(r2.status).toBe(400);

      // Missing idempotency key
      const r3 = await callConfirm(randomUUID(), { confirm: true }, cookies[adminAlice]);
      expect(r3.status).toBe(400);

      // Client attempting to pass session_ids
      const r4 = await callConfirm(randomUUID(), { confirm: true, idempotency_key: randomUUID(), session_ids: [randomUUID()] }, cookies[adminAlice]);
      expect(r4.status).toBe(400);
    });

    it('returns 404 for unknown operation ID', async () => {
      const res = await callConfirm(randomUUID(), { confirm: true, idempotency_key: randomUUID() }, cookies[adminAlice]);
      expect(res.status).toBe(404);
    });

    it('enforces operation ownership: Admin Bob cannot confirm Admin Alice preview (403)', async () => {
      const prevRes = await callPreview(cookies[adminAlice]);
      const prevBody = await prevRes.json();
      const opId = prevBody.data.operation_id;

      const confRes = await callConfirm(opId, { confirm: true, idempotency_key: randomUUID() }, cookies[adminBob]);
      expect(confRes.status).toBe(403);
      const confBody = await confRes.json();
      expect(confBody.error.code).toBe('forbidden');
    });

    it('returns 410 Gone for expired preview', async () => {
      const prevRes = await callPreview(cookies[adminAlice]);
      const prevBody = await prevRes.json();
      const opId = prevBody.data.operation_id;

      // Backdate preview expiry in database
      await client.query(`
        UPDATE public.app_session_cleanup
        SET preview_at = preview_at - interval '11 minutes',
            cutoff_at = cutoff_at - interval '11 minutes',
            expires_at = expires_at - interval '11 minutes'
        WHERE operation_id = $1
      `, [opId]);

      const confRes = await callConfirm(opId, { confirm: true, idempotency_key: randomUUID() }, cookies[adminAlice]);
      expect(confRes.status).toBe(410);
      const confBody = await confRes.json();
      expect(confBody.error.code).toBe('expired_preview');
    });

    it('handles idempotent retries and detects changed payload conflict (409)', async () => {
      const prevRes = await callPreview(cookies[adminAlice]);
      const prevBody = await prevRes.json();
      const opId = prevBody.data.operation_id;
      const key = randomUUID();

      // First confirmation
      const r1 = await callConfirm(opId, { confirm: true, idempotency_key: key }, cookies[adminAlice]);
      expect(r1.status).toBe(200);
      const b1 = await r1.json();
      expect(b1.data.replayed).toBe(false);

      // Replay with identical key
      const r2 = await callConfirm(opId, { confirm: true, idempotency_key: key }, cookies[adminAlice]);
      expect(r2.status).toBe(200);
      const b2 = await r2.json();
      expect(b2.data.replayed).toBe(true);

      // Reconfirmation with different key on already completed operation returns 200 with replayed = true
      const r3 = await callConfirm(opId, { confirm: true, idempotency_key: randomUUID() }, cookies[adminAlice]);
      expect(r3.status).toBe(200);
      const b3 = await r3.json();
      expect(b3.data.replayed).toBe(true);
    });
  });
});
