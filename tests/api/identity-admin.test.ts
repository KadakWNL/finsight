import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

vi.mock('server-only', () => ({}));

import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { seedFinancial, syntheticId } from '../../scripts/financial-seed.mjs';
import { createSession, SESSION_COOKIE_NAME } from '../../src/server/session';
import { encodeSessionToken } from '../../src/server/authentication';
import { validateCredentials } from '../../src/server/auth';
import { getPool } from '../../src/server/db';
import { GET as listUsers, POST as createUser } from '../../src/app/api/v1/users/route';
import { PATCH as updateUser } from '../../src/app/api/v1/users/[id]/route';

let client: pg.Client;

const adminUser = '56000000-0000-0000-0000-000000000001';
const analystUser = '56000000-0000-0000-0000-000000000002';
const inactiveAdmin = '56000000-0000-0000-0000-000000000003';
const systemUser = '56000000-0000-0000-0000-000000000004';

const cookies: Record<string, string> = {};
let caseId: string;
let createdUserId = '';

async function cookieFor(userId: string) {
  const session = await createSession(userId, client);
  return `${SESSION_COOKIE_NAME}=${await encodeSessionToken(userId, session.sessionId)}`;
}

function origin() {
  return process.env.NEXTAUTH_URL ?? 'http://localhost';
}

async function callList(who?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (who) headers.cookie = cookies[who];
  return listUsers(new Request('http://localhost/api/v1/users', { headers }));
}

async function callCreate(body: unknown, who?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: origin(),
    ...extraHeaders,
  };
  if (who) headers.cookie = cookies[who];
  return createUser(new Request('http://localhost/api/v1/users', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

async function callUpdate(userId: string, body: unknown, who?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: origin(),
    ...extraHeaders,
  };
  if (who) headers.cookie = cookies[who];
  return updateUser(
    new Request(`http://localhost/api/v1/users/${userId}`, {
      method: 'PATCH',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: userId }) }
  );
}

beforeAll(async () => {
  client = new pg.Client({ connectionString: requireTestDatabase() });
  await client.connect();
  await applyMigrations(client, new URL('../../migrations/', import.meta.url));
  await seedFinancial(client);

  for (const [userId, email, role, active] of [
    [adminUser, 'identity_admin@synthetic.invalid', 'admin', true],
    [analystUser, 'identity_analyst@synthetic.invalid', 'analyst', true],
    [inactiveAdmin, 'identity_inactive_admin@synthetic.invalid', 'admin', false],
    [systemUser, 'identity_system@synthetic.invalid', 'system', true],
  ] as const) {
    await client.query(
      `INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET role = $5, is_active = $6`,
      [userId, email, role === 'system' ? null : 'test-only-hash', `Identity ${role}`, role, active]
    );
  }

  cookies[adminUser] = await cookieFor(adminUser);
  cookies[analystUser] = await cookieFor(analystUser);
  cookies[inactiveAdmin] = await cookieFor(inactiveAdmin);
  // A second live session proves deactivation revokes every session.
  await createSession(analystUser, client);

  const created = await client.query(
    `SELECT * FROM public.execute_case_command(
       'create', $1, $2, repeat('b', 64), NULL, NULL, $3, 'high',
       'Synthetic identity administration case', NULL, NULL, $4)`,
    [analystUser, randomUUID(), syntheticId(107), 'CASE-ID-' + randomUUID().slice(0, 8).toUpperCase()]
  );
  caseId = created.rows[0].case_id;
});

afterAll(async () => {
  if (client) {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.end();
    await getPool().end();
  }
});

describe('Analyst account administration API', () => {
  it('lists analysts without credential material for administrators only', async () => {
    const res = await callList(adminUser);
    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.data.find((item: { user_id: string }) => item.user_id === analystUser);
    expect(row).toMatchObject({
      email: 'identity_analyst@synthetic.invalid',
      is_active: true,
      active_case_count: 1,
    });
    expect(row.role).toBeUndefined();
    expect(row.password_hash).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('test-only-hash');

    expect((await callList(analystUser)).status).toBe(403);
    expect((await callList()).status).toBe(401);
    expect([401, 403]).toContain((await callList(inactiveAdmin)).status);
    expect((await callList(adminUser, { origin: 'https://evil.invalid' })).status).toBe(200);
  });

  it('creates an analyst with normalized email and never returns the password', async () => {
    const email = `  New.Analyst.${randomUUID().slice(0, 8)}@Synthetic.Invalid `;
    const res = await callCreate({ email, display_name: '  New Analyst  ', password: 'initial-password-123' }, adminUser);
    expect(res.status).toBe(201);
    const body = await res.json();
    createdUserId = body.data.user_id;
    expect(body.data.email).toBe(email.trim().toLowerCase());
    expect(body.data.display_name).toBe('New Analyst');
    expect(body.data.is_active).toBe(true);
    expect(JSON.stringify(body)).not.toContain('initial-password-123');
    expect(JSON.stringify(body)).not.toContain('$argon2');

    const duplicate = await callCreate({ email: body.data.email, display_name: 'Duplicate', password: 'initial-password-123' }, adminUser);
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe('email_exists');
  });

  it('rejects unauthorized, cross-origin, malformed and over-privileged creation', async () => {
    expect((await callCreate({ email: 'x@synthetic.invalid', display_name: 'X', password: 'long-enough-password' }, analystUser)).status).toBe(403);
    expect((await callCreate({ email: 'x@synthetic.invalid', display_name: 'X', password: 'long-enough-password' })).status).toBe(401);
    expect((await callCreate({ email: 'x@synthetic.invalid', display_name: 'X', password: 'long-enough-password' }, adminUser, { origin: 'https://evil.invalid' })).status).toBe(403);
    expect((await callCreate({ email: 'x@synthetic.invalid', display_name: 'X', password: 'short' }, adminUser)).status).toBe(400);
    expect((await callCreate({ email: 'x@synthetic.invalid', display_name: 'X', password: 'long-enough-password', role: 'admin' }, adminUser)).status).toBe(400);
    expect((await callCreate('{', adminUser)).status).toBe(400);
  });

  it('deactivates, reactivates and resets passwords with immediate session revocation', async () => {
    const email = (await (await callList(adminUser)).json()).data.find((item: { user_id: string }) => item.user_id === createdUserId).email;

    const deactivated = await callUpdate(createdUserId, { action: 'deactivate', reason: 'left the team' }, adminUser);
    expect(deactivated.status).toBe(200);
    expect((await deactivated.json()).data.is_active).toBe(false);
    expect((await validateCredentials(email, 'initial-password-123')).ok).toBe(false);

    const reactivated = await callUpdate(createdUserId, { action: 'reactivate', password: 'replacement-password-456' }, adminUser);
    expect(reactivated.status).toBe(200);
    expect((await reactivated.json()).data.is_active).toBe(true);
    expect((await validateCredentials(email, 'initial-password-123')).ok).toBe(false);
    expect((await validateCredentials(email, 'replacement-password-456')).ok).toBe(true);

    const reset = await callUpdate(createdUserId, { action: 'reset_password', password: 'final-password-789' }, adminUser);
    expect(reset.status).toBe(200);
    expect((await validateCredentials(email, 'replacement-password-456')).ok).toBe(false);
    expect((await validateCredentials(email, 'final-password-789')).ok).toBe(true);

    expect((await callUpdate(createdUserId, { action: 'reset_password', password: 'final-password-789' }, analystUser)).status).toBe(403);
    expect((await callUpdate(createdUserId, { action: 'reactivate', password: 'final-password-789' }, adminUser)).status).toBe(422);
  });

  it('deactivation unassigns active cases with an immutable audit event and revokes sessions', async () => {
    const res = await callUpdate(analystUser, { action: 'deactivate' }, adminUser);
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.is_active).toBe(false);
    expect(data.unassigned_case_count).toBe(1);
    expect(data.sessions_revoked).toBeGreaterThanOrEqual(2);

    const caseRow = (await client.query(
      `SELECT assigned_to_user_id, version FROM public.investigation_case WHERE case_id = $1`, [caseId]
    )).rows[0];
    expect(caseRow.assigned_to_user_id).toBeNull();
    expect(Number(caseRow.version)).toBe(2);

    const events = (await client.query(
      `SELECT event_type, from_state, to_state, reason, operation_id
       FROM public.case_event WHERE case_id = $1 ORDER BY event_id`, [caseId]
    )).rows;
    expect(events.filter((event: { event_type: string }) => event.event_type === 'assigned')).toHaveLength(2);
    const unassigned = events.at(-1)!;
    expect(unassigned.from_state).toEqual({ assigned_to_user_id: analystUser });
    expect(unassigned.to_state).toEqual({ assigned_to_user_id: null });
    expect(unassigned.reason).toBe('Analyst account deactivated');
    expect(unassigned.operation_id).toBeTruthy();

    const audit = (await client.query(
      `SELECT action, actor_user_id, target_user_id, details FROM public.admin_audit_event
       WHERE target_user_id = $1 AND action = 'analyst_deactivated'`, [analystUser]
    )).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(adminUser);
    expect(audit[0].details.unassigned_case_count).toBe(1);

    expect((await callList(analystUser)).status).toBe(401);

    const repeated = await callUpdate(analystUser, { action: 'deactivate' }, adminUser);
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).data.unassigned_case_count).toBe(0);

    expect((await callUpdate(analystUser, { action: 'reset_password', password: 'final-password-789' }, adminUser)).status).toBe(422);
  });

  it('rejects administrator and unknown targets without changing them', async () => {
    const adminTarget = await callUpdate(adminUser, { action: 'deactivate' }, adminUser);
    expect(adminTarget.status).toBe(422);
    expect((await client.query(`SELECT is_active FROM public.app_user WHERE user_id = $1`, [adminUser])).rows[0].is_active).toBe(true);

    expect((await callUpdate(randomUUID(), { action: 'deactivate' }, adminUser)).status).toBe(404);
    expect((await callUpdate(createdUserId, { action: 'deactivate', password: 'x' }, adminUser)).status).toBe(400);
  });

  it('keeps administrative audit rows immutable and free of credential material', async () => {
    const auditText = (await client.query('SELECT details::text AS details FROM public.admin_audit_event')).rows
      .map((row: { details: string }) => row.details).join(' ');
    expect(auditText).not.toContain('$argon2');
    expect(auditText).not.toContain('final-password-789');

    await expect(client.query(`UPDATE public.admin_audit_event SET action = 'password_reset'`))
      .rejects.toMatchObject({ code: '55000' });
    await expect(client.query('DELETE FROM public.admin_audit_event'))
      .rejects.toMatchObject({ code: '55000' });
  });
});
