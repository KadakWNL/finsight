import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';
import { seedFinancial, syntheticId } from '../../scripts/financial-seed.mjs';

const userId='70000000-0000-0000-0000-000000000001';
const email='http_auth@synthetic.invalid';
const password=randomBytes(24).toString('hex');
const origin='http://127.0.0.1:3100';
let client:pg.Client;

test.beforeAll(async()=>{
  client=new pg.Client({connectionString:requireTestDatabase()}); await client.connect();
  await applyMigrations(client,new URL('../../migrations/',import.meta.url));
  const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  await client.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role)
    VALUES ($1,$2,$3,'Synthetic HTTP analyst','analyst')`,[userId,email,hash]);
  await seedFinancial(client);
  await client.query("UPDATE public.customer SET full_name='HTTP_PRIVATE_CUSTOMER',email='http_private@synthetic.invalid'");
  await client.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role)
    VALUES ('70000000-0000-0000-0000-000000000002','http_peer@synthetic.invalid','synthetic-noncredential','Synthetic peer','analyst')`);
  await client.query(`SELECT * FROM public.execute_case_command('create','70000000-0000-0000-0000-000000000002',
    gen_random_uuid(),repeat('c',64),NULL,NULL,$1,'low','HTTP_PRIVATE_REASON',NULL,NULL,'HTTP_PRIVATE_CASE')`,[syntheticId(106)]);
});
test.afterAll(async()=>{
  if(client){await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await client.end();}
});

test('Auth.js login protects transaction reads and shares sign-out with JSON endpoints',async({request,playwright})=>{
  const csrf=await (await request.get('/api/auth/csrf')).json();
  expect(csrf.csrfToken).toBeTruthy();
  const signedIn=await request.post('/api/auth/callback/credentials',{
    headers:{origin}, form:{csrfToken:csrf.csrfToken,email,password,json:'true',callbackUrl:origin},
  });
  expect(signedIn.ok()).toBe(true); expect((await signedIn.json()).url).not.toContain('error');
  const sessionResponse=await request.get('/api/auth/session');
  expect(sessionResponse.status()).toBe(200);
  const session=await sessionResponse.json(); expect(session.user.userId).toBe(userId);
  expect(session.user.role).toBe('analyst'); expect(session.expires).toBeTruthy();
  expect(JSON.stringify(session)).not.toContain('sessionId'); expect(JSON.stringify(session)).not.toContain('sid');
  const state=await request.storageState();
  const cookie=state.cookies.find(c=>c.name==='next-auth.session-token');
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.sameSite).toBe('Lax');
  const staleCookie=`next-auth.session-token=${cookie!.value}`;
  const anonymous=await playwright.request.newContext({baseURL:origin});
  try { expect((await anonymous.get('/api/v1/transactions')).status()).toBe(401); }
  finally { await anonymous.dispose(); }
  const parameters={page_size:'2',status:'posted'};
  const list=await request.get('/api/v1/transactions?'+new URLSearchParams(parameters));
  expect(list.status()).toBe(200); expect(list.headers()['cache-control']).toContain('no-store');
  const first=await list.json(); expect(first.data).toHaveLength(2); expect(first.next_cursor).toBeTruthy();
  const next=await request.get('/api/v1/transactions?'+new URLSearchParams({...parameters,cursor:first.next_cursor}));
  const second=await next.json(); expect(new Set([...first.data,...second.data].map((r:{transaction_id:string})=>r.transaction_id)).size).toBe(4);
  const risk=(await (await request.get('/api/v1/transactions/'+syntheticId(106))).json()).data;
  expect(risk.risk_score).toBe('65'); expect(risk.amount).toBe('125.00'); expect(risk.amount_base).toBe('10000.00');
  expect(risk.active_case).toEqual({exists:true,access:'restricted'});
  for(const marker of ['HTTP_PRIVATE_CUSTOMER','http_private@synthetic.invalid','HTTP_PRIVATE_CASE','HTTP_PRIVATE_REASON','is_suspicious','password_hash']) {
    expect(JSON.stringify(risk)).not.toContain(marker);
  }
  expect((await request.get('/api/v1/transactions?page_size=101')).status()).toBe(400);
  expect((await request.get('/api/v1/transactions/not-a-uuid')).status()).toBe(400);
  expect((await request.get('/api/v1/transactions/'+syntheticId(999))).status()).toBe(404);
  expect((await request.post('/api/v1/transactions',{data:{amount:'1.00'}})).status()).toBe(405);
  expect((await request.delete('/api/v1/transactions/'+syntheticId(100))).status()).toBe(405);
  expect((await client.query('SELECT count(*)::int AS n FROM public.transaction')).rows[0].n).toBe(8);
  await client.query("UPDATE public.app_user SET role='admin' WHERE user_id=$1",[userId]);
  expect((await (await request.get('/api/auth/session')).json()).user.role).toBe('admin');
  expect((await request.get('/api/v1/transactions?'+new URLSearchParams({...parameters,cursor:first.next_cursor}))).status()).toBe(400);
  expect((await (await request.get('/api/v1/transactions/'+syntheticId(106))).json()).data.active_case).toMatchObject({access:'permitted',case_ref:'HTTP_PRIVATE_CASE'});
  await client.query('UPDATE public.app_user SET is_active=false WHERE user_id=$1',[userId]);
  expect((await request.get('/api/auth/session')).status()).toBe(401);
  expect((await request.get('/api/v1/transactions')).status()).toBe(401);
  await client.query("UPDATE public.app_user SET is_active=true,role='analyst' WHERE user_id=$1",[userId]);
  expect((await request.post('/api/auth/logout',{headers:{origin:'https://unrelated.invalid'}})).status()).toBe(403);
  expect((await request.get('/api/auth/session')).status()).toBe(200);
  expect((await request.post('/api/auth/logout',{headers:{origin}})).status()).toBe(200);
  expect((await request.get('/api/auth/session',{headers:{cookie:staleCookie}})).status()).toBe(401);
  expect((await request.get('/api/v1/transactions',{headers:{cookie:staleCookie}})).status()).toBe(401);

  expect((await request.post('/api/auth/login',{headers:{origin},data:{email,password}})).status()).toBe(200);
  expect((await request.get('/api/auth/session')).status()).toBe(200);
  const signoutCsrf=await (await request.get('/api/auth/csrf')).json();
  expect((await request.post('/api/auth/signout',{headers:{origin},form:{csrfToken:signoutCsrf.csrfToken,json:'true'}})).ok()).toBe(true);
  expect((await request.get('/api/auth/session')).status()).toBe(401);
  const throttleCsrf=await (await request.get('/api/auth/csrf')).json();
  for(let n=0;n<5;n++) {
    await request.post('/api/auth/callback/credentials',{headers:{origin},form:{csrfToken:throttleCsrf.csrfToken,email,password:'incorrect',json:'true'}});
  }
  expect((await request.post('/api/auth/login',{headers:{origin},data:{email,password}})).status()).toBe(401);
});
