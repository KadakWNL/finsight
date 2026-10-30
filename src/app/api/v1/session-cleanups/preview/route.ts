import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/server/authentication';
import { isSameOriginRequest } from '@/server/auth-security';
import { getPool } from '@/server/db';
import { previewSessionCleanup } from '@/server/session-cleanup';

const headers = { 'Cache-Control': 'private, no-store' };

function failure(status: number, code: string, message: string, requestId: string, fields?: Record<string, string>) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(fields ? { fields } : {}),
      },
      request_id: requestId,
    },
    { status, headers }
  );
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  if (!isSameOriginRequest(request)) {
    return failure(403, 'forbidden', 'Cross-origin request denied.', requestId);
  }

  try {
    const validation = await authenticateRequest(request);
    if (!validation.valid) {
      return failure(401, 'unauthenticated', 'Sign in to continue.', requestId);
    }

    const actor = validation.user;
    if (actor.role !== 'admin') {
      return failure(403, 'forbidden', 'Only active administrators can preview session cleanup.', requestId);
    }

    const url = new URL(request.url);
    if (url.search) {
      return failure(400, 'invalid_request', 'Preview endpoint does not accept query parameters.', requestId);
    }

    // Reject client-supplied body attempting to dictate cutoff or candidate IDs
    try {
      const text = await request.text();
      if (text.trim().length > 0) {
        const body = JSON.parse(text);
        if (typeof body === 'object' && body !== null && ('cutoff' in body || 'session_ids' in body || 'candidate_session_ids' in body)) {
          return failure(400, 'invalid_request', 'Client cannot supply candidate session IDs or cutoff.', requestId);
        }
      }
    } catch {
      // Empty or non-JSON body is acceptable for preview
    }

    const data = await previewSessionCleanup(getPool(), actor.userId);
    return NextResponse.json({ data, request_id: requestId }, { headers, status: 200 });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err.code === '42501') {
      return failure(403, 'forbidden', err.message || 'Permission denied.', requestId);
    }
    return failure(503, 'service_unavailable', 'Session cleanup preview is temporarily unavailable.', requestId);
  }
}
