import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import pg from 'pg';

vi.mock('server-only', () => ({}));

import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { seedFinancial, syntheticId as id } from '../../scripts/financial-seed.mjs';
import { createSession, SESSION_COOKIE_NAME } from '../../src/server/session';
import { encodeSessionToken } from '../../src/server/authentication';
import { getPool } from '../../src/server/db';
import { GET as casesList, POST as caseCreate } from '../../src/app/api/v1/cases/route';
import { GET as caseDetail, PATCH as casePatch } from '../../src/app/api/v1/cases/[id]/route';
import { GET as caseEvents } from '../../src/app/api/v1/cases/[id]/events/route';
import { POST as caseCommands } from '../../src/app/api/v1/cases/[id]/commands/route';

let client: pg.Client;

const analystA = '90000000-0000-0000-0000-000000000001';
const analystB = '90000000-0000-0000-0000-000000000002';
const adminUser = '90000000-0000-0000-0000-000000000003';
const inactiveAnalyst = '90000000-0000-0000-0000-000000000004';
const systemUser = '90000000-0000-0000-0000-000000000005';

const users = [analystA, analystB, adminUser, inactiveAnalyst, systemUser];
const cookies: string[] = [];

const WHO_ANALYST_A = 0;
const WHO_ANALYST_B = 1;
const WHO_ADMIN = 2;
const WHO_INACTIVE = 3;
const WHO_SYSTEM = 4;

async function apiGetCases(params: Record<string, string> = {}, who = WHO_ANALYST_A) {
  return casesList(
    new Request('http://localhost/api/v1/cases?' + new URLSearchParams(params), {
      headers: { cookie: cookies[who] },
    })
  );
}

async function apiGetCaseDetail(caseId: string, who = WHO_ANALYST_A) {
  return caseDetail(
    new Request(`http://localhost/api/v1/cases/${caseId}`, {
      headers: { cookie: cookies[who] },
    }),
    { params: Promise.resolve({ id: caseId }) }
  );
}

async function apiGetCaseEvents(caseId: string, who = WHO_ANALYST_A) {
  return caseEvents(
    new Request(`http://localhost/api/v1/cases/${caseId}/events`, {
      headers: { cookie: cookies[who] },
    }),
    { params: Promise.resolve({ id: caseId }) }
  );
}

async function apiCreateCase(body: unknown, who = WHO_ANALYST_A, extraHeaders: Record<string, string> = {}) {
  return caseCreate(
    new Request('http://localhost/api/v1/cases', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookies[who],
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    })
  );
}

async function apiCaseCommand(caseId: string, body: unknown, who = WHO_ANALYST_A, extraHeaders: Record<string, string> = {}) {
  return caseCommands(
    new Request(`http://localhost/api/v1/cases/${caseId}/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookies[who],
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: caseId }) }
  );
}

async function apiCasePatch(caseId: string, body: unknown, who = WHO_ANALYST_A, extraHeaders: Record<string, string> = {}) {
  return casePatch(
    new Request(`http://localhost/api/v1/cases/${caseId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: cookies[who],
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: caseId }) }
  );
}

beforeAll(async () => {
  client = new pg.Client({ connectionString: requireTestDatabase() });
  await client.connect();

  await applyMigrations(client, new URL('../../migrations/', import.meta.url));
  await seedFinancial(client);

  for (let n = 0; n < users.length; n++) {
    const role = n === 2 ? 'admin' : n === 4 ? 'system' : 'analyst';
    const isActive = n !== 3;
    const passwordHash = n === 4 ? null : 'PASSWORD_HASH_SENTINEL';
    await client.query(
      `INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET is_active = $6, role = $5, password_hash = $3`,
      [users[n], `api_case_user_${n}@synthetic.invalid`, passwordHash, `Test User ${n}`, role, isActive]
    );
    const session = await createSession(users[n], client);
    cookies.push(`${SESSION_COOKIE_NAME}=${await encodeSessionToken(users[n], session.sessionId)}`);
  }
});

afterAll(async () => {
  if (client) {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.end();
    await getPool().end();
  }
});

describe('Case APIs and Lifecycle (VS06 - VS15)', () => {
  const txn1 = id(101);
  const txn2 = id(102);
  const txn3 = id(103);
  const txn4 = id(104);
  const txn5 = id(105);

  let caseAId: string;

  it('VS06: Analyst A creates case with priority and creation reason', async () => {
    const key = '90000000-0000-0000-0000-000000000101';
    const res = await apiCreateCase(
      {
        transaction_id: txn1,
        priority: 'high',
        reason: 'Suspicious overseas velocity pattern observed',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': key }
    );

    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const json = await res.json();
    expect(json.data.status).toBe('open');
    expect(json.data.priority).toBe('high');
    expect(json.data.assigned_to_user_id).toBe(analystA);
    expect(json.data.version).toBe(1);
    expect(json.data.replayed).toBe(false);

    caseAId = json.data.case_id;

    // Verify exactly 'created' then 'assigned' events were emitted under one operationId
    const eventsRes = await apiGetCaseEvents(caseAId, WHO_ANALYST_A);
    expect(eventsRes.status).toBe(200);
    const eventsJson = await eventsRes.json();
    expect(eventsJson.data).toHaveLength(2);

    const [createdEvent, assignedEvent] = eventsJson.data;
    expect(createdEvent.event_type).toBe('created');
    expect(createdEvent.event_ordinal).toBe(1);
    expect(createdEvent.operation_id).toBe(json.data.operation_id);
    expect(createdEvent.actor_user_id).toBe(analystA);
    expect(createdEvent.reason).toBe('Suspicious overseas velocity pattern observed');
    expect(createdEvent.to_state.status).toBe('open');

    expect(assignedEvent.event_type).toBe('assigned');
    expect(assignedEvent.event_ordinal).toBe(2);
    expect(assignedEvent.operation_id).toBe(json.data.operation_id);
    expect(assignedEvent.actor_user_id).toBe(analystA);
    expect(assignedEvent.from_state.assigned_to_user_id).toBeNull();
    expect(assignedEvent.to_state.assigned_to_user_id).toBe(analystA);
  });

  it('VS07: Same-key retry returns committed result; changed payload conflicts; race leaves one active case', async () => {
    const key = '90000000-0000-0000-0000-000000000101';
    // 1. Same-key retry with identical payload returns 200 with replayed: true
    const replayRes = await apiCreateCase(
      {
        transaction_id: txn1,
        priority: 'high',
        reason: 'Suspicious overseas velocity pattern observed',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': key }
    );
    expect(replayRes.status).toBe(200);
    const replayJson = await replayRes.json();
    expect(replayJson.data.replayed).toBe(true);
    expect(replayJson.data.case_id).toBe(caseAId);

    // Verify no duplicate events emitted
    const eventsRes = await apiGetCaseEvents(caseAId, WHO_ANALYST_A);
    const events = (await eventsRes.json()).data;
    expect(events).toHaveLength(2);

    // 2. Same-key reuse with changed payload produces 409 conflict
    const conflictRes = await apiCreateCase(
      {
        transaction_id: txn1,
        priority: 'low', // Changed!
        reason: 'Different payload',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': key }
    );
    expect(conflictRes.status).toBe(409);
    const conflictJson = await conflictRes.json();
    expect(conflictJson.error.code).toBe('idempotency_conflict');

    // 3. Concurrently create for one subject with two keys
    const key1 = '90000000-0000-0000-0000-000000000102';
    const key2 = '90000000-0000-0000-0000-000000000103';
    const payload = {
      transaction_id: txn2,
      priority: 'medium',
      reason: 'Concurrent race subject',
    };

    const [race1, race2] = await Promise.all([
      apiCreateCase(payload, WHO_ANALYST_A, { 'idempotency-key': key1 }),
      apiCreateCase(payload, WHO_ANALYST_A, { 'idempotency-key': key2 }),
    ]);

    const statuses = [race1.status, race2.status].sort();
    expect(statuses).toEqual([201, 409]);

    // Verify only 1 active case exists in DB for txn2
    const countQuery = await client.query(
      `SELECT count(*) FROM public.investigation_case WHERE transaction_id = $1 AND status IN ('open', 'in_review', 'escalated')`,
      [txn2]
    );
    expect(Number(countQuery.rows[0].count)).toBe(1);
  });

  it('VS08: Analyst B requests Analyst A private case/events -> concealed 404; unauthorized admin action -> 403', async () => {
    // Analyst B requesting Analyst A's case detail -> 404
    const detailB = await apiGetCaseDetail(caseAId, WHO_ANALYST_B);
    expect(detailB.status).toBe(404);
    const detailBJson = await detailB.json();
    expect(detailBJson.error.code).toBe('not_found');

    // Analyst B requesting Analyst A's case events -> 404
    const eventsB = await apiGetCaseEvents(caseAId, WHO_ANALYST_B);
    expect(eventsB.status).toBe(404);

    // Analyst B attempting command on Analyst A's case -> 404 concealed
    const mutateB = await apiCaseCommand(
      caseAId,
      { action: 'start_review', expected_version: 1 },
      WHO_ANALYST_B,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000104' }
    );
    expect(mutateB.status).toBe(404);

    // Analyst A calling an admin-only action (reopen on open case) -> 403 Forbidden
    const adminActionA = await apiCaseCommand(
      caseAId,
      { action: 'reopen', expected_version: 1, reason: 'Unauthorized reopen attempt' },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000105' }
    );
    expect(adminActionA.status).toBe(403);
    const adminActionJson = await adminActionA.json();
    expect(adminActionJson.error.code).toBe('forbidden');

    // Admin attempting analyst-only creation -> 403 Forbidden
    const adminCreate = await apiCreateCase(
      { transaction_id: txn3, priority: 'low', reason: 'Admin cannot create' },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000106' }
    );
    expect(adminCreate.status).toBe(403);

    // Server rejects/ignores forged actor or status in create request
    const forged = await apiCreateCase(
      {
        transaction_id: txn3,
        priority: 'low',
        reason: 'Attempting field forgery',
        actor_user_id: adminUser,
        status: 'closed',
        opened_at: '1999-01-01T00:00:00Z',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000107' }
    );
    expect(forged.status).toBe(201);
    const forgedJson = await forged.json();
    expect(forgedJson.data.assigned_to_user_id).toBe(analystA); // Bound to session, not forged admin
    expect(forgedJson.data.status).toBe('open'); // Cannot forge closed status
  });

  it('VS09: Attempt open-to-terminal, escalation without reason, blank/oversize reasons -> 422/400', async () => {
    // 1. Attempt open-to-terminal directly without review -> 422
    const directTerminal = await apiCaseCommand(
      caseAId,
      {
        action: 'resolve',
        expected_version: 1,
        resolution_code: 'confirmed_suspicious',
        resolution_notes: 'Premature resolution',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000108' }
    );
    expect(directTerminal.status).toBe(422);

    // 2. Escalation without reason -> 422
    const noReasonEscalate = await apiCaseCommand(
      caseAId,
      { action: 'escalate', expected_version: 1 },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000109' }
    );
    expect(noReasonEscalate.status).toBe(422);

    // 3. Blank / whitespace creation reason -> 400
    const blankCreate = await apiCreateCase(
      { transaction_id: txn4, priority: 'medium', reason: '   ' },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000110' }
    );
    expect(blankCreate.status).toBe(400);

    // 4. Oversize creation reason (> 2000 chars) -> 400
    const oversizeCreate = await apiCreateCase(
      { transaction_id: txn4, priority: 'medium', reason: 'a'.repeat(2001) },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000111' }
    );
    expect(oversizeCreate.status).toBe(400);

    // 5. Unknown resolution code -> 422
    const badCode = await apiCaseCommand(
      caseAId,
      {
        action: 'resolve',
        expected_version: 1,
        resolution_code: 'not_a_valid_code',
        resolution_notes: 'Notes',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000112' }
    );
    expect(badCode.status).toBe(422);

    // Verify case A is unchanged: status is still open, version is 1
    const verifyA = await apiGetCaseDetail(caseAId, WHO_ANALYST_A);
    const dataA = (await verifyA.json()).data;
    expect(dataA.status).toBe('open');
    expect(dataA.version).toBe(1);
  });

  it('VS10: Owning analyst starts review and escalates; analyst resolution denied; admin returns case with reason', async () => {
    // 1. Analyst A starts review
    const startReview = await apiCaseCommand(
      caseAId,
      { action: 'start_review', expected_version: 1 },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000113' }
    );
    expect(startReview.status).toBe(200);
    const reviewData = (await startReview.json()).data;
    expect(reviewData.status).toBe('in_review');
    expect(reviewData.version).toBe(2);

    // 2. Analyst A escalates with reason (testing via PATCH endpoint)
    const escalate = await apiCasePatch(
      caseAId,
      { action: 'escalate', expected_version: 2, reason: 'Potential syndicate mule network involved' },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000114' }
    );
    expect(escalate.status).toBe(200);
    const escData = (await escalate.json()).data;
    expect(escData.status).toBe('escalated');
    expect(escData.version).toBe(3);

    // 3. Analyst attempts resolution on escalated case -> 403 Forbidden
    const analystResolveEscalated = await apiCaseCommand(
      caseAId,
      {
        action: 'resolve',
        expected_version: 3,
        resolution_code: 'confirmed_suspicious',
        resolution_notes: 'Analyst attempting to resolve escalated case',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000115' }
    );
    expect(analystResolveEscalated.status).toBe(403);

    // 4. Admin returns case to review with reason
    const returnToReview = await apiCaseCommand(
      caseAId,
      {
        action: 'return_to_review',
        expected_version: 3,
        reason: 'Please gather secondary account verification before escalations',
      },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000116' }
    );
    expect(returnToReview.status).toBe(200);
    const returnData = (await returnToReview.json()).data;
    expect(returnData.status).toBe('in_review');
    expect(returnData.version).toBe(4);

    // Verify event history shape: dedicated reason preserved without generic metadata
    const eventsRes = await apiGetCaseEvents(caseAId, WHO_ADMIN);
    const events = (await eventsRes.json()).data;
    const returnEvent = events.find((e: { to_state: { status?: string }; from_state: { status?: string } }) =>
      e.from_state?.status === 'escalated' && e.to_state?.status === 'in_review'
    );
    expect(returnEvent).toBeDefined();
    expect(returnEvent.reason).toBe('Please gather secondary account verification before escalations');
    expect(returnEvent.metadata).toEqual({});
  });

  it('VS11: Parameterized resolution for all three codes (confirmed_suspicious, false_positive, insufficient_evidence)', async () => {
    // 1. Resolve caseA from in_review as owner -> confirmed_suspicious / closed
    const resolveA = await apiCaseCommand(
      caseAId,
      {
        action: 'resolve',
        expected_version: 4,
        resolution_code: 'confirmed_suspicious',
        resolution_notes: 'Confirmed fraudulent charge pattern and proxy IP match',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000117' }
    );
    expect(resolveA.status).toBe(200);
    const dataA = (await resolveA.json()).data;
    expect(dataA.status).toBe('closed');
    expect(dataA.version).toBe(5);

    // Verify detail in DB agrees
    const detailA = await apiGetCaseDetail(caseAId, WHO_ANALYST_A);
    const detailAJson = (await detailA.json()).data;
    expect(detailAJson.resolution_code).toBe('confirmed_suspicious');
    expect(detailAJson.resolution_notes).toBe('Confirmed fraudulent charge pattern and proxy IP match');
    expect(detailAJson.closed_at).not.toBeNull();

    // 2. Create caseB, start review, dismiss as false_positive by owner
    const createB = await apiCreateCase(
      { transaction_id: txn4, priority: 'low', reason: 'Review txn 4' },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000118' }
    );
    const caseBId = (await createB.json()).data.case_id;

    await apiCaseCommand(
      caseBId,
      { action: 'start_review', expected_version: 1 },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000119' }
    );

    const dismissB = await apiCaseCommand(
      caseBId,
      {
        action: 'dismiss',
        expected_version: 2,
        resolution_code: 'false_positive',
        resolution_notes: 'Cardholder verified international travel notification on file',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000120' }
    );
    expect(dismissB.status).toBe(200);
    const dataB = (await dismissB.json()).data;
    expect(dataB.status).toBe('dismissed');
    expect(dataB.version).toBe(3);

    // 3. Create caseC, start review, escalate, admin dismisses with insufficient_evidence
    const createC = await apiCreateCase(
      { transaction_id: txn5, priority: 'high', reason: 'Review txn 5' },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000121' }
    );
    const caseCId = (await createC.json()).data.case_id;

    await apiCaseCommand(
      caseCId,
      { action: 'start_review', expected_version: 1 },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000122' }
    );

    await apiCaseCommand(
      caseCId,
      { action: 'escalate', expected_version: 2, reason: 'Escalating for inconclusive telemetry' },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000123' }
    );

    const dismissC = await apiCaseCommand(
      caseCId,
      {
        action: 'dismiss',
        expected_version: 3,
        resolution_code: 'insufficient_evidence',
        resolution_notes: 'Merchant did not provide telemetry logs within response SLA',
      },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000124' }
    );
    expect(dismissC.status).toBe(200);
    const dataC = (await dismissC.json()).data;
    expect(dataC.status).toBe('dismissed');
    expect(dataC.version).toBe(4);
  });

  it('VS12: Admin reopens terminal case; active owner retained; inactive owner reset via assigned event', async () => {
    // 1. Admin reopens caseA (closed, active owner Analyst A)
    const reopenA = await apiCaseCommand(
      caseAId,
      { action: 'reopen', expected_version: 5, reason: 'New intelligence received from issuing network' },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000125' }
    );
    expect(reopenA.status).toBe(200);
    const dataA = (await reopenA.json()).data;
    expect(dataA.status).toBe('open');
    expect(dataA.version).toBe(6);
    expect(dataA.assigned_to_user_id).toBe(analystA); // Active owner retained

    // Verify detail clears resolution fields and closed_at
    const detailA = (await (await apiGetCaseDetail(caseAId, WHO_ADMIN)).json()).data;
    expect(detailA.status).toBe('open');
    expect(detailA.resolution_code).toBeNull();
    expect(detailA.resolution_notes).toBeNull();
    expect(detailA.closed_at).toBeNull();
    expect(detailA.due_at).toBeNull();

    // 2. Owner starts review and resolves case A again
    const review2 = await apiCaseCommand(
      caseAId,
      { action: 'start_review', expected_version: 6 },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000126' }
    );
    expect(review2.status).toBe(200);

    const resolve2 = await apiCaseCommand(
      caseAId,
      {
        action: 'resolve',
        expected_version: 7,
        resolution_code: 'confirmed_suspicious',
        resolution_notes: 'Re-resolved by analyst',
      },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000127' }
    );
    expect(resolve2.status).toBe(200);

    // 3. Separately test reopening an inactive-owner fixture:
    // Create a new terminal case owned by analyst B
    const inactiveTxn = id(106);
    const createRes = await apiCreateCase(
      { transaction_id: inactiveTxn, priority: 'medium', reason: 'Case for inactive owner test' },
      WHO_ANALYST_B,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000150' }
    );
    expect(createRes.status).toBe(201);
    const inactiveCaseId = (await createRes.json()).data.case_id;

    await apiCaseCommand(
      inactiveCaseId,
      { action: 'start_review', expected_version: 1 },
      WHO_ANALYST_B,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000151' }
    );

    await apiCaseCommand(
      inactiveCaseId,
      {
        action: 'resolve',
        expected_version: 2,
        resolution_code: 'confirmed_suspicious',
        resolution_notes: 'Resolved before deactivation',
      },
      WHO_ANALYST_B,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000152' }
    );

    // Now deactivate Analyst B in database
    await client.query('UPDATE public.app_user SET is_active = false WHERE user_id = $1', [analystB]);

    // Admin reopens the terminal case while analyst B is inactive
    const reopenInactive = await apiCaseCommand(
      inactiveCaseId,
      { action: 'reopen', expected_version: 3, reason: 'Reopened while former owner is inactive' },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000153' }
    );
    expect(reopenInactive.status).toBe(200);
    const inactiveReopenData = (await reopenInactive.json()).data;
    expect(inactiveReopenData.status).toBe('open');
    expect(inactiveReopenData.assigned_to_user_id).toBeNull(); // Reset to unassigned!

    // Reactivate analyst B and restore active session
    await client.query('UPDATE public.app_user SET is_active = true WHERE user_id = $1', [analystB]);
    const sessionB = await createSession(analystB, client);
    cookies[WHO_ANALYST_B] = `${SESSION_COOKIE_NAME}=${await encodeSessionToken(analystB, sessionB.sessionId)}`;
  });

  it('VS13: Analyst attempts reopening -> 403; admin attempts reopen when competing active case exists -> 409', async () => {
    // 1. Analyst attempts reopening case A -> 403
    const analystReopen = await apiCaseCommand(
      caseAId,
      { action: 'reopen', expected_version: 8, reason: 'Analyst trying to reopen' },
      WHO_ANALYST_A,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000129' }
    );
    expect(analystReopen.status).toBe(403);

    // 2. Prepare terminal case on txn3
    // Case on txn3 was created in VS08 (forged actor test).
    const case3Res = await client.query('SELECT case_id, version, status FROM public.investigation_case WHERE transaction_id = $1', [txn3]);
    const case3Id = case3Res.rows[0].case_id;
    const case3Ver = Number(case3Res.rows[0].version);

    await apiCaseCommand(
      case3Id,
      { action: 'start_review', expected_version: case3Ver },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000130' }
    );
    await apiCaseCommand(
      case3Id,
      {
        action: 'resolve',
        expected_version: case3Ver + 1,
        resolution_code: 'confirmed_suspicious',
        resolution_notes: 'Initial resolution on case 3',
      },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000131' }
    );

    // Now insert a second active case for txn3 manually in database
    const competingId = '90000000-0000-0000-0000-000000000999';
    await client.query(
      `INSERT INTO public.investigation_case (case_id, case_ref, transaction_id, status, priority, opened_at, updated_at, version)
       VALUES ($1, 'COMPETING-ACTIVE-CASE', $2, 'open', 'low', clock_timestamp(), clock_timestamp(), 1)`,
      [competingId, txn3]
    );

    // Admin attempts reopen on case3 while competing active case exists for txn3 -> 409
    const competingReopen = await apiCaseCommand(
      case3Id,
      { action: 'reopen', expected_version: case3Ver + 2, reason: 'Attempt reopening while competing exists' },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000132' }
    );
    expect(competingReopen.status).toBe(409);
    const errJson = await competingReopen.json();
    expect(errJson.error.code).toBe('active_case_exists');

    // Clean up competing case
    await client.query('DELETE FROM public.investigation_case WHERE case_id = $1', [competingId]);
  });

  it('VS14: Optimistic concurrency - concurrent mutations on same expected_version produce 409', async () => {
    // Admin reopens case A from version 8 -> 9
    const reopen = await apiCaseCommand(
      caseAId,
      { action: 'reopen', expected_version: 8, reason: 'Reopened for concurrency test' },
      WHO_ADMIN,
      { 'idempotency-key': '90000000-0000-0000-0000-000000000160' }
    );
    expect(reopen.status).toBe(200);
    const currentVersion = 9;

    const key1 = '90000000-0000-0000-0000-000000000161';
    const key2 = '90000000-0000-0000-0000-000000000162';

    // Two requests both send expected_version = 9
    const [res1, res2] = await Promise.all([
      apiCaseCommand(
        caseAId,
        { action: 'start_review', expected_version: currentVersion },
        WHO_ADMIN,
        { 'idempotency-key': key1 }
      ),
      apiCaseCommand(
        caseAId,
        { action: 'start_review', expected_version: currentVersion },
        WHO_ADMIN,
        { 'idempotency-key': key2 }
      ),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    const conflictJson = await conflictRes.json();
    expect(conflictJson.error.code).toBe('version_conflict');
  });

  it('VS15: Privilege boundaries and immutability trigger protection', async () => {
    // 1. As nonowner role finsight_auth_probe, direct INSERT/UPDATE/DELETE on case_event fails
    await client.query("CALL public.grant_runtime_privileges('finsight_auth_probe'::regrole)");
    await client.query("CALL public.grant_auth_privileges('finsight_auth_probe'::regrole)");

    const probeClient = new pg.Client({ connectionString: requireTestDatabase() });
    await probeClient.connect();
    try {
      await probeClient.query('SET ROLE finsight_auth_probe');

      // Direct INSERT on case_event denied
      await expect(
        probeClient.query(`
          INSERT INTO public.case_event (case_id, actor_user_id, event_type, from_state, to_state, operation_id, event_ordinal)
          VALUES ('${caseAId}', '${analystA}', 'created', NULL, '{"status":"open"}'::jsonb, gen_random_uuid(), 99)
        `)
      ).rejects.toThrow(/permission denied/);

      // Direct UPDATE on case_event denied
      await expect(
        probeClient.query(`UPDATE public.case_event SET metadata = '{}'::jsonb WHERE case_id = '${caseAId}'`)
      ).rejects.toThrow(/permission denied/);

      // Direct DELETE on case_event denied
      await expect(
        probeClient.query(`DELETE FROM public.case_event WHERE case_id = '${caseAId}'`)
      ).rejects.toThrow(/permission denied/);
    } finally {
      await probeClient.end();
    }

    // 2. Even with superuser/owner table privileges, immutability trigger blocks update/delete on case_event
    await expect(
      client.query(`UPDATE public.case_event SET metadata = '{}'::jsonb WHERE case_id = $1`, [caseAId])
    ).rejects.toThrow(/Case events are immutable/);

    await expect(
      client.query(`DELETE FROM public.case_event WHERE case_id = $1`, [caseAId])
    ).rejects.toThrow(/Case events are immutable/);
  });

  it('Queue projection: Analyst sees owned cases + unassigned minimal summaries, but not other analysts cases', async () => {
    // Analyst A queue
    const resA = await apiGetCases({}, WHO_ANALYST_A);
    expect(resA.status).toBe(200);
    const jsonA = await resA.json();

    // Verify all cases returned to Analyst A are either assigned to Analyst A or unassigned
    for (const item of jsonA.data) {
      if (item.assigned_to_user_id) {
        expect(item.assigned_to_user_id).toBe(analystA);
        expect(item.version).toBeDefined(); // full row
      } else {
        // Unassigned summary: minimal projected fields only
        expect(item.case_ref).toBeDefined();
        expect(item.transaction_id).toBeDefined();
        expect(item.priority).toBeDefined();
        expect(item.status).toBeDefined();
        expect(item.assigned_to_user_id).toBeUndefined(); // stripped by projection
      }
    }

    // Admin sees all cases with full details
    const resAdmin = await apiGetCases({}, WHO_ADMIN);
    expect(resAdmin.status).toBe(200);
    const jsonAdmin = await resAdmin.json();
    expect(jsonAdmin.data.length).toBeGreaterThanOrEqual(jsonA.data.length);
    for (const item of jsonAdmin.data) {
      expect(item.version).toBeDefined();
    }

    // Anonymous, inactive, and system user requests return 401
    const anon = await casesList(new Request('http://localhost/api/v1/cases'));
    expect(anon.status).toBe(401);
    const inactiveRes = await apiGetCases({}, WHO_INACTIVE);
    expect(inactiveRes.status).toBe(401);
    const systemRes = await apiGetCases({}, WHO_SYSTEM);
    expect(systemRes.status).toBe(401);
  });
});
