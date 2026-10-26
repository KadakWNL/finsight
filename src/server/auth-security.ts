import 'server-only';

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set AUTH_SECRET to at least 32 random characters.');
  return secret;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  try {
    return new URL(origin).origin === new URL(process.env.NEXTAUTH_URL || request.url).origin;
  } catch {
    return false;
  }
}

export function sessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-next-auth.session-token' : 'next-auth.session-token';
}

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
}
