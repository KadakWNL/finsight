import 'server-only';
import type { NextApiRequest } from 'next';
import { encode, getToken } from 'next-auth/jwt';
import { validateCredentials } from './auth';
import { createSession, validateSession } from './session';
import { getAuthSecret, sessionCookieName } from './auth-security';
import { consumeLoginAttempt } from './login-limit';

export async function signInWithCredentials(email: string, password: string) {
  getAuthSecret();
  if (typeof email !== 'string' || typeof password !== 'string'
      || email.length > 320 || password.length > 1024 || !consumeLoginAttempt(email)) return null;
  const result = await validateCredentials(email, password);
  if (!result.ok) return null;
  const session = await createSession(result.user.userId);
  return { user: result.user, session };
}

export async function encodeSessionToken(userId: string, sessionId: string) {
  return encode({ secret: getAuthSecret(), token: { sub: userId, sid: sessionId }, maxAge: 8 * 60 * 60 });
}

export async function readSessionToken(request: Request) {
  const cookies: Record<string, string> = {};
  for (const part of request.headers.get('cookie')?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    try { cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return null; }
  }
  const req = { cookies, headers: { authorization: request.headers.get('authorization') ?? undefined } } as NextApiRequest;
  const token = await getToken({ req, secret: getAuthSecret(), cookieName: sessionCookieName() });
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!token || typeof token.sid !== 'string' || typeof token.sub !== 'string'
      || !uuid.test(token.sid) || !uuid.test(token.sub)) return null;
  return { sessionId: token.sid, userId: token.sub };
}

export async function authenticateRequest(request: Request) {
  const token = await readSessionToken(request);
  if (!token) return { valid: false as const, reason: 'not_found' as const };
  return validateSession(token.sessionId, undefined, token.userId);
}
