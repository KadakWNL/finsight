import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/server/authentication';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const validation = await authenticateRequest(request);
    if (!validation.valid) return NextResponse.json({ authenticated: false }, { status: 401, headers });
    return NextResponse.json({
      authenticated: true,
      user: { ...validation.user, id: validation.user.userId, name: validation.user.displayName },
      expires: validation.session.absoluteExpiresAt,
      session: { idleExpiresAt: validation.session.idleExpiresAt, absoluteExpiresAt: validation.session.absoluteExpiresAt },
    }, { headers });
  } catch {
    return NextResponse.json({ authenticated: false }, { status: 503, headers });
  }
}
