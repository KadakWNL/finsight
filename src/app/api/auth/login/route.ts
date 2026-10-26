import { NextResponse } from 'next/server';
import { signInWithCredentials, encodeSessionToken } from '@/server/authentication';
import { getAuthSecret, isSameOriginRequest, sessionCookieName, sessionCookieOptions } from '@/server/auth-security';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    getAuthSecret();
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return NextResponse.json({ error: 'Expected JSON' }, { status: 415 });
    }
    const body = await request.json();
    const { email, password } = body ?? {};

    const result = await signInWithCredentials(email, password);
    if (!result) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    const token = await encodeSessionToken(result.user.userId, result.session.sessionId);

    const response = NextResponse.json({
      ok: true,
      user: result.user,
    });

    response.cookies.set(sessionCookieName(), token, {
      ...sessionCookieOptions(),
      maxAge: 8 * 60 * 60, // 8 hours
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 });
  }
}
