import 'server-only';
import type { SqlClient } from './case-commands';
import type { SessionUser } from './session';
import { canAccessCase, filterCaseSummaryForRole } from './authorization';
import type { CaseListQueryOptions } from './case-parameters';

export interface CaseRecord {
  case_id: string;
  case_ref: string;
  transaction_id: string;
  assigned_to_user_id: string | null;
  status: string;
  priority: string;
  resolution_code: string | null;
  resolution_notes: string | null;
  opened_at: string;
  due_at: string | null;
  closed_at: string | null;
  updated_at: string;
  version: number;
  [key: string]: unknown;
}

export interface CaseEventRecord {
  event_id: string;
  case_id: string;
  actor_user_id: string;
  event_type: string;
  from_state: Record<string, unknown> | null;
  to_state: Record<string, unknown>;
  reason: string | null;
  metadata: Record<string, unknown>;
  operation_id: string;
  event_ordinal: number;
  occurred_at: string;
}

export async function listCases(
  client: SqlClient,
  options: CaseListQueryOptions,
  user: SessionUser
): Promise<Array<Partial<CaseRecord>>> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (user.role === 'analyst') {
    values.push(user.userId);
    conditions.push(`(c.assigned_to_user_id = $${values.length} OR c.assigned_to_user_id IS NULL)`);
  }

  if (options.status) {
    values.push(options.status);
    conditions.push(`c.status = $${values.length}`);
  }

  if (options.priority) {
    values.push(options.priority);
    conditions.push(`c.priority = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(options.limit);
  const limitPlaceholder = `$${values.length}`;

  values.push(options.offset);
  const offsetPlaceholder = `$${values.length}`;

  const query = `
    SELECT
      c.case_id,
      c.case_ref,
      c.transaction_id,
      c.assigned_to_user_id,
      c.status,
      c.priority,
      c.resolution_code,
      c.resolution_notes,
      c.opened_at,
      c.due_at,
      c.closed_at,
      c.updated_at,
      c.version
    FROM public.investigation_case c
    ${whereClause}
    ORDER BY c.opened_at DESC, c.case_id ASC
    LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
  `;

  const { rows } = await client.query(query, values);

  const results: Array<Partial<CaseRecord>> = [];
  for (const rawRow of rows) {
    const row: CaseRecord = {
      ...rawRow,
      version: Number(rawRow.version),
    };
    const projected = filterCaseSummaryForRole(user, row);
    if (projected !== null) {
      results.push(projected);
    }
  }

  return results;
}

export async function getCaseDetail(
  client: SqlClient,
  caseId: string,
  user: SessionUser
): Promise<CaseRecord | null> {
  const query = `
    SELECT
      c.case_id,
      c.case_ref,
      c.transaction_id,
      c.assigned_to_user_id,
      c.status,
      c.priority,
      c.resolution_code,
      c.resolution_notes,
      c.opened_at,
      c.due_at,
      c.closed_at,
      c.updated_at,
      c.version
    FROM public.investigation_case c
    WHERE c.case_id = $1
  `;

  const { rows } = await client.query(query, [caseId]);
  if (rows.length === 0) {
    return null;
  }

  const row: CaseRecord = {
    ...rows[0],
    version: Number(rows[0].version),
  };

  if (!canAccessCase(user, row)) {
    return null;
  }

  return row;
}

export async function getCaseEvents(
  client: SqlClient,
  caseId: string,
  user: SessionUser
): Promise<CaseEventRecord[] | null> {
  const caseCheckQuery = `
    SELECT c.case_id, c.assigned_to_user_id
    FROM public.investigation_case c
    WHERE c.case_id = $1
  `;

  const caseCheck = await client.query(caseCheckQuery, [caseId]);
  if (caseCheck.rows.length === 0) {
    return null;
  }

  if (!canAccessCase(user, caseCheck.rows[0])) {
    return null;
  }

  const query = `
    SELECT
      e.event_id::text,
      e.case_id,
      e.actor_user_id,
      e.event_type,
      e.from_state,
      e.to_state,
      e.reason,
      e.metadata,
      e.operation_id,
      e.event_ordinal,
      e.occurred_at
    FROM public.case_event e
    WHERE e.case_id = $1
    ORDER BY e.occurred_at ASC, e.event_ordinal ASC
  `;

  const { rows } = await client.query(query, [caseId]);
  return rows.map((r) => ({
    ...r,
    event_ordinal: Number(r.event_ordinal),
  }));
}

export async function getCaseCommandTarget(
  client: SqlClient,
  caseId: string
): Promise<{ case_id: string; status: string; assigned_to_user_id: string | null; version: number } | null> {
  const query = `
    SELECT c.case_id, c.status, c.assigned_to_user_id, c.version
    FROM public.investigation_case c
    WHERE c.case_id = $1
  `;
  const { rows } = await client.query(query, [caseId]);
  if (rows.length === 0) {
    return null;
  }
  return {
    ...rows[0],
    version: Number(rows[0].version),
  };
}
