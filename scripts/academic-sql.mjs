import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyMigrations } from './migration-runner.mjs';
import { seedFinancial, syntheticId } from './financial-seed.mjs';

// The caller must establish ownership of a fresh isolated test database before resetting it.
export async function demonstrateAcademicSql(owner, runtime) {
  const evidence = [];
  async function query(client, id, sql, params = []) {
    const { rows } = await client.query(sql, params);
    evidence.push({ id, sql, rows }); // Bound values and connection strings are deliberately omitted.
    return rows;
  }
  async function denied(client, id, sql, params, code) {
    await assert.rejects(client.query(sql, params), { code });
    evidence.push({ id, sql, rejectedWith: code });
  }
  await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await applyMigrations(owner, new URL('../migrations/', import.meta.url));
  await seedFinancial(owner);

  await owner.query('BEGIN');
  try {
    await query(owner, 'ddl-create', 'CREATE TEMP TABLE academic_ddl_probe (id integer PRIMARY KEY, quantity integer CHECK (quantity > 0))');
    await query(owner, 'ddl-alter', 'ALTER TABLE pg_temp.academic_ddl_probe ADD COLUMN purpose text NOT NULL DEFAULT \'disposable demonstration\'');
    await query(owner, 'ddl-insert', 'INSERT INTO pg_temp.academic_ddl_probe(id,quantity) VALUES (1,2) RETURNING id,quantity,purpose');
    await query(owner, 'ddl-drop', 'DROP TABLE pg_temp.academic_ddl_probe');
    const dropped = await query(owner, 'ddl-drop-check', "SELECT to_regclass('pg_temp.academic_ddl_probe') IS NULL AS removed");
    assert.equal(dropped[0].removed, true);
  } finally { await owner.query('ROLLBACK'); }

  const grouped = await query(runtime, 'joins-group-having-order', `SELECT m.merchant_name, count(*)::integer AS transaction_count,
    sum(t.amount_base)::text AS total_inr, max(v.risk_score)::text AS maximum_risk
    FROM public.transaction t JOIN public.merchant m USING(merchant_id)
    JOIN public.v_transaction_risk v USING(transaction_id)
    WHERE t.transaction_id IN (SELECT transaction_id FROM public.v_transaction_risk WHERE signal_count > 0)
    GROUP BY m.merchant_id,m.merchant_name HAVING count(*) >= 2
    ORDER BY max(v.risk_score) DESC,m.merchant_name`);
  assert.deepEqual(grouped, [
    { merchant_name: 'Synthetic high merchant', transaction_count: 3, total_inr: '22500.00', maximum_risk: '65' },
    { merchant_name: 'Synthetic low merchant', transaction_count: 2, total_inr: '20000.00', maximum_risk: '40' },
  ]);
  const risk = await query(runtime, 'risk-view', `SELECT transaction_id,risk_score::text,signal_count,risk_band
    FROM public.v_transaction_risk ORDER BY transaction_id`);
  assert.equal(risk.length, 8);
  assert.equal(risk.find(row => row.transaction_id === syntheticId(105)).risk_score, '65');

  const admin = randomUUID();
  const analyst = randomUUID();
  await owner.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role)
    VALUES ($1,'academic_admin@synthetic.invalid','test-only','Synthetic academic admin','admin'),
      ($2,'academic_analyst@synthetic.invalid','test-only','Synthetic academic analyst','analyst')`, [admin, analyst]);
  const created = (await query(runtime, 'guarded-case-insert', `SELECT * FROM public.execute_case_command(
    'create',$1,$2,repeat('a',64),NULL,NULL,$3,'high','Synthetic academic investigation',NULL,NULL,'ACADEMIC-DEMO')`,
  [analyst, randomUUID(), syntheticId(105)]))[0];
  const reviewed = (await query(runtime, 'guarded-case-update', `SELECT * FROM public.execute_case_command(
    'start_review',$1,$2,repeat('b',64),$3,$4)`, [analyst, randomUUID(), created.version, created.case_id]))[0];
  assert.equal(reviewed.status, 'in_review');
  assert.equal(Number(reviewed.version), 2);
  const history = await query(runtime, 'case-history', `SELECT event_type,reason,from_state,to_state
    FROM public.case_event WHERE case_id=$1 ORDER BY occurred_at,event_ordinal,event_id`, [created.case_id]);
  assert.equal(history.length, 3);
  await denied(owner, 'immutable-event-trigger', 'UPDATE public.case_event SET reason=reason WHERE case_id=$1', [created.case_id], '55000');
  await denied(runtime, 'runtime-event-mutation-denied', 'DELETE FROM public.case_event WHERE case_id=$1', [created.case_id], '42501');

  const protectedTables = ['customer', 'account', 'transaction', 'risk_rule', 'risk_signal', 'investigation_case', 'case_event', 'case_command_receipt', 'app_user'];
  async function counts() {
    const result = {};
    for (const table of protectedTables) result[table] = Number((await owner.query(`SELECT count(*) FROM public.${table}`)).rows[0].count);
    return result;
  }
  const before = await counts();
  await owner.query(`INSERT INTO public.app_session(session_id,user_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    VALUES (gen_random_uuid(),$1,clock_timestamp()-interval '8 days',clock_timestamp()-interval '8 days',
      clock_timestamp()-interval '8 days'+interval '20 minutes',clock_timestamp()-interval '8 days'+interval '4 hours'),
    (gen_random_uuid(),$1,clock_timestamp()-interval '3 days',clock_timestamp()-interval '3 days',
      clock_timestamp()-interval '3 days'+interval '20 minutes',clock_timestamp()-interval '3 days'+interval '4 hours'),
    (gen_random_uuid(),$1,clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '5 minutes',
      clock_timestamp()+interval '20 minutes',clock_timestamp()+interval '4 hours')`, [admin]);
  const preview = (await query(runtime, 'cleanup-preview', 'SELECT * FROM public.preview_app_session_cleanup($1)', [admin]))[0];
  assert.equal(preview.candidate_count, 1);
  await denied(runtime, 'runtime-direct-delete-denied', 'DELETE FROM public.app_session', [], '42501');
  await denied(runtime, 'analyst-cleanup-denied', 'SELECT * FROM public.preview_app_session_cleanup($1)', [analyst], '42501');
  await runtime.query('BEGIN');
  try {
    const rolledBack = (await query(runtime, 'cleanup-inside-rolled-back-transaction', `SELECT * FROM public.confirm_app_session_cleanup($1,$2,$3,repeat('c',64))`,
      [preview.operation_id, admin, randomUUID()]))[0];
    assert.equal(rolledBack.deleted_count, 1);
  } finally { await runtime.query('ROLLBACK'); }
  const restored = await query(owner, 'rollback-restored-session-and-audit', `SELECT (SELECT count(*)::integer FROM public.app_session) AS sessions,
    status,deleted_count FROM public.app_session_cleanup WHERE operation_id=$1`, [preview.operation_id]);
  assert.equal(restored[0].sessions, 3);
  assert.equal(restored[0].status, 'previewed');
  assert.equal(restored[0].deleted_count, null);
  const key = randomUUID();
  const confirmed = (await query(runtime, 'cleanup-committed-delete', `SELECT * FROM public.confirm_app_session_cleanup($1,$2,$3,repeat('d',64))`,
    [preview.operation_id, admin, key]))[0];
  assert.equal(confirmed.deleted_count, 1);
  const replay = (await query(runtime, 'cleanup-replay', `SELECT * FROM public.confirm_app_session_cleanup($1,$2,$3,repeat('d',64))`,
    [preview.operation_id, admin, key]))[0];
  assert.equal(replay.replayed, true);
  assert.equal(replay.deleted_count, 1);
  const retained = await query(owner, 'cleanup-retained-active-recent-sessions', 'SELECT count(*)::integer AS remaining_sessions FROM public.app_session');
  assert.equal(retained[0].remaining_sessions, 2);
  const after = await counts();
  assert.deepEqual(after, before);
  evidence.push({ id: 'protected-row-counts', before, after, unchanged: true });
  return evidence;
}
