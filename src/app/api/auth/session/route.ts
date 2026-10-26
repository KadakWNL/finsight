import { NextResponse } from 'next/server';
import { validateSession, SESSION_COOKIE_NAME } from '@/server/session';

export async function GET(request: Request) {
  try {
    let sessionId: string | undefined;

    // Check Cookie header
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`));
      if (match) {
        sessionId = decodeURIComponent(match[1]);
      }
    }

    // Check Bearer authorization header
    if (!sessionId) {
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        sessionId = authHeader.slice(7).trim();
      }
    }

    if (!sessionId) {
      return NextResponse.json({ authenticated: false, reason: 'no_session' }, { status: 401 });
    }

    const validation = await validateSession(sessionId);
    if (!validation.valid) {
      return NextResponse.json({ authenticated: false, reason: validation.reason }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      user: validation.user,
      session: validation.session,
    });
  } catch {
    return NextResponse.json({ authenticated: false, reason: 'error' }, { status: 500 });
  }
}
