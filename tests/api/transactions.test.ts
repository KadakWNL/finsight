import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import pg from 'pg';
vi.mock('server-only', () => ({}));
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { seedFinancial, syntheticId as id, scenarios } from '../../scripts/financial-seed.mjs';
import { createSession, revokeSession, SESSION_COOKIE_NAME } from '../../src/server/session';
import { encodeSessionToken } from '../../src/server/authentication';
import { executeCaseCommand } from '../../src/server/case-commands';
import { getPool } from '../../src/server/db';
import { listTransactions, transactionRiskDetail } from '../../src/server/financial-queries';
import { GET as collection } from '../../src/app/api/v1/transactions/route';
import { GET as detail } from '../../src/app/api/v1/transactions/[id]/route';
import { overviewRead } from '../../src/server/overview';
import { createSubjectCase } from '../../src/server/subject-case';

let client:pg.Client;
const users = [1,2,3,4,5].map(n=>`80000000-0000-0000-0000-${String(n).padStart(12,'0')}`);
const cookies:string[]=[];
const privateCaseId='80000000-0000-0000-0000-000000000102';
const privateCaseRef='PRIVATE-CASE-B';
const forbidden=['PRIVATE CUSTOMER NAME','private_customer@synthetic.invalid','PRIVATE_PHONE','PRIVATE_ACCOUNT_NUMBER_1234',
  'PRIVATE_PAYMENT_TOKEN','PRIVATE_CASE_REASON','PRIVATE_RESOLUTION_NOTES',privateCaseRef,'e'.repeat(64),
  'password_hash','"token"','is_suspicious','scenario_code','scenario_id','date_of_birth','resolution_notes','actor_user_id'];

async function request(params:Record<string,string>={},who=0) {
  return collection(new Request('http://localhost/api/v1/transactions?'+new URLSearchParams(params),{headers:{cookie:cookies[who]}}));
}
async function subject(transactionId:string,who=0,search='') {
  return detail(new Request(`http://localhost/api/v1/transactions/${transactionId}${search}`,{headers:{cookie:cookies[who]}}),{params:Promise.resolve({id:transactionId})});
}
function noLeak(value:unknown,includePrivateCase=true) {
  const json=JSON.stringify(value);
  for(const marker of forbidden) if(includePrivateCase || marker!==privateCaseRef) expect(json).not.toContain(marker);
  expect(json).not.toContain('_cursor_key');
}

beforeAll(async()=>{
  client=new pg.Client({connectionString:requireTestDatabase()}); await client.connect();
  await applyMigrations(client,new URL('../../migrations/',import.meta.url)); await seedFinancial(client);
  for(let n=0;n<users.length;n++) {
    await client.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role,is_active)
      VALUES ($1,$2,$3,'Synthetic API actor',$4,$5)`,[users[n],`api_actor_${n}@synthetic.invalid`,n===4?null:'PASSWORD_HASH_SENTINEL',n===2?'admin':n===4?'system':'analyst',n!==3]);
    const session=await createSession(users[n],client);
    cookies.push(`${SESSION_COOKIE_NAME}=${await encodeSessionToken(users[n],session.sessionId)}`);
  }
  await client.query("UPDATE public.customer SET full_name='PRIVATE CUSTOMER NAME',email='private_customer@synthetic.invalid',phone='PRIVATE_PHONE',date_of_birth='1990-01-01'");
  await client.query("UPDATE public.account SET account_number='PRIVATE_ACCOUNT_NUMBER_1234' WHERE account_id=$1",[id(10)]);
  await client.query("UPDATE public.payment_method SET token='PRIVATE_PAYMENT_TOKEN',last4='4242'");
  await client.query("UPDATE public.device_fingerprint SET device_hash=$1",['e'.repeat(64)]);
  await executeCaseCommand(client,{commandType:'create',actorUserId:users[0],idempotencyKey:'80000000-0000-0000-0000-000000000201',transactionId:id(105),priority:'high',reason:'PRIVATE_CASE_REASON',caseRef:'OWN-CASE-A'});
  await executeCaseCommand(client,{commandType:'create',actorUserId:users[1],idempotencyKey:'80000000-0000-0000-0000-000000000202',caseId:privateCaseId,transactionId:id(106),priority:'high',reason:'PRIVATE_CASE_REASON',caseRef:privateCaseRef});
  await client.query(`INSERT INTO public.investigation_case(case_id,case_ref,transaction_id,priority)
    VALUES ('80000000-0000-0000-0000-000000000103','UNASSIGNED-CASE',$1,'low')`,[id(104)]);
  await client.query(`INSERT INTO public.investigation_case(case_id,case_ref,transaction_id,priority,status,resolution_code,resolution_notes,closed_at)
    VALUES ('80000000-0000-0000-0000-000000000104','TERMINAL-PRIVATE',$1,'low','dismissed','false_positive','PRIVATE_RESOLUTION_NOTES',clock_timestamp())`,[id(100)]);
});
afterAll(async()=>{
  if(client){await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');await client.end();await getPool().end();}
});

test('requires active human authentication and uses a stable no-store error envelope',async()=>{
  const anonymous=await collection(new Request('http://localhost/api/v1/transactions'));
  expect(anonymous.status).toBe(401); const error=await anonymous.json();
  expect(error.error.code).toBe('unauthenticated'); expect(error.request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(anonymous.headers.get('cache-control')).toContain('no-store');
  for(const who of [3,4]) expect((await request({},who)).status).toBe(401);
  const session=await createSession(users[0],client); await revokeSession(session.sessionId,'sign_out',client);
  const revoked=await collection(new Request('http://localhost/api/v1/transactions',{headers:{cookie:`${SESSION_COOKIE_NAME}=${await encodeSessionToken(users[0],session.sessionId)}`}}));
  expect(revoked.status).toBe(401);
});

test('overview isolates assigned work, admin sees active team work, and no private reasons leak',async()=>{
  const read=(who=0,query='')=>overviewRead(new Request('http://localhost/api/v1/overview'+query,{headers:{cookie:cookies[who]}}));
  expect((await overviewRead(new Request('http://localhost/api/v1/overview'))).status).toBe(401);
  const own=await read();expect(own.headers.get('cache-control')).toContain('no-store');
  const body=await own.json();expect(body.data.map((r:{case_ref:string})=>r.case_ref)).toEqual(['OWN-CASE-A']);
  expect(body.data[0].owner_label).toBeNull();noLeak(body);
  expect(body.data[0]).toMatchObject({amount:'12000.00',amount_base:'12000.00',currency_code:'INR'});
  const team=await (await read(2)).json();expect(team.data).toHaveLength(3);expect(team.data.some((r:{case_ref:string})=>r.case_ref==='TERMINAL-PRIVATE')).toBe(false);
  expect(JSON.stringify(team)).not.toContain('PRIVATE_CASE_REASON');
  expect(team.data.find((row:{transaction_id:string})=>row.transaction_id===id(106)))
    .toMatchObject({amount:'125.00',amount_base:'10000.00',currency_code:'USD'});
  expect((await read(0,'?scope=all')).status).toBe(400);
});

test('subject creation authenticates and binds actor, preserves idempotency, and rejects duplicate subjects',async()=>{
  const req=(who=0,origin='http://localhost')=>new Request('http://localhost/actions/create',{method:'POST',headers:{origin,cookie:cookies[who]}});
  const input={transactionId:id(101),idempotencyKey:'80000000-0000-0000-0000-000000000909',priority:'medium',reason:'Synthetic UI creation'};
  expect(await createSubjectCase(new Request('http://localhost/actions/create',{headers:{origin:'http://localhost'}}),input)).toMatchObject({ok:false,status:401});
  expect(await createSubjectCase(req(0,'https://unrelated.invalid'),input)).toMatchObject({ok:false,status:403});
  expect(await createSubjectCase(req(2),input)).toMatchObject({ok:false,status:403});
  expect(await createSubjectCase(req(),{...input,actorUserId:users[1]})).toMatchObject({ok:false,status:400});
  expect(await createSubjectCase(req(),{...input,reason:'   '})).toMatchObject({ok:false,status:400});
  const saved=await createSubjectCase(req(),input);expect(saved).toMatchObject({ok:true,replayed:false});
  expect(await createSubjectCase(req(),input)).toMatchObject({ok:true,replayed:true});
  expect(await createSubjectCase(req(1),{...input,idempotencyKey:'80000000-0000-0000-0000-000000000910'})).toMatchObject({ok:false,status:409});
  if(saved.ok){const row=(await client.query('SELECT assigned_to_user_id,transaction_id FROM public.investigation_case WHERE case_id=$1',[saved.caseId])).rows[0];expect(row).toEqual({assigned_to_user_id:users[0],transaction_id:id(101)});
  }
});

test('returns SQL-backed masked facts, decimal strings and zero-signal transactions',async()=>{
  const response=await request(); expect(response.status).toBe(200);
  const body=await response.json(); expect(body.data).toHaveLength(8); expect(body.page_size).toBe(25); expect(body.next_cursor).toBeNull(); noLeak(body);
  for(const [n,scenario] of scenarios.entries()) {
    const response=await subject(id(100+n)); expect(response.status).toBe(200); const data=(await response.json()).data;
    expect(data.amount).toBe(scenario.amount); expect(data.amount_base).toBe(scenario.base);
    expect(data.exchange_rate).toBe(scenario.rate); expect(data.risk_score).toBe(scenario.score); expect(data.signal_count).toBe(scenario.count);
    expect(data.risk_band).toBe(scenario.band); expect(data.signals).toHaveLength(scenario.count);
    expect(data.configuration_label).toContain('current'); expect(data.coverage).toContain('unevaluated'); noLeak(data);
    if(!scenario.count) expect(data.signal_summary).toBe('No recorded signals');
    else expect(data.signals.reduce((sum:bigint,signal:{score_contribution:string})=>sum+BigInt(signal.score_contribution),0n).toString()).toBe(data.risk_score);
  }
  const data=(await (await subject(id(105))).json()).data;
  expect(data.account.number_masked).toBe('****1234'); expect(data.customer.display_label).toContain('Customer');
  expect(data.payment_method.last4).toBe('4242'); expect(data.device.os_family).toBe('synthetic');
});

test('scopes active-case details to the owner/admin and hides all private case metadata',async()=>{
  const own=(await (await subject(id(105))).json()).data.active_case;
  expect(own).toMatchObject({exists:true,access:'permitted',case_ref:'OWN-CASE-A'});
  expect((await (await subject(id(106))).json()).data.active_case).toEqual({exists:true,access:'restricted'});
  expect((await (await subject(id(104))).json()).data.active_case).toEqual({exists:true,access:'restricted'});
  expect((await (await subject(id(100))).json()).data.active_case).toEqual({exists:false,access:'none'});
  expect((await (await subject(id(106),1)).json()).data.active_case).toMatchObject({case_id:privateCaseId,case_ref:privateCaseRef});
  const admin=(await (await subject(id(106),2)).json()).data;
  expect(admin.active_case).toMatchObject({access:'permitted',case_id:privateCaseId}); noLeak(admin,false);
  const list=(await (await request()).json()).data;
  expect(list.find((r:{transaction_id:string})=>r.transaction_id===id(106)).active_case).toEqual({exists:true,access:'restricted'});
});

test('executes the same masked SQL under provisioned nonowner runtime privileges',async()=>{
  await client.query("CALL public.grant_runtime_privileges('finsight_auth_probe'::regrole)");
  await client.query("CALL public.grant_auth_privileges('finsight_auth_probe'::regrole)");
  const runtime=new pg.Client({connectionString:requireTestDatabase()}); await runtime.connect();
  try {
    await runtime.query('SET ROLE finsight_auth_probe');
    expect((await runtime.query("SELECT has_table_privilege(current_user,'public.transaction','UPDATE') AS may_write")).rows[0].may_write).toBe(false);
    const actor={userId:users[0],role:'analyst' as const};
    const rows=await listTransactions(runtime,{limit:2},actor);
    expect(rows).toHaveLength(2);
    const data=await transactionRiskDetail(runtime,id(106),actor);
    expect(data?.active_case).toEqual({exists:true,access:'restricted'}); noLeak(data);
  } finally { await runtime.end(); }
});

test('composes exact-ID, FTS, date, status, risk and original/base amount filters',async()=>{
  const ids=async(params:Record<string,string>)=>(await (await request(params)).json()).data.map((r:{transaction_id:string})=>r.transaction_id).sort();
  expect(await ids({q:id(105).toUpperCase()})).toEqual([id(105)]);
  expect(await ids({transaction_id:id(106)})).toEqual([id(106)]);
  expect(await ids({q:'USD'})).toEqual([id(101),id(106),id(107)]);
  expect(await ids({q:"') OR true --"})).toEqual([]);
  expect(await ids({account_id:id(10),merchant_id:id(32),device_id:id(40),status:'posted',risk:'high'})).toEqual([id(105)]);
  expect(await ids({from:'2026-01-01T00:05:00Z',to:'2026-01-01T00:06:00Z'})).toEqual([id(105)]);
  expect(await ids({currency:'INR',amount_min:'10000',amount_max:'12000'})).toEqual([id(103),id(105)]);
  expect(await ids({currency:'USD',amount_min:'125',amount_max:'125'})).toEqual([id(106),id(107)]);
  expect(await ids({amount_mode:'base',amount_min:'10000'})).toEqual([id(103),id(105),id(106),id(107)]);
  const empty=await request({risk:'critical'}); expect(empty.status).toBe(200); expect((await empty.json()).data).toEqual([]);
});

test('returns validated 400/404/503 errors without leaking database details',async()=>{
  const invalid:Record<string,string>[]=[{sort:'injection;DROP TABLE public.transaction'}, {amount_min:'5'}, {from:'2026-02-30T00:00:00Z'},{page_size:'101'},{cursor:'garbage'},{unknown:'private'}];
  for(const params of invalid) {
    const response=await request(params); expect(response.status).toBe(400); const body=await response.json();
    expect(body.error.code).toBe('invalid_request'); expect(body.error.fields).toBeTruthy(); noLeak(body);
  }
  expect((await subject('bad-id')).status).toBe(400);
  expect((await subject(id(999))).status).toBe(404);
  expect((await subject(id(105),0,'?include=private')).status).toBe(400);
  const spy=vi.spyOn(getPool(),'query').mockRejectedValueOnce(new Error('PRIVATE_DATABASE_PASSWORD_AND_SQL'));
  try { const response=await request(); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_DATABASE_PASSWORD_AND_SQL'); }
  finally { spy.mockRestore(); }
});

test('rejects cursor tampering and reuse under another actor, role, filter or sort',async()=>{
  const base={page_size:'2',status:'posted'};
  const first=await (await request(base)).json(); expect(first.data).toHaveLength(2); expect(first.next_cursor).toBeTruthy();
  const params={...base,cursor:first.next_cursor};
  expect((await request(params)).status).toBe(200);
  for(const who of [1,2]) expect((await request(params,who)).status).toBe(400);
  const changes:Record<string,string>[]=[{sort:'risk_score'},{status:'pending'},{page_size:'3'},{order:'asc'}];
  for(const change of changes) expect((await request({...params,...change})).status).toBe(400);
  expect((await request({...params,cursor:'a'+first.next_cursor.slice(1)})).status).toBe(400);
  await client.query("UPDATE public.app_user SET role='admin' WHERE user_id=$1",[users[0]]);
  try { expect((await request(params)).status).toBe(400); }
  finally { await client.query("UPDATE public.app_user SET role='analyst' WHERE user_id=$1",[users[0]]); }
});

test('pages tied timestamps and all allowed orders without losing or duplicating rows',async()=>{
  await client.query(`INSERT INTO public.transaction(transaction_id,account_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,occurred_at,merchant_country_code,description)
    SELECT x.id,account_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,occurred_at+interval '1 microsecond',merchant_country_code,description
    FROM public.transaction CROSS JOIN (VALUES ('81000000-0000-0000-0000-000000000050'::uuid),('81000000-0000-0000-0000-000000000051'::uuid)) x(id) WHERE transaction_id=$1`,[id(105)]);
  for(const sort of ['occurred_at','amount','risk_score','status']) for(const order of ['asc','desc']) {
    const parameters:Record<string,string>={page_size:'2',sort,order,status:'posted'};
    if(sort==='amount') parameters.amount_mode='base';
    const actual:string[]=[];
    for(let n=0;n<10;n++) {
      const response=await request(parameters); expect(response.status).toBe(200); const body=await response.json(); noLeak(body);
      actual.push(...body.data.map((row:{transaction_id:string})=>row.transaction_id));
      if(!body.next_cursor) break; parameters.cursor=body.next_cursor;
    }
    const expression={occurred_at:'t.occurred_at',amount:'t.amount_base',risk_score:'r.risk_score',status:'t.status'}[sort];
    const expected=(await client.query(`SELECT t.transaction_id FROM public.transaction t JOIN public.v_transaction_risk r USING(transaction_id) WHERE t.status='posted' ORDER BY ${expression} ${order},t.transaction_id ${order}`)).rows.map(r=>r.transaction_id);
    expect(actual).toEqual(expected); expect(new Set(actual).size).toBe(10);
  }
});

test('bounds pages at 100 and supports non-posted status rows without inventing signals',async()=>{
  await client.query(`INSERT INTO public.transaction(transaction_id,account_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,occurred_at,merchant_country_code,description)
    SELECT ('82000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,account_id,merchant_id,device_id,1,currency_code,exchange_rate,direction,txn_type,
      CASE n WHEN 1 THEN 'pending' WHEN 2 THEN 'blocked' WHEN 3 THEN 'reversed' ELSE 'posted' END,
      '2026-01-02T00:00:00Z',merchant_country_code,'Synthetic bounded page fixture'
    FROM public.transaction CROSS JOIN generate_series(1,105) n WHERE transaction_id=$1`,[id(100)]);
  const first=await (await request({page_size:'100'})).json(); expect(first.data).toHaveLength(100); expect(first.next_cursor).toBeTruthy();
  const second=await (await request({page_size:'100',cursor:first.next_cursor})).json(); expect(second.data).toHaveLength(15); expect(second.next_cursor).toBeNull();
  for(const status of ['pending','blocked','reversed']) {
    const rows=(await (await request({status})).json()).data; expect(rows).toHaveLength(1); expect(rows[0].signal_count).toBe(0);
  }
});

test('keeps recorded explanations readable when current rule configuration is inactive',async()=>{
  const rule='83000000-0000-0000-0000-000000000001';
  await client.query(`INSERT INTO public.risk_rule(rule_id,rule_code,rule_name,dimension,weight,threshold_value,is_active)
    VALUES ($1,'INACTIVE_PROBE','Synthetic inactive rule','amount',1,1,false)`,[rule]);
  await client.query(`INSERT INTO public.risk_signal(signal_id,transaction_id,rule_id,observed_value,score_contribution,evidence)
    VALUES (gen_random_uuid(),$1,$2,500,1,'Stored synthetic signal from a now-inactive rule')`,[id(100),rule]);
  const data=(await (await subject(id(100))).json()).data;
  expect(data.risk_score).toBe('1'); expect(data.signal_count).toBe(1); expect(data.signals[0].current_rule_active).toBe(false);
});
