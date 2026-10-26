import 'server-only';
import type { SqlClient } from './case-commands';
import type { SessionUser } from './session';
import { filterCaseSummaryForRole } from './authorization';
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
    WHERE c.case_id = $1 AND ($3::text = 'admin' OR c.assigned_to_user_id = $2::uuid)
  `;

  const { rows } = await client.query(query, [caseId, user.userId, user.role]);
  if (rows.length === 0) {
    return null;
  }

  const row: CaseRecord = {
    ...rows[0],
    version: Number(rows[0].version),
  };

  return row;
}

export async function getCaseEvents(
  client: SqlClient,
  caseId: string,
  user: SessionUser,
  options: { limit: number; offset: number } = { limit: 50, offset: 0 }
): Promise<CaseEventRecord[] | null> {
  const { rows } = await client.query(`
    SELECT coalesce((SELECT jsonb_agg(page.event ORDER BY page.occurred_at, page.event_id)
      FROM (
        SELECT e.occurred_at, e.event_id,
          jsonb_build_object(
            'event_id', e.event_id::text, 'case_id', e.case_id,
            'actor_user_id', e.actor_user_id, 'event_type', e.event_type,
            'from_state', e.from_state, 'to_state', e.to_state,
            'reason', e.reason, 'metadata', e.metadata,
            'operation_id', e.operation_id, 'event_ordinal', e.event_ordinal,
            'occurred_at', e.occurred_at
          ) AS event
        FROM public.case_event e WHERE e.case_id = c.case_id
        ORDER BY e.occurred_at ASC, e.event_id ASC LIMIT $4 OFFSET $5
      ) page), '[]'::jsonb) AS events
    FROM public.investigation_case c
    WHERE c.case_id = $1 AND ($3::text = 'admin' OR c.assigned_to_user_id = $2::uuid)
  `, [caseId, user.userId, user.role, options.limit, options.offset]);
  return rows.length ? rows[0].events : null;
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
