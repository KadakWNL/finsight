import { NextResponse } from 'next/server';
import { revokeSession } from '@/server/session';
import { readSessionToken } from '@/server/authentication';
import { isSameOriginRequest, sessionCookieName, sessionCookieOptions } from '@/server/auth-security';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const token = await readSessionToken(request);
    if (token) await revokeSession(token.sessionId, 'sign_out');

    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookieName(), '', { ...sessionCookieOptions(), maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: 'Sign-out unavailable' }, { status: 503 });
  }
}
