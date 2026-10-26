import 'server-only';
import { createHash } from 'node:crypto';
import type { Client, PoolClient } from 'pg';

export type SqlClient = Pick<Client | PoolClient, 'query'>;

export type CaseCommandType =
  | 'create'
  | 'start_review'
  | 'escalate'
  | 'return_to_review'
  | 'resolve'
  | 'dismiss'
  | 'reopen';

export interface ExecuteCaseCommandParams {
  commandType: CaseCommandType;
  actorUserId: string;
  idempotencyKey: string;
  expectedVersion?: number | bigint | null;
  caseId?: string | null;
  transactionId?: string | null;
  priority?: 'low' | 'medium' | 'high' | null;
  reason?: string | null;
  resolutionCode?: 'confirmed_suspicious' | 'false_positive' | 'insufficient_evidence' | null;
  resolutionNotes?: string | null;
  caseRef?: string | null;
  rawPayloadForHash?: unknown;
}

export interface CaseCommandResult {
  operationId: string;
  caseId: string;
  caseRef: string;
  status: string;
  priority: string;
  assignedToUserId: string | null;
  version: number;
  responseStatus: number;
  replayed: boolean;
}

export function canonicalRequestHash(payload: unknown): string {
  function canonicalize(val: unknown): unknown {
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(canonicalize);
    const record = val as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  const str = JSON.stringify(canonicalize(payload) ?? '');
  return createHash('sha256').update(str).digest('hex');
}

export async function executeCaseCommand(
  client: SqlClient,
  params: ExecuteCaseCommandParams
): Promise<CaseCommandResult> {
  const requestHash = params.rawPayloadForHash !== undefined
    ? canonicalRequestHash(params.rawPayloadForHash)
    : canonicalRequestHash({
        commandType: params.commandType,
        expectedVersion: params.expectedVersion != null ? String(params.expectedVersion) : null,
        caseId: params.caseId ?? null,
        transactionId: params.transactionId ?? null,
        priority: params.priority ?? null,
        reason: params.reason ?? null,
        resolutionCode: params.resolutionCode ?? null,
        resolutionNotes: params.resolutionNotes ?? null,
        caseRef: params.caseRef ?? null,
      });

  const query = `SELECT * FROM public.execute_case_command($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
  const values = [
    params.commandType,
    params.actorUserId,
    params.idempotencyKey,
    requestHash,
    params.expectedVersion ?? null,
    params.caseId ?? null,
    params.transactionId ?? null,
    params.priority ?? null,
    params.reason ?? null,
    params.resolutionCode ?? null,
    params.resolutionNotes ?? null,
    params.caseRef ?? null,
  ];

  const { rows } = await client.query(query, values);
  const row = rows[0];
  return {
    operationId: row.operation_id,
    caseId: row.case_id,
    caseRef: row.case_ref,
    status: row.status,
    priority: row.priority,
    assignedToUserId: row.assigned_to_user_id,
    version: Number(row.version),
    responseStatus: Number(row.response_status),
    replayed: Boolean(row.replayed),
  };
}
