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

export function parseCaseQuery(searchParams: URLSearchParams): CaseListQueryOptions {
  let status: string | undefined;
  let priority: string | undefined;
  let limit = 50;
  let offset = 0;

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

  if (searchParams.has('limit') || searchParams.has('page_size')) {
    const raw = searchParams.get('limit') ?? searchParams.get('page_size');
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new CaseParameterError({ limit: 'Limit must be an integer between 1 and 100.' }, 400);
    }
    limit = parsed;
  }

  if (searchParams.has('offset')) {
    const raw = searchParams.get('offset');
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new CaseParameterError({ offset: 'Offset must be a non-negative integer.' }, 400);
    }
    offset = parsed;
  }

  return { status, priority, limit, offset };
}

export interface CreateCaseInput {
  idempotencyKey: string;
  transactionId: string;
  priority: 'low' | 'medium' | 'high';
  reason: string;
  caseId?: string;
  caseRef?: string;
}

export function parseCreateCasePayload(body: unknown, headers: Headers): CreateCaseInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CaseParameterError({ body: 'Expected JSON object body.' }, 400);
  }

  const record = body as Record<string, unknown>;

  const rawKey = headers.get('idempotency-key') ?? record.idempotency_key ?? record.idempotencyKey;
  if (!rawKey || typeof rawKey !== 'string' || !uuidPattern.test(rawKey)) {
    throw new CaseParameterError({ idempotency_key: 'A valid idempotency key UUID is required.' }, 400);
  }
  const idempotencyKey = rawKey.toLowerCase();

  const rawTxnId = record.transaction_id ?? record.transactionId;
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

  let caseId: string | undefined;
  if (record.case_id || record.caseId) {
    const rawCaseId = String(record.case_id ?? record.caseId);
    if (!uuidPattern.test(rawCaseId)) {
      throw new CaseParameterError({ case_id: 'Expected a valid case_id UUID.' }, 400);
    }
    caseId = rawCaseId.toLowerCase();
  }

  let caseRef: string | undefined;
  if (record.case_ref || record.caseRef) {
    const rawRef = String(record.case_ref ?? record.caseRef).trim();
    if (rawRef.length === 0 || rawRef.length > 64) {
      throw new CaseParameterError({ case_ref: 'case_ref must be between 1 and 64 characters.' }, 400);
    }
    caseRef = rawRef;
  }

  return {
    idempotencyKey,
    transactionId,
    priority: priority as 'low' | 'medium' | 'high',
    reason,
    caseId,
    caseRef,
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

  const rawAction = record.action ?? record.commandType ?? record.command_type ?? record.command;
  if (typeof rawAction !== 'string' || !ALLOWED_COMMANDS.has(rawAction)) {
    throw new CaseParameterError({ action: 'Invalid or unsupported command action.' }, 400);
  }
  const action = rawAction as CaseCommandType;

  const rawVersion = record.expected_version ?? record.expectedVersion;
  if (rawVersion === undefined || rawVersion === null) {
    throw new CaseParameterError({ expected_version: 'expected_version is required.' }, 400);
  }
  const versionNum = Number(rawVersion);
  if (!Number.isInteger(versionNum) || versionNum < 1) {
    throw new CaseParameterError({ expected_version: 'expected_version must be a positive integer.' }, 400);
  }

  const rawKey = headers.get('idempotency-key') ?? record.idempotency_key ?? record.idempotencyKey;
  if (!rawKey || typeof rawKey !== 'string' || !uuidPattern.test(rawKey)) {
    throw new CaseParameterError({ idempotency_key: 'A valid idempotency key UUID is required.' }, 400);
  }
  const idempotencyKey = rawKey.toLowerCase();

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
    const rawCode = record.resolution_code ?? record.resolutionCode;
    if (rawCode !== 'confirmed_suspicious') {
      throw new CaseParameterError({ resolution_code: 'Resolve requires resolution_code confirmed_suspicious.' }, 422);
    }
    resolutionCode = rawCode;

    const rawNotes = record.resolution_notes ?? record.resolutionNotes;
    if (typeof rawNotes !== 'string' || rawNotes.trim().length === 0 || rawNotes !== rawNotes.trim() || rawNotes.length > 5000) {
      throw new CaseParameterError({ resolution_notes: 'resolution_notes is required (1 to 5000 trimmed characters).' }, 422);
    }
    resolutionNotes = rawNotes;
  } else if (action === 'dismiss') {
    const rawCode = record.resolution_code ?? record.resolutionCode;
    if (rawCode !== 'false_positive' && rawCode !== 'insufficient_evidence') {
      throw new CaseParameterError({ resolution_code: 'Dismiss requires resolution_code false_positive or insufficient_evidence.' }, 422);
    }
    resolutionCode = rawCode as 'false_positive' | 'insufficient_evidence';

    const rawNotes = record.resolution_notes ?? record.resolutionNotes;
    if (typeof rawNotes !== 'string' || rawNotes.trim().length === 0 || rawNotes !== rawNotes.trim() || rawNotes.length > 5000) {
      throw new CaseParameterError({ resolution_notes: 'resolution_notes is required (1 to 5000 trimmed characters).' }, 422);
    }
    resolutionNotes = rawNotes;
  }

  return {
    action,
    expectedVersion: versionNum,
    idempotencyKey,
    reason,
    resolutionCode,
    resolutionNotes,
  };
}
