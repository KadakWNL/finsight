import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { requireTestDatabase } from '../scripts/database-safety.mjs';

const connectionString = requireTestDatabase();
const owner = new pg.Client({ connectionString });
const contender = new pg.Client({ connectionString });
const observer = new pg.Client({ connectionString });
const account = '20000000-0000-0000-0000-000000000010';
const insertDebit = `INSERT INTO public.transaction
  (transaction_id,account_id,method_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,occurred_at,merchant_country_code,description)
  SELECT $1,account_id,method_id,merchant_id,device_id,700,currency_code,exchange_rate,direction,txn_type,status,occurred_at,merchant_country_code,description
  FROM public.transaction WHERE transaction_id='20000000-0000-0000-0000-000000000100'`;

try {
  await owner.connect(); await contender.connect(); await observer.connect();
  const role = (await owner.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert.equal(role.rolsuper, false);
  assert.equal(Math.floor(Number((await owner.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 17);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.transaction')).rows[0].n, 0,
    'Use a fresh isolated test database; this verifier retains synthetic fixtures.');
  await owner.query(await readFile(new URL('./sql/financial_fixture.sql', import.meta.url), 'utf8'));
  await owner.query('BEGIN');
  await owner.query('SELECT balance FROM public.account WHERE account_id=$1 FOR UPDATE', [account]);
  await contender.query('BEGIN');
  const pid = (await contender.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const blockedRead = contender.query('SELECT balance FROM public.account WHERE account_id=$1 FOR UPDATE', [account]);
  let waiting = false;
  for (let n = 0; n < 100; n++) {
    const activity = (await observer.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
    if (activity?.wait_event_type === 'Lock') { waiting = true; break; }
    await setTimeout(20);
  }
  assert.ok(waiting, 'Second debit must wait on the account row lock');
  await owner.query('UPDATE public.account SET balance=balance-700 WHERE account_id=$1', [account]);
  await owner.query(insertDebit, ['20000000-0000-0000-0000-000000000102']);
  await owner.query('COMMIT');
  assert.equal((await blockedRead).rows[0].balance, '300.00');
  await assert.rejects(contender.query('UPDATE public.account SET balance=balance-700 WHERE account_id=$1', [account]), { code: '23514' });
  await contender.query('ROLLBACK');
  assert.equal((await owner.query('SELECT balance FROM public.account WHERE account_id=$1', [account])).rows[0].balance, '300.00');
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.transaction')).rows[0].n, 3);
  await owner.query('BEGIN');
  await owner.query('SELECT balance FROM public.account WHERE account_id=$1 FOR UPDATE', [account]);
  await owner.query('UPDATE public.account SET balance=balance-100 WHERE account_id=$1', [account]);
  await owner.query(insertDebit, ['20000000-0000-0000-0000-000000000103']);
  await assert.rejects(owner.query('SELECT 1/0'), { code: '22012' });
  await owner.query('ROLLBACK');
  assert.equal((await owner.query('SELECT balance FROM public.account WHERE account_id=$1', [account])).rows[0].balance, '300.00');
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM public.transaction')).rows[0].n, 3);
  console.log('PASS row-lock contention, nonnegative balance and atomic rollback');

  await owner.query(`INSERT INTO public.account (account_id,customer_id,account_number,account_type,currency_code,balance,status,opened_at)
    SELECT ('22000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      '20000000-0000-0000-0000-000000000001','SYN-PLAN-'||n,'savings','INR',1000,'active','2026-01-01'
    FROM generate_series(1,99) n`);
  await owner.query(`INSERT INTO public.merchant (merchant_id,merchant_name,category_code,country_code,risk_tier)
    SELECT ('23000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Synthetic plan merchant '||n,'5411','IN','low'
    FROM generate_series(1,99) n`);
  await owner.query(`INSERT INTO public.device_fingerprint (device_id,device_hash,os_family,first_seen_at)
    SELECT ('24000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,lpad(n::text,64,'0'),'synthetic','2026-01-01T00:00:00Z'
    FROM generate_series(1,99) n`);
  await owner.query(`INSERT INTO public.transaction
    (transaction_id,account_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,occurred_at,merchant_country_code,description)
    SELECT ('21000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
      CASE WHEN n%100=0 THEN '${account}'::uuid ELSE ('22000000-0000-0000-0000-'||lpad((n%100)::text,12,'0'))::uuid END,
      CASE WHEN n%100=0 THEN '20000000-0000-0000-0000-000000000030'::uuid ELSE ('23000000-0000-0000-0000-'||lpad((n%100)::text,12,'0'))::uuid END,
      CASE WHEN n%100=0 THEN '20000000-0000-0000-0000-000000000040'::uuid ELSE ('24000000-0000-0000-0000-'||lpad((n%100)::text,12,'0'))::uuid END,
      5,'INR',1,'debit','card_payment','posted','2026-01-01T00:00:00Z'::timestamptz + n*interval '1 minute','IN',
      CASE WHEN n=123 THEN 'Synthetic uncommonkeyword' ELSE 'Synthetic ordinary fixture' END
    FROM generate_series(1,10000) n`);
  await owner.query('ANALYZE public.transaction');
  const queries = [
    ['cursor', 'SELECT transaction_id FROM public.transaction ORDER BY occurred_at DESC, transaction_id DESC LIMIT 25', 'transaction_cursor'],
    ['account activity', `SELECT transaction_id FROM public.transaction WHERE account_id='${account}' ORDER BY occurred_at DESC, transaction_id DESC LIMIT 25`, 'transaction_account_activity'],
    ['merchant activity', "SELECT transaction_id FROM public.transaction WHERE merchant_id='20000000-0000-0000-0000-000000000030' ORDER BY occurred_at DESC, transaction_id DESC LIMIT 25", 'transaction_merchant_activity'],
    ['device activity', "SELECT transaction_id FROM public.transaction WHERE device_id='20000000-0000-0000-0000-000000000040' ORDER BY occurred_at DESC, transaction_id DESC LIMIT 25", 'transaction_device_activity'],
    ['description FTS', "SELECT transaction_id FROM public.transaction WHERE search_vector @@ plainto_tsquery('english','uncommonkeyword')", 'transaction_description_search'],
  ];
  const plans = [];
  for (const [name, sql, index] of queries) {
    const plan = (await owner.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'];
    assert.ok(JSON.stringify(plan).includes(index), `Missing expected index for ${name}: ${JSON.stringify(plan)}`);
    plans.push({ name, sql, expectedIndex: index, plan });
    console.log(`PASS EXPLAIN ${name}: ${index}; execution ${plan[0]['Execution Time']} ms`);
  }
  if (process.env.ACCEPTANCE_PLAN_OUTPUT) await writeFile(process.env.ACCEPTANCE_PLAN_OUTPUT, JSON.stringify(plans, null, 2) + '\n');
  const existing = (await owner.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename IN ('transaction','risk_signal','payment_method') ORDER BY indexname`)).rows.map(r => r.indexname);
  assert.ok(existing.includes('risk_signal_transaction_id_rule_id_key'));
  assert.ok(existing.includes('payment_method_method_id_account_id_key'));
  console.log('PASS existing signal transaction/rule and method/account unique indexes retained');
} finally {
  await Promise.allSettled([owner, contender, observer].map(async client => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }));
}
