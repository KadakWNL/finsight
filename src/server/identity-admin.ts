import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest } from './authentication';
import { isSameOriginRequest } from './auth-security';
import { hashPassword } from './auth';
import { getPool } from './db';
import type { SessionUser } from './session';
import {
  IdentityParameterError,
  parseAnalystUpdatePayload,
  parseCreateAnalystPayload,
  validateAnalystId,
} from './identity-parameters';

const headers = { 'Cache-Control': 'private, no-store' };

function failure(
  status: number,
  code: string,
  message: string,
  requestId: string,
  fields?: Record<string, string>
) {
  return NextResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}) }, request_id: requestId },
    { status, headers }
  );
}

async function requireAdmin(
  request: Request,
  requestId: string
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const validation = await authenticateRequest(request);
  if (!validation.valid) {
    return { response: failure(401, 'unauthenticated', 'Sign in to continue.', requestId) };
  }
  if (validation.user.role !== 'admin') {
    return { response: failure(403, 'forbidden', 'Only administrators can manage analyst accounts.', requestId) };
  }
  return { user: validation.user };
}

function mapDatabaseError(error: unknown, requestId: string, create = false) {
  const dbError = error as { code?: string };
  if (dbError.code === '42501') {
    return failure(403, 'forbidden', 'Only an active administrator can manage analyst accounts.', requestId);
  }
  if (dbError.code === 'P0002') {
    return failure(404, 'not_found', 'Analyst account not found.', requestId);
  }
  if (dbError.code === '23505') {
    return failure(
      409,
      create ? 'email_exists' : 'conflict',
      create ? 'An account with this email already exists.' : 'This account could not be updated.',
      requestId
    );
  }
  if (dbError.code === '22023' || dbError.code === '23514') {
    return failure(422, 'unprocessable_entity', 'Only active analyst accounts can be managed.', requestId);
  }
  if (dbError.code === '28000') {
    return failure(401, 'unauthenticated', 'Sign in to continue.', requestId);
  }
  return null;
}

export async function analystList(request: Request) {
  const requestId = randomUUID();
  try {
    const admin = await requireAdmin(request, requestId);
    if ('response' in admin) return admin.response;

    if (new URL(request.url).search) {
      return failure(400, 'invalid_request', 'User listing does not accept query parameters.', requestId);
    }

    const { rows } = await getPool().query(
      `SELECT u.user_id, u.email, u.display_name, u.is_active,
         to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
         to_char(u.last_login_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_login_at,
         (SELECT count(*)::integer FROM public.investigation_case c
          WHERE c.assigned_to_user_id = u.user_id
            AND c.status IN ('open','in_review','escalated')) AS active_case_count
       FROM public.app_user u
       WHERE u.role = 'analyst'
       ORDER BY u.is_active DESC, lower(u.display_name), u.user_id`
    );

    return NextResponse.json({ data: rows, request_id: requestId }, { headers });
  } catch {
    return failure(503, 'dependency_unavailable', 'Analyst accounts are temporarily unavailable.', requestId);
  }
}

export async function analystCreate(request: Request) {
  const requestId = randomUUID();
  if (!isSameOriginRequest(request)) {
    return failure(403, 'forbidden', 'Request origin could not be verified.', requestId);
  }

  try {
    const admin = await requireAdmin(request, requestId);
    if ('response' in admin) return admin.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, 'invalid_request', 'Malformed JSON body.', requestId);
    }

    const input = parseCreateAnalystPayload(body);
    const passwordHash = await hashPassword(input.password);
    const { rows } = await getPool().query(
      `SELECT * FROM public.create_analyst_account($1, $2, $3, $4)`,
      [admin.user.userId, input.email, input.displayName, passwordHash]
    );

    return NextResponse.json({ data: rows[0], request_id: requestId }, { status: 201, headers });
  } catch (error) {
    if (error instanceof IdentityParameterError) {
      return failure(error.statusCode, 'invalid_request', error.message, requestId, error.fields);
    }
    return mapDatabaseError(error, requestId, true)
      ?? failure(503, 'dependency_unavailable', 'The analyst account could not be created.', requestId);
  }
}

export async function analystUpdate(request: Request, resourceId: string) {
  const requestId = randomUUID();
  if (!isSameOriginRequest(request)) {
    return failure(403, 'forbidden', 'Request origin could not be verified.', requestId);
  }

  try {
    const admin = await requireAdmin(request, requestId);
    if ('response' in admin) return admin.response;

    const userId = validateAnalystId(resourceId, 'id');
    if (new URL(request.url).search) {
      return failure(400, 'invalid_request', 'Account updates do not accept query parameters.', requestId);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failure(400, 'invalid_request', 'Malformed JSON body.', requestId);
    }

    const input = parseAnalystUpdatePayload(body);

    if (input.action === 'deactivate') {
      const { rows } = await getPool().query(
        `SELECT * FROM public.deactivate_analyst_account($1, $2, $3)`,
        [admin.user.userId, userId, input.reason ?? null]
      );
      return NextResponse.json({ data: rows[0], request_id: requestId }, { headers });
    }

    const passwordHash = await hashPassword(input.password);
    if (input.action === 'reactivate') {
      const { rows } = await getPool().query(
        `SELECT * FROM public.reactivate_analyst_account($1, $2, $3)`,
        [admin.user.userId, userId, passwordHash]
      );
      return NextResponse.json({ data: rows[0], request_id: requestId }, { headers });
    }

    const { rows } = await getPool().query(
      `SELECT * FROM public.reset_analyst_password($1, $2, $3)`,
      [admin.user.userId, userId, passwordHash]
    );
    return NextResponse.json({ data: rows[0], request_id: requestId }, { headers });
  } catch (error) {
    if (error instanceof IdentityParameterError) {
      return failure(error.statusCode, 'invalid_request', error.message, requestId, error.fields);
    }
    return mapDatabaseError(error, requestId)
      ?? failure(503, 'dependency_unavailable', 'The analyst account could not be updated.', requestId);
  }
}
