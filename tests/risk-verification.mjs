import assert from 'node:assert/strict';
import pg from 'pg';
import { requireTestDatabase } from '../scripts/database-safety.mjs';
import { scenarios, syntheticId as id, seedFinancialFacts, seedRiskRules, seedFinancial } from '../scripts/financial-seed.mjs';
import { listTransactions, transactionRiskDetail, merchantRiskSummary } from '../src/server/financial-queries.ts';

const client = new pg.Client({ connectionString: requireTestDatabase() });
const concurrent = new pg.Client({ connectionString: requireTestDatabase() });
const signals = async () => (await client.query('SELECT * FROM public.risk_signal ORDER BY signal_id')).rows;

async function rules({ amountActive = true, amountWeight = 40, amountThreshold = 10000, merchantThreshold = 2, merchantActive = true, amountDimension = 'amount', amountVersion = 1, merchantCode = 'MERCHANT_TIER_GTE', omitMerchant = false } = {}) {
  await client.query(`INSERT INTO public.risk_rule (rule_id,rule_code,rule_name,dimension,weight,threshold_value,is_active,version)
    VALUES ($1,'AMOUNT_BASE_GTE','Synthetic amount',$2,$3,$4,$5,$6)`, [id(50), amountDimension, amountWeight, amountThreshold, amountActive, amountVersion]);
  if (!omitMerchant) await client.query(`INSERT INTO public.risk_rule (rule_id,rule_code,rule_name,dimension,weight,threshold_value,is_active,version)
    VALUES ($1,$2,'Synthetic merchant','merchant',25,$3,$4,1)`, [id(51), merchantCode, merchantThreshold, merchantActive]);
}

try {
  await client.connect(); await concurrent.connect();
  assert.equal((await client.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0].rolsuper, false);
  assert.equal(Math.floor(Number((await client.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 17);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.transaction')).rows[0].n, 0, 'Use a fresh disposable test DB');

  for (const config of [
    { omitMerchant: true }, { amountThreshold: 0 }, { amountThreshold: '10000.001' },
    { amountThreshold: '1000000000000000000' }, { amountDimension: 'device' }, { amountVersion: 2 },
    { merchantThreshold: '1.5' }, { merchantCode: 'UNKNOWN_RULE' }, { merchantThreshold: 3, merchantActive: false },
  ]) {
    await client.query('BEGIN');
    await seedFinancialFacts(client); await rules(config);
    await client.query('SAVEPOINT invalid_config');
    await assert.rejects(client.query('SELECT public.score_transaction($1)', [id(105)]), { code: '22023' });
    await client.query('ROLLBACK TO SAVEPOINT invalid_config');
    assert.equal((await signals()).length, 0);
    await client.query('ROLLBACK');
  }
  console.log('PASS missing/unknown/invalid rule configurations reject before any signals');

  for (const [config, target, expectedScore, expectedCount] of [
    [{ amountActive: false }, 105, '25', 1],
    [{ amountWeight: 0 }, 103, '0', 1],
    [{ amountActive: false, merchantActive: false }, 105, '0', 0],
  ]) {
    await client.query('BEGIN'); await seedFinancialFacts(client); await rules(config);
    await client.query('SELECT public.score_transaction($1)', [id(target)]);
    const row = (await client.query('SELECT * FROM public.v_transaction_risk WHERE transaction_id=$1', [id(target)])).rows[0];
    assert.equal(row.risk_score, expectedScore); assert.equal(row.signal_count, expectedCount);
    await client.query('ROLLBACK');
  }
  console.log('PASS disabled rules and recorded zero-weight versus zero-signal distinction');

  await client.query(`CREATE FUNCTION pg_temp.fail_second_signal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.rule_id='${id(51)}' THEN RAISE EXCEPTION 'Injected synthetic failure' USING ERRCODE='22012'; END IF; RETURN NEW; END $$`);
  await client.query('CREATE TRIGGER injected_signal_failure BEFORE INSERT ON public.risk_signal FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_second_signal()');
  await assert.rejects(seedFinancial(client), { code: '22012' });
  assert.equal((await signals()).length, 0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.transaction')).rows[0].n, 0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.account')).rows[0].n, 0);
  await client.query('DROP TRIGGER injected_signal_failure ON public.risk_signal');
  console.log('PASS failure on second signal rolls back signals and entire seed transaction');

  let injectedConflict=false;
  const conflictingClient={query:async (...args)=>{
    const result=await client.query(...args);
    if(!injectedConflict && args[0]==='SELECT public.score_transaction($1)') {
      injectedConflict=true;
      await client.query(`INSERT INTO public.risk_signal (signal_id,transaction_id,rule_id,observed_value,score_contribution,evidence)
        VALUES (gen_random_uuid(),$1,$2,999,40,'Conflicting synthetic signal')`,[id(100),id(50)]);
    }
    return result;
  }};
  await assert.rejects(seedFinancial(conflictingClient),/Synthetic seed conflict in risk_signal/);
  assert.equal((await signals()).length,0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.transaction')).rows[0].n,0);
  console.log('PASS seed verifies recorded signal facts and rolls back conflicting results');

  await client.query('BEGIN'); await seedFinancialFacts(client); await seedRiskRules(client); await client.query('COMMIT');
  const results = await Promise.all([client, concurrent].map(c => c.query('SELECT public.score_transaction($1) AS n', [id(105)])));
  assert.deepEqual(results.map(r => r.rows[0].n).sort(), [0, 2]);
  await seedFinancial(client);
  const before = await signals();
  await seedFinancial(client);
  assert.deepEqual(await signals(), before);
  assert.equal(before.length, 7);
  for (const [index, scenario] of scenarios.entries()) {
    const detail = await transactionRiskDetail(client, id(100 + index));
    assert.equal(detail.amount, scenario.amount); assert.equal(detail.exchange_rate, scenario.rate);
    assert.equal(detail.amount_base, scenario.base); assert.equal(detail.risk_score, scenario.score);
    assert.equal(detail.risk_band, scenario.band); assert.equal(detail.signal_count, scenario.count);
    assert.equal(detail.signals.length, scenario.count);
    for (const key of ['amount', 'exchange_rate', 'amount_base', 'risk_score']) assert.equal(typeof detail[key], 'string');
    if (!scenario.count) assert.equal(detail.signal_summary, 'No recorded signals');
    for (const signal of detail.signals) {
      assert.equal(typeof signal.observed_value, 'string'); assert.equal(typeof signal.score_contribution, 'string');
      assert.ok(signal.evidence.includes(signal.score_contribution + ' points'));
    }
    for (const forbidden of ['is_suspicious','scenario_code','scenario_id','token','account_number','password_hash','full_name','email']) {
      assert.ok(!JSON.stringify(detail).includes(`"${forbidden}"`));
    }
  }
  const high = await transactionRiskDetail(client, id(105));
  assert.deepEqual(high.signals.map(s => [s.rule_code, s.observed_value, s.score_contribution]), [
    ['AMOUNT_BASE_GTE','12000.00','40'], ['MERCHANT_TIER_GTE','2','25'],
  ]);
  assert.match(high.signals[0].evidence, /INR base 12000.00 >= threshold 10000.00 INR/);
  assert.match(high.signals[1].evidence, /low=0, medium=1, high=2/);
  console.log('PASS all eight exact fixtures, 40+25=65, decimal strings and immutable concurrent/rerun signals');

  const first = await listTransactions(client, { limit: 3 });
  const last = first.at(-1);
  const rest = await listTransactions(client, { cursor: { occurredAt: last.occurred_at, transactionId: last.transaction_id } });
  assert.equal(new Set([...first,...rest].map(r => r.transaction_id)).size, 8);
  assert.equal(first.length + rest.length, 8);
  assert.equal((await listTransactions(client, { query: 'USD' })).length, 3);
  assert.equal((await listTransactions(client, { query: "purchase') OR true --" })).length, 0);
  assert.equal((await listTransactions(client, { riskBand: 'high' })).length, 2);
  assert.equal((await listTransactions(client, { accountId: id(10), merchantId: id(32) })).length, 2);
  await assert.rejects(listTransactions(client, { limit: 101 }), RangeError);
  await assert.rejects(listTransactions(client, { accountId: 'bad' }), RangeError);
  await assert.rejects(listTransactions(client, { query: 'x'.repeat(501) }), RangeError);
  await assert.rejects(listTransactions(client, { cursor: { occurredAt: 'bad', transactionId: id(100) } }), RangeError);
  assert.equal(await transactionRiskDetail(client, id(999)), null);
  const summary = await merchantRiskSummary(client, 2);
  assert.deepEqual(summary.map(r => [r.merchant_id,r.transaction_count,r.recorded_risk_points,r.flagged_count]), [
    [id(32),3,'155',3], [id(30),4,'80',2],
  ]);
  console.log('PASS bounded cursor/FTS/filter/detail queries, label exclusion and JOIN/GROUP BY/HAVING/subquery aggregates');

  for (const [score, expected] of [['0','low'],['34.99','low'],['35','medium'],['59.99','medium'],['60','high'],['79.99','high'],['80','critical'],['125','critical']]) {
    assert.equal((await client.query('SELECT public.risk_band($1) AS band',[score])).rows[0].band,expected);
  }
  for (const bad of ['-1','NaN','Infinity']) await assert.rejects(client.query('SELECT public.risk_band($1)',[bad]),{code:'22023'});
  await assert.rejects(client.query('SELECT public.score_transaction($1)',[id(999)]),{code:'22023'});
  await assert.rejects(client.query('INSERT INTO public.risk_signal SELECT * FROM public.risk_signal LIMIT 1'),{code:'23505'});
  await assert.rejects(client.query('UPDATE public.risk_rule SET weight=weight+1'),{code:'55000'});
  await assert.rejects(client.query("UPDATE public.merchant SET risk_tier='high' WHERE merchant_id=$1",[id(30)]),{code:'55000'});

  await client.query('BEGIN');
  await client.query(`INSERT INTO public.risk_signal (signal_id,transaction_id,rule_id,observed_value,score_contribution,evidence)
    VALUES (gen_random_uuid(),$1,$2,500,100,'Synthetic uncapped aggregate probe'),(gen_random_uuid(),$1,$3,0,100,'Synthetic uncapped aggregate probe')`,[id(100),id(50),id(51)]);
  const uncapped=(await client.query('SELECT risk_score,risk_band FROM public.v_transaction_risk WHERE transaction_id=$1',[id(100)])).rows[0];
  assert.deepEqual(uncapped,{risk_score:'200',risk_band:'critical'});
  await client.query('ROLLBACK');
  console.log('PASS score boundaries, uncapped aggregate, duplicate rejection and frozen configuration');

  await client.query("UPDATE public.merchant SET merchant_name='Conflicting synthetic fixture' WHERE merchant_id=$1",[id(32)]);
  await assert.rejects(seedFinancial(client), /Synthetic seed conflict/);
  assert.deepEqual(await signals(), before);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM public.transaction')).rows[0].n,8);
  await client.query("UPDATE public.merchant SET merchant_name='Synthetic high merchant' WHERE merchant_id=$1",[id(32)]);
  await seedFinancial(client);
  console.log('PASS conflicting stable facts abort seed without overwrite or partial signals');

  await client.query(`INSERT INTO public.transaction
    (transaction_id,account_id,method_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,occurred_at,merchant_country_code,description)
    SELECT x.id,account_id,method_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,
      occurred_at+interval '1 microsecond',merchant_country_code,description
    FROM public.transaction CROSS JOIN (VALUES ($1::uuid),($2::uuid)) x(id) WHERE transaction_id=$3`,[id(900),id(901),id(105)]);
  let detailQueries=0;
  const interleavingClient={query:async (...args)=>{
    const result=await client.query(...args);
    detailQueries++;
    if(detailQueries===1) await concurrent.query('SELECT public.score_transaction($1)',[id(900)]);
    return result;
  }};
  const during=await transactionRiskDetail(interleavingClient,id(900));
  assert.equal(detailQueries,1);
  assert.equal(during.risk_score,'0'); assert.equal(during.signal_count,0); assert.deepEqual(during.signals,[]);
  const after=await transactionRiskDetail(client,id(900));
  assert.equal(after.risk_score,'65'); assert.equal(after.signal_count,after.signals.length);
  let cursor; const paged=[];
  for(let n=0;n<11;n++) {
    const page=await listTransactions(client,{limit:1,cursor});
    if(!page.length) break;
    paged.push(page[0].transaction_id);
    cursor={occurredAt:page[0].occurred_at,transactionId:page[0].transaction_id};
  }
  assert.equal(paged.length,10); assert.equal(new Set(paged).size,10);
  console.log('PASS single-snapshot detail under concurrent scoring and microsecond/tied cursor pages');
} finally {
  await Promise.allSettled([client,concurrent].map(async c => { await c.query('ROLLBACK').catch(() => {}); await c.end(); }));
}
