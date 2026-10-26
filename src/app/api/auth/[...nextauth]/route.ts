import NextAuth from 'next-auth';
import { authOptions } from '@/server/auth-config';
import { NextRequest, NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/server/auth-security';

const handler = NextAuth(authOptions);

export { handler as GET };

export async function POST(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return handler(request, context);
}
