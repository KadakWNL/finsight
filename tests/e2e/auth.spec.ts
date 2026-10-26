import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import argon2 from 'argon2';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';

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
});
test.afterAll(async()=>{
  if(client){await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await client.end();}
});

test('Auth.js Credentials login shares validation and sign-out with the JSON endpoints',async({request})=>{
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
  await client.query("UPDATE public.app_user SET role='admin' WHERE user_id=$1",[userId]);
  expect((await (await request.get('/api/auth/session')).json()).user.role).toBe('admin');
  await client.query('UPDATE public.app_user SET is_active=false WHERE user_id=$1',[userId]);
  expect((await request.get('/api/auth/session')).status()).toBe(401);
  await client.query("UPDATE public.app_user SET is_active=true,role='analyst' WHERE user_id=$1",[userId]);
  expect((await request.post('/api/auth/logout',{headers:{origin:'https://unrelated.invalid'}})).status()).toBe(403);
  expect((await request.get('/api/auth/session')).status()).toBe(200);
  expect((await request.post('/api/auth/logout',{headers:{origin}})).status()).toBe(200);
  expect((await request.get('/api/auth/session',{headers:{cookie:staleCookie}})).status()).toBe(401);

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
