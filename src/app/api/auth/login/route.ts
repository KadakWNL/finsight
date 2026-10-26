import { NextResponse } from 'next/server';
import { validateCredentials } from '@/server/auth';
import { createSession, SESSION_COOKIE_NAME } from '@/server/session';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body ?? {};

    const authResult = await validateCredentials(email, password);
    if (!authResult.ok) {
      return NextResponse.json({ error: authResult.error }, { status: 401 });
    }

    const sessionRecord = await createSession(authResult.user.userId);

    const response = NextResponse.json({
      ok: true,
      user: authResult.user,
    });

    response.cookies.set(SESSION_COOKIE_NAME, sessionRecord.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 8 * 60 * 60, // 8 hours
    });

    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }
}
