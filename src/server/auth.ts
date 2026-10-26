import 'server-only';
import argon2 from 'argon2';
import type { SqlClient } from './db';
import { getPool } from './db';

export const OWASP_ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,       // 2 iterations
  parallelism: 1,    // 1 lane
};

// Static precomputed dummy Argon2id hash for constant-time rejection of invalid/inactive/system emails
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0Zm9yZmluc2lnaHQ$dummyhashdummyhashdummyhashdummyhashdummyha';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { ...OWASP_ARGON2_OPTIONS, raw: false });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  displayName: string;
  role: 'analyst' | 'admin';
}

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; error: 'Invalid email or password' };

export async function validateCredentials(
  email: string,
  password: string,
  client?: SqlClient
): Promise<AuthResult> {
  const genericError: AuthResult = { ok: false, error: 'Invalid email or password' };

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return genericError;
  }

  const normalized = normalizeEmail(email);
  if (!normalized) {
    return genericError;
  }

  const db = client ?? getPool();

  const { rows } = await db.query<{
    user_id: string;
    email: string;
    password_hash: string | null;
    display_name: string;
    role: string;
    is_active: boolean;
  }>(
    `SELECT user_id, email, password_hash, display_name, role, is_active
     FROM public.app_user
     WHERE email = lower(btrim($1))`,
    [normalized]
  );

  const user = rows[0];

  // If user doesn't exist, has no password hash, is inactive, or has system role:
  // Execute dummy verification to preserve constant-time execution against timing attacks.
  if (
    !user ||
    !user.password_hash ||
    !user.is_active ||
    user.role === 'system' ||
    (user.role !== 'analyst' && user.role !== 'admin')
  ) {
    await verifyPassword(password, DUMMY_ARGON2_HASH);
    return genericError;
  }

  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) {
    return genericError;
  }

  return {
    ok: true,
    user: {
      userId: user.user_id,
      email: user.email,
      displayName: user.display_name,
      role: user.role as 'analyst' | 'admin',
    },
  };
}
