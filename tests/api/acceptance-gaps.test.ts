import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { seedFinancial, syntheticId } from '../../scripts/financial-seed.mjs';

vi.mock('server-only', () => ({}));
import { createSession, SESSION_COOKIE_NAME } from '../../src/server/session';
import { encodeSessionToken } from '../../src/server/authentication';
import { getPool } from '../../src/server/db';
import { POST as create } from '../../src/app/api/v1/cases/route';
import { POST as command } from '../../src/app/api/v1/cases/[id]/commands/route';

const actors = ['97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000002'];
const cookies: string[] = [];
let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: requireTestDatabase() });
  await db.connect();
  await applyMigrations(db, new URL('../../migrations/', import.meta.url));
  await seedFinancial(db);
  for (const [index, actor] of actors.entries()) {
    await db.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role)
      VALUES ($1,$2,'synthetic-noncredential','Acceptance actor',$3)`,
    [actor, `acceptance_${index}@synthetic.invalid`, index === 0 ? 'analyst' : 'admin']);
    const session = await createSession(actor, db);
    cookies.push(`${SESSION_COOKIE_NAME}=${await encodeSessionToken(actor, session.sessionId)}`);
  }
});

afterAll(async () => {
  if (db) {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await db.end();
    await getPool().end();
  }
});

function request(path: string, data: unknown, actor: number, key = randomUUID()) {
  return new Request(`http://localhost${path}`, { method: 'POST', headers: {
    origin: 'http://localhost', 'content-type': 'application/json', cookie: cookies[actor], 'idempotency-key': key,
  }, body: JSON.stringify(data) });
}

async function newCase(subject = syntheticId(100)) {
  const response = await create(request('/api/v1/cases', {
    transaction_id: subject, priority: 'high', reason: 'Synthetic acceptance evidence',
  }, 0));
  expect(response.status).toBe(201);
  return (await response.json()).data as { case_id: string; version: number };
}

async function send(id: string, version: number, action: string, extras: Record<string, unknown> = {}, actor = 0, key = randomUUID()) {
  return command(request(`/api/v1/cases/${id}/commands`, { action, expected_version: version, ...extras }, actor, key),
    { params: Promise.resolve({ id }) });
}

async function accepted(id: string, version: number, action: string, extras: Record<string, unknown> = {}, actor = 0) {
  const result = await send(id, version, action, extras, actor);
  expect(result.status).toBe(200);
  return (await result.json()).data.version as number;
}

async function snapshot(id: string) {
  return (await db.query(`SELECT row_to_json(c) AS state,
    (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY event_id),'[]') FROM public.case_event e WHERE e.case_id=c.case_id) AS events,
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY operation_id),'[]') FROM public.case_command_receipt r WHERE r.case_id=c.case_id) AS receipts
    FROM public.investigation_case c WHERE case_id=$1`, [id])).rows[0];
}

test('VS11: every outcome code maps correctly for the owner and escalated admin paths', async () => {
  for (const actor of [0, 1]) {
    for (const [code, status] of [['confirmed_suspicious', 'closed'], ['false_positive', 'dismissed'], ['insufficient_evidence', 'dismissed']]) {
      const { case_id: id } = await newCase();
      let version = await accepted(id, 1, 'start_review');
      if (actor === 1) version = await accepted(id, version, 'escalate', { reason: 'Synthetic administrative review' });
      const notes = `Synthetic outcome ${code}`;
      await accepted(id, version, code === 'confirmed_suspicious' ? 'resolve' : 'dismiss', {
        resolution_code: code, resolution_notes: notes,
      }, actor);
      const result = await snapshot(id);
      expect(result.state).toMatchObject({ status, resolution_code: code, resolution_notes: notes });
      expect(result.state.closed_at).not.toBeNull();
      const event = result.events.at(-1);
      expect(event.reason).toBe(notes);
      expect(event.to_state).toMatchObject({ status, resolution_code: code });
      expect(event.to_state).not.toHaveProperty('resolution_notes');
      expect(event.from_state).not.toHaveProperty('reason');
      expect(event.metadata).toEqual({});
    }
  }
});

test('VS12: repeated reopening preserves both terminal records, identity and priority while clearing outcome and due time', async () => {
  const { case_id: id } = await newCase(syntheticId(101));
  const initial = (await snapshot(id)).state;
  let version = 1;
  const terminalRecords: unknown[] = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    version = await accepted(id, version, 'start_review');
    await db.query("UPDATE public.investigation_case SET due_at=clock_timestamp()+interval '1 day' WHERE case_id=$1", [id]);
    version = await accepted(id, version, 'resolve', { resolution_code: 'confirmed_suspicious', resolution_notes: `Synthetic terminal record ${cycle}` });
    terminalRecords.push((await snapshot(id)).events.at(-1));
    version = await accepted(id, version, 'reopen', { reason: `Synthetic reopening ${cycle}` }, 1);
    const result = await snapshot(id);
    expect(result.state).toMatchObject({
      case_id: id, case_ref: initial.case_ref, opened_at: initial.opened_at, priority: initial.priority,
      assigned_to_user_id: actors[0], status: 'open', resolution_code: null, resolution_notes: null, closed_at: null, due_at: null,
    });
    for (const event of terminalRecords) expect(result.events).toContainEqual(event);
  }
});

test('VS03: demotion immediately denies an admin-only mutation and deactivation denies writes without side effects', async () => {
  const { case_id: id } = await newCase(syntheticId(102));
  let version = await accepted(id, 1, 'start_review');
  version = await accepted(id, version, 'resolve', { resolution_code: 'confirmed_suspicious', resolution_notes: 'Synthetic closed case' });
  const before = await snapshot(id);
  try {
    await db.query("UPDATE public.app_user SET role='analyst' WHERE user_id=$1", [actors[1]]);
    expect((await send(id, version, 'reopen', { reason: 'Synthetic denied request' }, 1)).status).toBe(404);
    await db.query('UPDATE public.app_user SET is_active=false WHERE user_id=$1', [actors[0]]);
    expect((await send(id, version, 'start_review')).status).toBe(401);
    expect(await snapshot(id)).toEqual(before);
  } finally {
    await db.query("UPDATE public.app_user SET role='admin' WHERE user_id=$1", [actors[1]]);
    await db.query('UPDATE public.app_user SET is_active=true WHERE user_id=$1', [actors[0]]);
  }
});

test('VS09: reopen reason boundaries and invalid outcome combinations leave case, events and receipts unchanged', async () => {
  const { case_id: id } = await newCase(syntheticId(103));
  let version = await accepted(id, 1, 'start_review');
  const beforeInvalid = await snapshot(id);
  for (const payload of [
    { resolution_code: 'false_positive', resolution_notes: 'Wrong code for resolve' },
    { resolution_code: 'confirmed_suspicious', resolution_notes: ' ' },
    { resolution_code: 'confirmed_suspicious', resolution_notes: '  Untrimmed notes  ' },
    { resolution_code: 'confirmed_suspicious', resolution_notes: 'x'.repeat(5001) },
    { resolution_code: 'unknown', resolution_notes: 'Unknown code' },
  ]) {
    expect([400, 422]).toContain((await send(id, version, 'resolve', payload)).status);
    expect(await snapshot(id)).toEqual(beforeInvalid);
  }
  version = await accepted(id, version, 'resolve', { resolution_code: 'confirmed_suspicious', resolution_notes: 'Synthetic closure' });
  const beforeReopen = await snapshot(id);
  for (const reason of [' ', 'x'.repeat(2001)]) {
    expect([400, 422]).toContain((await send(id, version, 'reopen', { reason }, 1)).status);
    expect(await snapshot(id)).toEqual(beforeReopen);
  }
});

test('VS14: failures before event and receipt insertion roll back state, events and receipts together', async () => {
  const { case_id: id } = await newCase(syntheticId(104));
  const before = await snapshot(id);
  await db.query(`CREATE FUNCTION public.acceptance_injected_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Synthetic acceptance fault' USING ERRCODE='P0001'; END $$`);
  try {
    for (const table of ['case_event', 'case_command_receipt']) {
      await db.query(`CREATE TRIGGER acceptance_fault BEFORE INSERT ON public.${table}
        FOR EACH ROW WHEN (NEW.case_id='${id}'::uuid) EXECUTE FUNCTION public.acceptance_injected_failure()`);
      try {
        const key = randomUUID();
        const response = await send(id, 1, 'start_review', {}, 0, key);
        expect(response.status).toBe(503);
        expect(JSON.stringify(await response.json())).not.toContain('Synthetic acceptance fault');
        expect(await snapshot(id)).toEqual(before);
        expect((await db.query('SELECT count(*)::int AS n FROM public.case_command_receipt WHERE idempotency_key=$1', [key])).rows[0].n).toBe(0);
      } finally { await db.query(`DROP TRIGGER acceptance_fault ON public.${table}`); }
    }
  } finally { await db.query('DROP FUNCTION public.acceptance_injected_failure()'); }
  await accepted(id, 1, 'start_review');
});
