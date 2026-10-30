import 'server-only';
import { createHash } from 'node:crypto';
import type { Client, Pool, PoolClient } from 'pg';

export type SqlClient = Pick<Client | PoolClient, 'query'>;

export interface SessionCleanupPreviewResult {
  operation_id: string;
  operationId: string;
  candidate_count: number;
  candidateCount: number;
  cutoff_at: string;
  cutoffAt: string;
  expires_at: string;
  expiresAt: string;
  preview_at: string;
  previewAt: string;
}

export interface SessionCleanupConfirmResult {
  operation_id: string;
  operationId: string;
  status: 'completed';
  candidate_count: number;
  candidateCount: number;
  deleted_count: number;
  deletedCount: number;
  cutoff_at: string;
  cutoffAt: string;
  completed_at: string;
  completedAt: string;
  replayed: boolean;
}

export interface ConfirmSessionCleanupParams {
  operationId: string;
  adminUserId: string;
  idempotencyKey: string;
  rawPayloadForHash?: unknown;
}

export function canonicalCleanupRequestHash(payload: unknown): string {
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

export async function previewSessionCleanup(
  client: SqlClient,
  adminUserId: string
): Promise<SessionCleanupPreviewResult> {
  const query = 'SELECT * FROM public.preview_app_session_cleanup($1)';
  const { rows } = await client.query(query, [adminUserId]);
  const row = rows[0];

  const cutoff = row.cutoff_at instanceof Date ? row.cutoff_at.toISOString() : String(row.cutoff_at);
  const expires = row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at);
  const preview = row.preview_at instanceof Date ? row.preview_at.toISOString() : String(row.preview_at);

  return {
    operation_id: row.operation_id,
    operationId: row.operation_id,
    candidate_count: Number(row.candidate_count),
    candidateCount: Number(row.candidate_count),
    cutoff_at: cutoff,
    cutoffAt: cutoff,
    expires_at: expires,
    expiresAt: expires,
    preview_at: preview,
    previewAt: preview,
  };
}

export async function confirmSessionCleanup(
  client: SqlClient,
  params: ConfirmSessionCleanupParams
): Promise<SessionCleanupConfirmResult> {
  const requestHash = params.rawPayloadForHash !== undefined
    ? canonicalCleanupRequestHash(params.rawPayloadForHash)
    : canonicalCleanupRequestHash({
        confirm: true,
        idempotency_key: params.idempotencyKey,
        operation_id: params.operationId,
      });

  const query = 'SELECT * FROM public.confirm_app_session_cleanup($1, $2, $3, $4)';
  const values = [
    params.operationId,
    params.adminUserId,
    params.idempotencyKey,
    requestHash,
  ];

  const { rows } = await client.query(query, values);
  const row = rows[0];

  const cutoff = row.cutoff_at instanceof Date ? row.cutoff_at.toISOString() : String(row.cutoff_at);
  const completed = row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at);

  return {
    operation_id: row.operation_id,
    operationId: row.operation_id,
    status: 'completed',
    candidate_count: Number(row.candidate_count),
    candidateCount: Number(row.candidate_count),
    deleted_count: Number(row.deleted_count),
    deletedCount: Number(row.deleted_count),
    cutoff_at: cutoff,
    cutoffAt: cutoff,
    completed_at: completed,
    completedAt: completed,
    replayed: Boolean(row.replayed),
  };
}

export async function executeTransactionalConfirm(
  pool: Pool,
  params: ConfirmSessionCleanupParams
): Promise<SessionCleanupConfirmResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`session-cleanup:${params.operationId}`]
    );
    const result = await confirmSessionCleanup(client, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
