import { NextResponse } from 'next/server';
import { revokeSession, SESSION_COOKIE_NAME } from '@/server/session';

export async function POST(request: Request) {
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

    if (sessionId) {
      await revokeSession(sessionId, 'sign_out');
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  } catch {
    return NextResponse.json({ ok: true });
  }
}
