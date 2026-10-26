import 'server-only';
import type { CaseCommandType } from './case-commands';

export class CaseParameterError extends Error {
  constructor(
    public readonly fields: Record<string, string>,
    public readonly statusCode: number = 400
  ) {
    super(Object.values(fields)[0] || 'Invalid request parameters.');
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCaseUuid(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new CaseParameterError({ [field]: 'Expected a valid UUID.' }, 400);
  }
  return value.toLowerCase();
}

export interface CaseListQueryOptions {
  status?: string;
  priority?: string;
  limit: number;
  offset: number;
}

const ALLOWED_STATUSES = new Set(['open', 'in_review', 'escalated', 'closed', 'dismissed']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high']);

function validateQueryKeys(params: URLSearchParams, allowed: string[]) {
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) {
      throw new CaseParameterError({ [key]: 'Unsupported or repeated query parameter.' });
    }
  }
  if (params.has('limit') && params.has('page_size')) {
    throw new CaseParameterError({ limit: 'Use either limit or page_size, not both.' });
  }
}

export function parseCaseHistoryQuery(params: URLSearchParams): { limit: number; offset: number } {
  validateQueryKeys(params, ['limit', 'page_size', 'offset']);
  const rawLimit = params.get('limit') ?? params.get('page_size') ?? '50';
  const rawOffset = params.get('offset') ?? '0';
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (!/^[1-9]\d*$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit > 100) {
    throw new CaseParameterError({ limit: 'Limit must be an integer between 1 and 100.' });
  }
  if (!/^(0|[1-9]\d*)$/.test(rawOffset) || !Number.isSafeInteger(offset)) {
    throw new CaseParameterError({ offset: 'Offset must be a non-negative safe integer.' });
  }
  return { limit, offset };
}

function validateBodyKeys(record: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new CaseParameterError({ [key]: 'This field is not accepted.' });
  }
}

function alias(record: Record<string, unknown>, ...keys: string[]): unknown {
  const present = keys.filter(key => Object.hasOwn(record, key));
  if (present.length > 1) throw new CaseParameterError({ [keys[0]]: 'Supply this field only once.' });
  return present.length ? record[present[0]] : undefined;
}

function idempotencyKey(record: Record<string, unknown>, headers: Headers): string {
  const bodyKey = alias(record, 'idempotency_key', 'idempotencyKey');
  const headerKey = headers.get('idempotency-key');
  const rawKey = headerKey ?? bodyKey;
  const key = validateCaseUuid(rawKey, 'idempotency_key');
  if (headerKey !== null && bodyKey !== undefined && validateCaseUuid(bodyKey, 'idempotency_key') !== key) {
    throw new CaseParameterError({ idempotency_key: 'Header and body keys must agree.' });
  }
  return key;
}

export function parseCaseQuery(searchParams: URLSearchParams): CaseListQueryOptions {
  validateQueryKeys(searchParams, ['status', 'priority', 'limit', 'page_size', 'offset']);
  let status: string | undefined;
  let priority: string | undefined;
  const { limit, offset } = parseCaseHistoryQuery(new URLSearchParams(
    [...searchParams.entries()].filter(([key]) => !['status', 'priority'].includes(key))
  ));

  if (searchParams.has('status')) {
    const val = searchParams.get('status')!;
    if (!ALLOWED_STATUSES.has(val)) {
      throw new CaseParameterError({ status: 'Invalid status filter.' }, 400);
    }
    status = val;
  }

  if (searchParams.has('priority')) {
    const val = searchParams.get('priority')!;
    if (!ALLOWED_PRIORITIES.has(val)) {
      throw new CaseParameterError({ priority: 'Invalid priority filter.' }, 400);
    }
    priority = val;
  }

  return { status, priority, limit, offset };
}

export interface CreateCaseInput {
  idempotencyKey: string;
  transactionId: string;
  priority: 'low' | 'medium' | 'high';
  reason: string;
}

export function parseCreateCasePayload(body: unknown, headers: Headers): CreateCaseInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CaseParameterError({ body: 'Expected JSON object body.' }, 400);
  }

  const record = body as Record<string, unknown>;
  validateBodyKeys(record, ['transaction_id', 'transactionId', 'priority', 'reason', 'idempotency_key', 'idempotencyKey']);
  const key = idempotencyKey(record, headers);
  const rawTxnId = alias(record, 'transaction_id', 'transactionId');
  if (!rawTxnId || typeof rawTxnId !== 'string' || !uuidPattern.test(rawTxnId)) {
    throw new CaseParameterError({ transaction_id: 'A valid transaction_id UUID is required.' }, 400);
  }
  const transactionId = rawTxnId.toLowerCase();

  const priority = record.priority;
  if (typeof priority !== 'string' || !ALLOWED_PRIORITIES.has(priority)) {
    throw new CaseParameterError({ priority: 'priority must be low, medium, or high.' }, 400);
  }

  const reason = record.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0 || reason !== reason.trim() || reason.length > 2000) {
    throw new CaseParameterError({ reason: 'reason is required (1 to 2000 trimmed characters).' }, 400);
  }

  return {
    idempotencyKey: key,
    transactionId,
    priority: priority as 'low' | 'medium' | 'high',
    reason,
  };
}

export interface CaseCommandInput {
  action: CaseCommandType;
  expectedVersion: number;
  idempotencyKey: string;
  reason?: string;
  resolutionCode?: 'confirmed_suspicious' | 'false_positive' | 'insufficient_evidence';
  resolutionNotes?: string;
}

const ALLOWED_COMMANDS = new Set([
  'start_review',
  'escalate',
  'return_to_review',
  'resolve',
  'dismiss',
  'reopen',
]);

export function parseCaseCommandPayload(body: unknown, headers: Headers): CaseCommandInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CaseParameterError({ body: 'Expected JSON object body.' }, 400);
  }

  const record = body as Record<string, unknown>;
  const rawAction = alias(record, 'action', 'commandType', 'command_type', 'command');
  if (typeof rawAction !== 'string' || !ALLOWED_COMMANDS.has(rawAction)) {
    throw new CaseParameterError({ action: 'Invalid or unsupported command action.' }, 400);
  }
  const action = rawAction as CaseCommandType;
  validateBodyKeys(record, ['action', 'commandType', 'command_type', 'command', 'expected_version', 'expectedVersion',
    'idempotency_key', 'idempotencyKey',
    ...(['escalate', 'return_to_review', 'reopen'].includes(action) ? ['reason'] : []),
    ...(['resolve', 'dismiss'].includes(action) ? ['resolution_code', 'resolutionCode', 'resolution_notes', 'resolutionNotes'] : []),
  ]);

  const rawVersion = alias(record, 'expected_version', 'expectedVersion');
  if (rawVersion === undefined || rawVersion === null) {
    throw new CaseParameterError({ expected_version: 'expected_version is required.' }, 400);
  }
  if (typeof rawVersion !== 'number' || !Number.isSafeInteger(rawVersion) || rawVersion < 1) {
    throw new CaseParameterError({ expected_version: 'expected_version must be a positive integer.' }, 400);
  }
  const versionNum = rawVersion;

  const key = idempotencyKey(record, headers);

  let reason: string | undefined;
  if (action === 'escalate' || action === 'return_to_review' || action === 'reopen') {
    const rawReason = record.reason;
    if (typeof rawReason !== 'string' || rawReason.trim().length === 0 || rawReason !== rawReason.trim() || rawReason.length > 2000) {
      throw new CaseParameterError({ reason: 'reason is required (1 to 2000 trimmed characters).' }, 422);
    }
    reason = rawReason;
  }

  let resolutionCode: 'confirmed_suspicious' | 'false_positive' | 'insufficient_evidence' | undefined;
  let resolutionNotes: string | undefined;

  if (action === 'resolve') {
    const rawCode = alias(record, 'resolution_code', 'resolutionCode');
    if (rawCode !== 'confirmed_suspicious') {
      throw new CaseParameterError({ resolution_code: 'Resolve requires resolution_code confirmed_suspicious.' }, 422);
    }
    resolutionCode = rawCode;

    const rawNotes = alias(record, 'resolution_notes', 'resolutionNotes');
    if (typeof rawNotes !== 'string' || rawNotes.trim().length === 0 || rawNotes !== rawNotes.trim() || rawNotes.length > 5000) {
      throw new CaseParameterError({ resolution_notes: 'resolution_notes is required (1 to 5000 trimmed characters).' }, 422);
    }
    resolutionNotes = rawNotes;
  } else if (action === 'dismiss') {
    const rawCode = alias(record, 'resolution_code', 'resolutionCode');
    if (rawCode !== 'false_positive' && rawCode !== 'insufficient_evidence') {
      throw new CaseParameterError({ resolution_code: 'Dismiss requires resolution_code false_positive or insufficient_evidence.' }, 422);
    }
    resolutionCode = rawCode as 'false_positive' | 'insufficient_evidence';

    const rawNotes = alias(record, 'resolution_notes', 'resolutionNotes');
    if (typeof rawNotes !== 'string' || rawNotes.trim().length === 0 || rawNotes !== rawNotes.trim() || rawNotes.length > 5000) {
      throw new CaseParameterError({ resolution_notes: 'resolution_notes is required (1 to 5000 trimmed characters).' }, 422);
    }
    resolutionNotes = rawNotes;
  }

  return {
    action,
    expectedVersion: versionNum,
    idempotencyKey: key,
    reason,
    resolutionCode,
    resolutionNotes,
  };
}
