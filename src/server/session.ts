import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SqlClient } from './db';
import { getPool } from './db';
import { sessionCookieName } from './auth-security';

export const SESSION_COOKIE_NAME = sessionCookieName();
export const IDLE_TIMEOUT_MINUTES = 30;
export const ABSOLUTE_TIMEOUT_HOURS = 8;

export interface SessionRecord {
  sessionId: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  revocationReason: string | null;
}

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
  role: 'analyst' | 'admin';
}

export type SessionValidationResult =
  | {
      valid: true;
      user: SessionUser;
      session: {
        sessionId: string;
        idleExpiresAt: string;
        absoluteExpiresAt: string;
      };
    }
  | {
      valid: false;
      reason:
        | 'not_found'
        | 'revoked'
        | 'idle_expired'
        | 'absolute_expired'
        | 'user_inactive'
        | 'invalid_role';
    };

export async function createSession(
  userId: string,
  client?: SqlClient
): Promise<SessionRecord> {
  const sessionId = randomUUID();
  const db = client ?? getPool();

  const { rows } = await db.query<{
    session_id: string;
    user_id: string;
    created_at: string;
    last_seen_at: string;
    idle_expires_at: string;
    absolute_expires_at: string;
    revoked_at: string | null;
    revocation_reason: string | null;
  }>(
    `WITH now_time AS (SELECT clock_timestamp() AS t)
     INSERT INTO public.app_session (
       session_id, user_id, created_at, last_seen_at,
       idle_expires_at, absolute_expires_at
     )
     SELECT
       $1, $2, t, t,
       t + interval '30 minutes',
       t + interval '8 hours'
     FROM now_time
     RETURNING
       session_id, user_id,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
       to_char(last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_seen_at,
       to_char(idle_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS idle_expires_at,
       to_char(absolute_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS absolute_expires_at,
       revoked_at, revocation_reason`,
    [sessionId, userId]
  );

  const row = rows[0];
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason,
  };
}

export async function validateSession(
  sessionId: string,
  client?: SqlClient,
  expectedUserId?: string
): Promise<SessionValidationResult> {
  if (!sessionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return { valid: false, reason: 'not_found' };
  }
  if (expectedUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedUserId)) {
    return { valid: false, reason: 'not_found' };
  }

  const db = client ?? getPool();

  const { rows } = await db.query<{
    session_id: string;
    user_id: string;
    created_at: string;
    last_seen_at: string;
    idle_expires_at: string;
    absolute_expires_at: string;
    revoked_at: string | null;
    is_idle_expired: boolean;
    is_absolute_expired: boolean;
    email: string;
    display_name: string;
    role: string;
    is_active: boolean;
    refreshed_id: string | null;
  }>(
    `SELECT * FROM public.validate_app_session($1, $2)`,
    [sessionId, expectedUserId ?? null]
  );

  const session = rows[0];
  if (!session) {
    return { valid: false, reason: 'not_found' };
  }

  if (session.revoked_at !== null) {
    return { valid: false, reason: 'revoked' };
  }

  if (session.is_absolute_expired) {
    return { valid: false, reason: 'absolute_expired' };
  }

  if (session.is_idle_expired) {
    return { valid: false, reason: 'idle_expired' };
  }

  if (!session.is_active) {
    return { valid: false, reason: 'user_inactive' };
  }

  if (session.role !== 'analyst' && session.role !== 'admin') {
    return { valid: false, reason: 'invalid_role' };
  }

  if (!session.refreshed_id) return { valid: false, reason: 'not_found' };

  return {
    valid: true,
    user: {
      userId: session.user_id,
      email: session.email,
      displayName: session.display_name,
      role: session.role as 'analyst' | 'admin',
    },
    session: {
      sessionId: session.session_id,
      idleExpiresAt: session.idle_expires_at,
      absoluteExpiresAt: session.absolute_expires_at,
    },
  };
}

export async function revokeSession(
  sessionId: string,
  reason: 'sign_out' | 'user_disabled' | 'security' = 'sign_out',
  client?: SqlClient
): Promise<boolean> {
  const db = client ?? getPool();

  const { rowCount } = await db.query(
    `UPDATE public.app_session
     SET revoked_at = clock_timestamp(),
         revocation_reason = $2
     WHERE session_id = $1 AND revoked_at IS NULL`,
    [sessionId, reason]
  );

  return (rowCount ?? 0) > 0;
}

export async function revokeUserSessions(
  userId: string,
  reason: 'user_disabled' | 'security' = 'user_disabled',
  client?: SqlClient
): Promise<number> {
  const db = client ?? getPool();

  const { rowCount } = await db.query(
    `UPDATE public.app_session
     SET revoked_at = clock_timestamp(),
         revocation_reason = $2
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason]
  );

  return rowCount ?? 0;
}
