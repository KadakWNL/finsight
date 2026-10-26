import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';

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
    }
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
          Cookie: `${SESSION_COOKIE_NAME}=${session.sessionId}`,
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

    it('session route authenticates with Bearer token header', async () => {
      const session = await createSession(adminCarolId, pool);

      const request = new Request('http://localhost:3000/api/auth/session', {
        headers: { Authorization: `Bearer ${session.sessionId}` },
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
