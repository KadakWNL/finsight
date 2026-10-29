import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/server/authentication';
import { isSameOriginRequest } from '@/server/auth-security';
import { getPool } from '@/server/db';
import { executeTransactionalConfirm } from '@/server/session-cleanup';
import {
  validateCleanupUuid,
  parseConfirmCleanupPayload,
  SessionCleanupParameterError,
} from '@/server/session-cleanup-parameters';

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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
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
      return failure(403, 'forbidden', 'Only active administrators can confirm session cleanup.', requestId);
    }

    const { id } = await context.params;
    const operationId = validateCleanupUuid(id, 'id');

    let bodyJson: unknown;
    try {
      bodyJson = await request.json();
    } catch {
      return failure(400, 'invalid_request', 'Invalid JSON payload.', requestId);
    }

    const payload = parseConfirmCleanupPayload(bodyJson);

    const result = await executeTransactionalConfirm(getPool(), {
      operationId,
      adminUserId: actor.userId,
      idempotencyKey: payload.idempotency_key,
      rawPayloadForHash: {
        confirm: true,
        idempotency_key: payload.idempotency_key,
        operation_id: operationId,
      },
    });

    return NextResponse.json({ data: result, request_id: requestId }, { headers, status: 200 });
  } catch (error: unknown) {
    if (error instanceof SessionCleanupParameterError) {
      return failure(error.statusCode, 'invalid_request', error.message, requestId, error.fields);
    }

    const err = error as { code?: string; message?: string };
    if (err.code === '42501') {
      return failure(403, 'forbidden', err.message || 'Permission denied.', requestId);
    }
    if (err.code === '02000') {
      return failure(404, 'not_found', 'Cleanup operation not found.', requestId);
    }
    if (err.code === '23505') {
      return failure(409, 'idempotency_conflict', err.message || 'Idempotency key conflict.', requestId);
    }
    if (err.code === '22000') {
      return failure(410, 'expired_preview', 'Cleanup preview has expired.', requestId);
    }
    if (err.code === '22023') {
      return failure(400, 'invalid_request', err.message || 'Invalid request parameter.', requestId);
    }

    return failure(503, 'service_unavailable', 'Session cleanup confirmation is temporarily unavailable.', requestId);
  }
}
