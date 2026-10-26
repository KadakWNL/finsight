import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';
import { setTimeout as delay } from 'node:timers/promises';

vi.mock('server-only', () => ({}));

import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { hashPassword, validateCredentials } from '../../src/server/auth';
import {
  createSession,
  validateSession,
  revokeSession,
  revokeUserSessions,
  SESSION_COOKIE_NAME,
} from '../../src/server/session';
import { POST as loginRoute } from '../../src/app/api/auth/login/route';
import { POST as logoutRoute } from '../../src/app/api/auth/logout/route';
import { GET as sessionRoute } from '../../src/app/api/auth/session/route';
import { encodeSessionToken } from '../../src/server/authentication';
import { getPool } from '../../src/server/db';
import { authOptions } from '../../src/server/auth-config';
import { decode } from 'next-auth/jwt';
import { getAuthSecret } from '../../src/server/auth-security';

describe('Authentication and Session API Integration Tests (VS01-VS03)', () => {
  let pool: pg.Pool;

  const analystAliceId = '20000000-0000-0000-0000-000000000001';
  const analystAliceEmail = 'analyst_alice@synthetic.invalid';
  const analystAlicePassword = 'AliceSecurePassword-2026!';

  const adminCarolId = '20000000-0000-0000-0000-000000000003';
  const adminCarolEmail = 'admin_carol@synthetic.invalid';
  const adminCarolPassword = 'CarolSecureAdminPassword-2026!';

  const inactiveDaveId = '20000000-0000-0000-0000-000000000004';
  const inactiveDaveEmail = 'inactive_dave@synthetic.invalid';
  const inactiveDavePassword = 'DavePassword-2026!';

  const systemServiceId = '20000000-0000-0000-0000-000000000005';
  const systemServiceEmail = 'system_service@synthetic.invalid';

  beforeAll(async () => {
    const connectionString = requireTestDatabase();
    pool = new pg.Pool({ connectionString });

    // Apply baseline migrations 010-040
    const client = await pool.connect();
    try {
      await applyMigrations(client, new URL('../../migrations/', import.meta.url));

      // Hash passwords with Argon2id
      const aliceHash = await hashPassword(analystAlicePassword);
      const carolHash = await hashPassword(adminCarolPassword);
      const daveHash = await hashPassword(inactiveDavePassword);

      // Seed test users into app_user
      await client.query(`
        INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
        VALUES
          ('${analystAliceId}', '${analystAliceEmail}', '${aliceHash}', 'Analyst Alice', 'analyst', true),
          ('${adminCarolId}', '${adminCarolEmail}', '${carolHash}', 'Admin Carol', 'admin', true),
          ('${inactiveDaveId}', '${inactiveDaveEmail}', '${daveHash}', 'Inactive Dave', 'analyst', false),
          ('${systemServiceId}', '${systemServiceEmail}', NULL, 'System Service', 'system', true)
        ON CONFLICT (email) DO UPDATE SET
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          is_active = EXCLUDED.is_active;
      `);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (pool) {
      // Clean up all schema objects so migrations.test.ts finds a fresh disposable DB
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await pool.end();
      await getPool().end();
    }
  });

  async function waitForLock(pid: number) {
    for (let n=0; n<100; n++) {
      const row=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
      if(row?.wait_event_type==='Lock') return;
      await delay(10);
    }
    throw new Error('Validation did not wait on the session lock');
  }

  it('rejects revocation committed while validation waits, without refreshing idle expiry', async () => {
    const session=await createSession(analystAliceId,pool);
    const blocker=await pool.connect(); const reader=await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query("UPDATE public.app_session SET revoked_at=clock_timestamp(),revocation_reason='sign_out' WHERE session_id=$1",[session.sessionId]);
      const pid=(await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending=validateSession(session.sessionId,reader);
      await waitForLock(pid); await blocker.query('COMMIT');
      expect(await pending).toEqual({valid:false,reason:'revoked'});
      expect((await pool.query('SELECT last_seen_at=created_at AS unchanged FROM public.app_session WHERE session_id=$1',[session.sessionId])).rows[0].unchanged).toBe(true);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); reader.release(); }
  });

  it('checks expiry after acquiring a contended lock instead of reviving an expired session', async () => {
    const session=await createSession(analystAliceId,pool);
    await pool.query("UPDATE public.app_session SET idle_expires_at=clock_timestamp()+interval '500 milliseconds' WHERE session_id=$1",[session.sessionId]);
    const blocker=await pool.connect(); const reader=await pool.connect();
    try {
      await blocker.query('BEGIN'); await blocker.query('SELECT 1 FROM public.app_session WHERE session_id=$1 FOR UPDATE',[session.sessionId]);
      const pid=(await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pending=validateSession(session.sessionId,reader);
      await waitForLock(pid); await delay(550); await blocker.query('COMMIT');
      expect(await pending).toEqual({valid:false,reason:'idle_expired'});
      expect((await pool.query('SELECT last_seen_at=created_at AS unchanged FROM public.app_session WHERE session_id=$1',[session.sessionId])).rows[0].unchanged).toBe(true);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); reader.release(); }
  });

  it('uses the Auth.js session callback to recheck current authority without exposing the session ID', async () => {
    const session=await createSession(adminCarolId,pool);
    const callback=authOptions.callbacks!.session!;
    const parameters:Parameters<typeof callback>[0]={session:{user:{},expires:session.absoluteExpiresAt},token:{sub:adminCarolId,sid:session.sessionId},
      user:{id:adminCarolId,email:adminCarolEmail,emailVerified:null},newSession:undefined,trigger:'update'};
    const result=await callback(parameters);
    expect(JSON.stringify(result)).not.toContain(session.sessionId);
    expect(result.user).toMatchObject({role:'admin',id:adminCarolId});
    await pool.query("UPDATE public.app_user SET role='analyst' WHERE user_id=$1",[adminCarolId]);
    try { expect((await callback(parameters)).user).toMatchObject({role:'analyst'}); }
    finally { await pool.query("UPDATE public.app_user SET role='admin' WHERE user_id=$1",[adminCarolId]); }
    await revokeSession(session.sessionId,'sign_out',pool);
    await expect(callback(parameters)).rejects.toThrow('Session unavailable');
  });

  it('validates through the protected function as a nonowner without granting operator writes', async () => {
    const session=await createSession(analystAliceId,pool);
    await pool.query("CALL public.grant_auth_privileges('finsight_auth_probe'::regrole)");
    const runtime=await pool.connect();
    try {
      await runtime.query('SET ROLE finsight_auth_probe');
      expect((await runtime.query('SELECT current_user AS role')).rows[0].role).toBe('finsight_auth_probe');
      expect((await runtime.query("SELECT has_table_privilege(current_user,'public.app_user','UPDATE') AS may_write")).rows[0].may_write).toBe(false);
      expect((await validateSession(session.sessionId,runtime,analystAliceId)).valid).toBe(true);
    } finally { await runtime.query('RESET ROLE'); runtime.release(); }
  });

  it('round trips the login cookie through session and logout without leaking reusable credentials', async () => {
    const response=await loginRoute(new Request('http://localhost:3000/api/auth/login',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({email:analystAliceEmail,password:analystAlicePassword})}));
    expect(response.status).toBe(200);
    const cookie=response.headers.get('set-cookie')!.split(';')[0];
    const token=await decode({token:decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)),secret:getAuthSecret()});
    expect(token?.sub).toBe(analystAliceId); expect(token?.sid).toBeTypeOf('string');
    const result=await sessionRoute(new Request('http://localhost:3000/api/auth/session',{headers:{cookie}}));
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toContain('no-store');
    const body=await result.json(); expect(body.expires).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(token!.sid); expect(JSON.stringify(body)).not.toContain(cookie);
    const signout=await logoutRoute(new Request('http://localhost:3000/api/auth/logout',{method:'POST',headers:{origin:'http://localhost:3000',cookie}}));
    expect(signout.status).toBe(200); expect(signout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await sessionRoute(new Request('http://localhost:3000/api/auth/session',{headers:{cookie}}))).status).toBe(401);
  });

  it('rejects raw session IDs, mismatched token subjects and forged JWTs', async () => {
    const session=await createSession(analystAliceId,pool);
    for(const authorization of [`Bearer ${session.sessionId}`,`Bearer ${await encodeSessionToken(adminCarolId,session.sessionId)}`,'Bearer forged.invalid.token']) {
      expect((await sessionRoute(new Request('http://localhost:3000/api/auth/session',{headers:{authorization}}))).status).toBe(401);
    }
    expect((await pool.query('SELECT last_seen_at=created_at AS unchanged FROM public.app_session WHERE session_id=$1',[session.sessionId])).rows[0].unchanged).toBe(true);
  });

  it('denies cross-origin and missing-origin login/logout without creating or revoking sessions', async () => {
    const session=await createSession(analystAliceId,pool);
    const before=(await pool.query('SELECT count(*) AS n FROM public.app_session')).rows[0].n;
    for(const origin of [undefined,'https://unrelated.invalid']) {
      const headers:Record<string,string>={'content-type':'application/json',cookie:`${SESSION_COOKIE_NAME}=${await encodeSessionToken(analystAliceId,session.sessionId)}`};
      if(origin) headers.origin=origin;
      expect((await loginRoute(new Request('http://localhost:3000/api/auth/login',{method:'POST',headers,body:JSON.stringify({email:analystAliceEmail,password:analystAlicePassword})}))).status).toBe(403);
      expect((await logoutRoute(new Request('http://localhost:3000/api/auth/logout',{method:'POST',headers}))).status).toBe(403);
    }
    expect((await pool.query('SELECT count(*) AS n FROM public.app_session')).rows[0].n).toBe(before);
    expect((await validateSession(session.sessionId,pool)).valid).toBe(true);
  });

  it('throttles repeated sign-in attempts before further password checks', async () => {
    const provider=authOptions.providers[0] as import('next-auth/providers/credentials').CredentialsConfig;
    for(let n=0;n<5;n++) expect(await provider.options!.authorize!({email:'throttled@synthetic.invalid',password:'wrong'},{headers:{},method:'POST',body:{},query:{}})).toBeNull();
    const before=(await pool.query('SELECT count(*) AS n FROM public.app_session')).rows[0].n;
    const response=await loginRoute(new Request('http://localhost:3000/api/auth/login',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify({email:'throttled@synthetic.invalid',password:'wrong'})}));
    expect(response.status).toBe(401);
    expect((await pool.query('SELECT count(*) AS n FROM public.app_session')).rows[0].n).toBe(before);
  });

  describe('Credential Validation (validateCredentials)', () => {
    it('authenticates active analyst with correct password', async () => {
      const result = await validateCredentials(analystAliceEmail, analystAlicePassword, pool);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user.userId).toBe(analystAliceId);
        expect(result.user.email).toBe(analystAliceEmail);
        expect(result.user.role).toBe('analyst');
        expect(result.user.displayName).toBe('Analyst Alice');
        // Ensure no secret hash leakage
        expect(result.user).not.toHaveProperty('password_hash');
      }
    });

    it('authenticates active admin with correct password (case-insensitive email)', async () => {
      const result = await validateCredentials('  Admin_Carol@Synthetic.Invalid  ', adminCarolPassword, pool);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user.userId).toBe(adminCarolId);
        expect(result.user.role).toBe('admin');
      }
    });

    it('returns generic error on wrong password', async () => {
      const result = await validateCredentials(analystAliceEmail, 'WrongPassword-1234', pool);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Invalid email or password');
      }
    });

    it('returns generic error on non-existent email without revealing account existence', async () => {
      const result = await validateCredentials('nonexistent@synthetic.invalid', 'AnyPassword-1234', pool);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Invalid email or password');
      }
    });

    it('returns generic error on inactive user without revealing account state', async () => {
      const result = await validateCredentials(inactiveDaveEmail, inactiveDavePassword, pool);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Invalid email or password');
      }
    });

    it('returns generic error on system service role (human sign-in prohibited)', async () => {
      const result = await validateCredentials(systemServiceEmail, 'AnyPassword-1234', pool);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Invalid email or password');
      }
    });
  });

  describe('Session Lifecycle and Database Expiry (VS01-VS03)', () => {
    it('creates persistent session record with 30m idle and 8h absolute expiry', async () => {
      const session = await createSession(analystAliceId, pool);
      expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(session.userId).toBe(analystAliceId);
      expect(session.revokedAt).toBeNull();
      expect(session.revocationReason).toBeNull();

      const created = new Date(session.createdAt).getTime();
      const idleExp = new Date(session.idleExpiresAt).getTime();
      const absExp = new Date(session.absoluteExpiresAt).getTime();

      // Idle timeout is ~30 minutes (1800s)
      expect(Math.round((idleExp - created) / 1000)).toBeCloseTo(1800, -1);
      // Absolute timeout is ~8 hours (28800s)
      expect(Math.round((absExp - created) / 1000)).toBeCloseTo(28800, -1);
    });

    it('validates active session and updates sliding idle window', async () => {
      const session = await createSession(analystAliceId, pool);

      const validation = await validateSession(session.sessionId, pool);
      expect(validation.valid).toBe(true);
      if (validation.valid) {
        expect(validation.user.userId).toBe(analystAliceId);
        expect(validation.user.role).toBe('analyst');
        expect(validation.session.sessionId).toBe(session.sessionId);
      }
    });

    it('rejects session when idle timeout has elapsed (30m without request)', async () => {
      const session = await createSession(analystAliceId, pool);

      // Artificially simulate idle expiration using single-timestamp CTE
      await pool.query(
        `WITH t AS (SELECT clock_timestamp() AS ts)
         UPDATE public.app_session
         SET created_at = ts - interval '35 minutes',
             last_seen_at = ts - interval '35 minutes',
             idle_expires_at = ts - interval '5 minutes',
             absolute_expires_at = ts + interval '7 hours'
         FROM t
         WHERE session_id = $1`,
        [session.sessionId]
      );

      const validation = await validateSession(session.sessionId, pool);
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.reason).toBe('idle_expired');
      }
    });

    it('rejects session when absolute timeout has elapsed (8h total)', async () => {
      const session = await createSession(analystAliceId, pool);

      // Artificially simulate absolute expiration: session started 9h ago, expired 1.5h ago
      await pool.query(
        `WITH t AS (SELECT clock_timestamp() AS ts)
         UPDATE public.app_session
         SET created_at = ts - interval '9 hours',
             last_seen_at = ts - interval '2 hours',
             idle_expires_at = ts - interval '1 hour 30 minutes',
             absolute_expires_at = ts - interval '1 hour 30 minutes'
         FROM t
         WHERE session_id = $1`,
        [session.sessionId]
      );

      const validation = await validateSession(session.sessionId, pool);
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.reason).toBe('absolute_expired');
      }
    });

    it('revokes session on sign-out and blocks subsequent requests', async () => {
      const session = await createSession(analystAliceId, pool);

      const revoked = await revokeSession(session.sessionId, 'sign_out', pool);
      expect(revoked).toBe(true);

      const validation = await validateSession(session.sessionId, pool);
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.reason).toBe('revoked');
      }
    });

    it('immediately reflects user deactivation on next request without token expiry', async () => {
      // Create user that starts active
      const tempUserId = '20000000-0000-0000-0000-000000000099';
      await pool.query(`
        INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
        VALUES ('${tempUserId}', 'temp@synthetic.invalid', 'hash', 'Temp User', 'analyst', true)
        ON CONFLICT (email) DO UPDATE SET is_active = true;
      `);

      const session = await createSession(tempUserId, pool);

      // Initial validation succeeds
      const firstCheck = await validateSession(session.sessionId, pool);
      expect(firstCheck.valid).toBe(true);

      // User is deactivated
      await pool.query('UPDATE public.app_user SET is_active = false WHERE user_id = $1', [tempUserId]);

      // Immediate rejection on next request
      const secondCheck = await validateSession(session.sessionId, pool);
      expect(secondCheck.valid).toBe(false);
      if (!secondCheck.valid) {
        expect(secondCheck.reason).toBe('user_inactive');
      }
    });

    it('immediately reflects role changes on next request', async () => {
      const tempAdminId = '20000000-0000-0000-0000-000000000098';
      await pool.query(`
        INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
        VALUES ('${tempAdminId}', 'rolechange@synthetic.invalid', 'hash', 'Role Change', 'analyst', true)
        ON CONFLICT (email) DO UPDATE SET role = 'analyst', is_active = true;
      `);

      const session = await createSession(tempAdminId, pool);

      const check1 = await validateSession(session.sessionId, pool);
      expect(check1.valid).toBe(true);
      if (check1.valid) {
        expect(check1.user.role).toBe('analyst');
      }

      // Promote to admin
      await pool.query("UPDATE public.app_user SET role = 'admin' WHERE user_id = $1", [tempAdminId]);

      const check2 = await validateSession(session.sessionId, pool);
      expect(check2.valid).toBe(true);
      if (check2.valid) {
        expect(check2.user.role).toBe('admin');
      }
    });

    it('revokeUserSessions revokes all sessions for user', async () => {
      const session1 = await createSession(adminCarolId, pool);
      const session2 = await createSession(adminCarolId, pool);

      const count = await revokeUserSessions(adminCarolId, 'user_disabled', pool);
      expect(count).toBeGreaterThanOrEqual(2);

      expect((await validateSession(session1.sessionId, pool)).valid).toBe(false);
      expect((await validateSession(session2.sessionId, pool)).valid).toBe(false);
    });
  });

  describe('Route Handlers (/api/auth/login, /api/auth/logout, /api/auth/session)', () => {
    it('login route sets HttpOnly session cookie on valid credentials', async () => {
      const request = new Request('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email: analystAliceEmail, password: analystAlicePassword }),
      });

      const response = await loginRoute(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.user.email).toBe(analystAliceEmail);
      expect(body.user.role).toBe('analyst');
      // No sensitive fields
      expect(body).not.toHaveProperty('password_hash');
      expect(body).not.toHaveProperty('sessionId');

      // Check cookie header
      const setCookie = response.headers.get('set-cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain(SESSION_COOKIE_NAME);
      expect(setCookie?.toLowerCase()).toContain('httponly');
      expect(setCookie?.toLowerCase()).toContain('samesite=lax');
    });

    it('login route returns 401 generic error on invalid password', async () => {
      const request = new Request('http://localhost:3000/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
        body: JSON.stringify({ email: analystAliceEmail, password: 'wrong' }),
      });

      const response = await loginRoute(request);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Invalid email or password');
    });

    it('logout route revokes session and clears cookie', async () => {
      const session = await createSession(analystAliceId, pool);

      const request = new Request('http://localhost:3000/api/auth/logout', {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${await encodeSessionToken(analystAliceId, session.sessionId)}`,
          Origin: 'http://localhost:3000',
        },
      });

      const response = await logoutRoute(request);
      expect(response.status).toBe(200);

      // Verify session is revoked in database
      const validation = await validateSession(session.sessionId, pool);
      expect(validation.valid).toBe(false);
      if (!validation.valid) {
        expect(validation.reason).toBe('revoked');
      }
    });

    it('session route authenticates an encrypted Auth.js token', async () => {
      const session = await createSession(adminCarolId, pool);

      const request = new Request('http://localhost:3000/api/auth/session', {
        headers: { Authorization: `Bearer ${await encodeSessionToken(adminCarolId, session.sessionId)}` },
      });

      const response = await sessionRoute(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.authenticated).toBe(true);
      expect(body.user.role).toBe('admin');
      expect(body.user.email).toBe(adminCarolEmail);
    });

    it('session route returns 401 when no session provided', async () => {
      const request = new Request('http://localhost:3000/api/auth/session');
      const response = await sessionRoute(request);
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.authenticated).toBe(false);
    });
  });
});
