import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest } from './authentication';
import { getPool } from './db';
import { executeCaseCommand } from './case-commands';
import { canExecuteCaseCommand } from './authorization';
import {
  validateCaseUuid,
  parseCaseQuery,
  parseCreateCasePayload,
  parseCaseCommandPayload,
  CaseParameterError,
} from './case-parameters';
import {
  listCases,
  getCaseDetail,
  getCaseEvents,
  getCaseCommandTarget,
} from './case-queries';

const headers = { 'Cache-Control': 'private, no-store' };

function formatCommandResult(result: {
  operationId: string;
  caseId: string;
  caseRef: string;
  status: string;
  priority: string;
  assignedToUserId: string | null;
  version: number;
  responseStatus: number;
  replayed: boolean;
}) {
  return {
    operation_id: result.operationId,
    operationId: result.operationId,
    case_id: result.caseId,
    caseId: result.caseId,
    case_ref: result.caseRef,
    caseRef: result.caseRef,
    status: result.status,
    priority: result.priority,
    assigned_to_user_id: result.assignedToUserId,
    assignedToUserId: result.assignedToUserId,
    version: result.version,
    response_status: result.responseStatus,
    replayed: result.replayed,
  };
}

function failure(
  status: number,
  code: string,
  message: string,
  requestId: string,
  fields?: Record<string, string>
) {
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

export async function caseList(request: Request) {
  const requestId = randomUUID();
  try {
    const validation = await authenticateRequest(request);
    if (!validation.valid) {
      return failure(401, 'unauthenticated', 'Sign in to continue.', requestId);
    }
    const actor = validation.user;
    if (actor.role !== 'analyst' && actor.role !== 'admin') {
      return failure(403, 'forbidden', 'This role cannot read cases.', requestId);
    }

    const query = parseCaseQuery(new URL(request.url).searchParams);
    const data = await listCases(getPool(), query, actor);
    return NextResponse.json(
      {
        data,
        limit: query.limit,
        offset: query.offset,
        request_id: requestId,
      },
      { headers }
    );
  } catch (error) {
    if (error instanceof CaseParameterError) {
      return failure(error.statusCode, 'invalid_request', error.message, requestId, error.fields);
    }
    const err = error as { message?: string };
    return failure(503, 'dependency_unavailable', err?.message || 'Case service is temporarily unavailable.', requestId);
  }
}

export async function caseDetail(request: Request, resourceId: string) {
  const requestId = randomUUID();
  try {
    const validation = await authenticateRequest(request);
    if (!validation.valid) {
      return failure(401, 'unauthenticated', 'Sign in to continue.', requestId);
    }
    const actor = validation.user;
    if (actor.role !== 'analyst' && actor.role !== 'admin') {
      return failure(403, 'forbidden', 'This role cannot read cases.', requestId);
    }

    const caseId = validateCaseUuid(resourceId, 'id');
    const data = await getCaseDetail(getPool(), caseId, actor);
    if (!data) {
      return failure(404, 'not_found', 'Case not found.', requestId);
    }
    return NextResponse.json({ data, request_id: requestId }, { headers });
  } catch (error) {
    if (error instanceof CaseParameterError) {
      return failure(error.statusCode, 'invalid_request', error.message, requestId, error.fields);
    }
    const err = error as { message?: string };
    return failure(503, 'dependency_unavailable', err?.message || 'Case service is temporarily unavailable.', requestId);
  }
}

export async function caseEvents(request: Request, resourceId: string) {
  const requestId = randomUUID();
  try {
    const validation = await authenticateRequest(request);
    if (!validation.valid) {
      return failure(401, 'unauthenticated', 'Sign in to continue.', requestId);
    }
    const actor = validation.user;
    if (actor.role !== 'analyst' && actor.role !== 'admin') {
      return failure(403, 'forbidden', 'This role cannot read case history.', requestId);
    }

    const caseId = validateCaseUuid(resourceId, 'id');
    const data = await getCaseEvents(getPool(), caseId, actor);
    if (!data) {
      return failure(404, 'not_found', 'Case not found.', requestId);
    }
    return NextResponse.json({ data, request_id: requestId }, { headers });
  } catch (error) {
    if (error instanceof CaseParameterError) {
      return failure(error.statusCode, 'invalid_request', error.message, requestId, error.fields);
    }
    const err = error as { message?: string };
    return failure(503, 'dependency_unavailable', err?.message || 'Case service is temporarily unavailable.', requestId);
  }
}

export async function caseCreate(request: Request) {
  const requestId = randomUUID();
  try {
    const validation = await authenticateRequest(request);
    if (!validation.valid) {
      return failure(401, 'unauthenticated', 'Sign in to continue.', requestId);
    }
    const actor = validation.user;
    if (actor.role !== 'analyst') {
      return failure(403, 'forbidden', 'Only analysts can create cases in this slice.', requestId);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, 'invalid_request', 'Malformed JSON body.', requestId);
    }

    const input = parseCreateCasePayload(body, request.headers);

    const result = await executeCaseCommand(getPool(), {
      commandType: 'create',
      actorUserId: actor.userId,
      idempotencyKey: input.idempotencyKey,
      transactionId: input.transactionId,
      priority: input.priority,
      reason: input.reason,
      caseId: input.caseId,
      caseRef: input.caseRef,
      rawPayloadForHash: body,
    });

    const status = result.replayed ? 200 : 201;
    return NextResponse.json({ data: formatCommandResult(result), request_id: requestId }, { status, headers });
  } catch (error) {
    if (error instanceof CaseParameterError) {
      return failure(error.statusCode, 'invalid_request', error.message, requestId, error.fields);
    }

    const dbErr = error as { code?: string; message?: string };
    if (dbErr.code === '23505') {
      return failure(409, 'active_case_exists', 'An active case already exists for this transaction.', requestId);
    }
    if (dbErr.code === 'P0409') {
      return failure(409, 'idempotency_conflict', dbErr.message || 'Idempotency conflict.', requestId);
    }
    if (dbErr.code === '23503') {
      return failure(404, 'not_found', 'Transaction does not exist.', requestId);
    }
    if (dbErr.code === '42501') {
      return failure(403, 'forbidden', dbErr.message || 'Unauthorized.', requestId);
    }
    if (dbErr.code === '22023' || dbErr.code === '23514') {
      return failure(422, 'unprocessable_entity', dbErr.message || 'Validation failed.', requestId);
    }

    return failure(503, 'dependency_unavailable', dbErr.message || 'Case creation failed.', requestId);
  }
}

export async function caseCommand(request: Request, resourceId: string) {
  const requestId = randomUUID();
  try {
    const validation = await authenticateRequest(request);
    if (!validation.valid) {
      return failure(401, 'unauthenticated', 'Sign in to continue.', requestId);
    }
    const actor = validation.user;
    if (actor.role !== 'analyst' && actor.role !== 'admin') {
      return failure(403, 'forbidden', 'This role cannot execute case commands.', requestId);
    }

    const caseId = validateCaseUuid(resourceId, 'id');

    // Concealed 404 check: verify case existence and ownership before inspecting action
    const target = await getCaseCommandTarget(getPool(), caseId);
    if (!target) {
      return failure(404, 'not_found', 'Case not found.', requestId);
    }

    if (actor.role === 'analyst' && target.assigned_to_user_id !== actor.userId) {
      return failure(404, 'not_found', 'Case not found.', requestId);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, 'invalid_request', 'Malformed JSON body.', requestId);
    }

    const input = parseCaseCommandPayload(body, request.headers);

    // Optimistic locking concurrency check: if target version has already advanced, return 409
    if (target.version !== input.expectedVersion) {
      return failure(
        409,
        'version_conflict',
        `Version conflict: expected version ${input.expectedVersion}, found ${target.version}.`,
        requestId
      );
    }

    // Check authority and transition rules
    const authorized = canExecuteCaseCommand(actor, input.action, target);
    if (!authorized) {
      if (actor.role === 'analyst') {
        if (input.action === 'reopen' || input.action === 'return_to_review') {
          return failure(403, 'forbidden', 'Only admins can execute this command.', requestId);
        }
        if (target.status === 'escalated') {
          return failure(403, 'forbidden', 'Analyst cannot resolve or dismiss an escalated case.', requestId);
        }
      }
      return failure(422, 'invalid_transition', `Cannot execute ${input.action} on case with status ${target.status}.`, requestId);
    }

    const result = await executeCaseCommand(getPool(), {
      commandType: input.action,
      actorUserId: actor.userId,
      idempotencyKey: input.idempotencyKey,
      expectedVersion: input.expectedVersion,
      caseId,
      reason: input.reason,
      resolutionCode: input.resolutionCode,
      resolutionNotes: input.resolutionNotes,
      rawPayloadForHash: body,
    });

    return NextResponse.json({ data: formatCommandResult(result), request_id: requestId }, { status: 200, headers });
  } catch (error) {
    if (error instanceof CaseParameterError) {
      return failure(error.statusCode, 'invalid_request', error.message, requestId, error.fields);
    }

    const dbErr = error as { code?: string; message?: string };
    if (dbErr.code === 'P0409') {
      const isVersionConflict = (dbErr.message || '').includes('Version conflict');
      const code = isVersionConflict ? 'version_conflict' : 'idempotency_conflict';
      return failure(409, code, dbErr.message || 'Conflict.', requestId);
    }
    if (dbErr.code === '23505') {
      return failure(409, 'active_case_exists', 'Another active case already exists for this transaction.', requestId);
    }
    if (dbErr.code === 'P0002') {
      return failure(404, 'not_found', 'Case not found.', requestId);
    }
    if (dbErr.code === '42501') {
      return failure(403, 'forbidden', dbErr.message || 'Unauthorized.', requestId);
    }
    if (dbErr.code === '22023' || dbErr.code === '23514') {
      return failure(422, 'invalid_transition', dbErr.message || 'Validation failed.', requestId);
    }

    return failure(503, 'dependency_unavailable', dbErr.message || 'Command execution failed.', requestId);
  }
}
