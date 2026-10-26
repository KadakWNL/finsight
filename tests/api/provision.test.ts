import { beforeAll, afterAll, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';
import { applyMigrations } from '../../scripts/migration-runner.mjs';

const execute=promisify(execFile);
let client:pg.Client;
beforeAll(async()=>{
  client=new pg.Client({connectionString:requireTestDatabase()}); await client.connect();
  await applyMigrations(client,new URL('../../migrations/',import.meta.url));
});
afterAll(async()=>{
  if(client){await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');await client.end();}
});

test('bootstrap and demo CLIs preserve identities on retries and keep credentials out of output',async()=>{
  const password=randomBytes(24).toString('hex');
  const env={...process.env,MIGRATOR_DATABASE_URL:requireTestDatabase(),ALLOW_SYNTHETIC_SEED:'true',
    BOOTSTRAP_ADMIN_PASSWORD:password,DEMO_ANALYST_PASSWORD:password,DEMO_ADMIN_PASSWORD:password};
  const run=(mode:string,extras:Record<string,string>={})=>execute(process.execPath,['scripts/provision-identities.mjs',mode],{env:{...env,...extras}});
  const results=await Promise.all([
    run('--bootstrap-admin',{BOOTSTRAP_ADMIN_EMAIL:'bootstrap_a@synthetic.invalid'}),
    run('--bootstrap-admin',{BOOTSTRAP_ADMIN_EMAIL:'bootstrap_b@synthetic.invalid'}),
  ]);
  for(const result of results) expect(result.stdout+result.stderr).not.toContain(password);
  expect((await client.query("SELECT count(*)::int AS n FROM public.app_user WHERE role='admin'")).rows[0].n).toBe(1);
  await run('--demo');
  await client.query("UPDATE public.app_user SET is_active=false WHERE email='analyst_a@finsight.local'");
  const before=(await client.query('SELECT * FROM public.app_user ORDER BY user_id')).rows;
  expect(before).toHaveLength(6);
  await run('--demo',{DEMO_ADMIN_PASSWORD:randomBytes(24).toString('hex')});
  await run('--bootstrap-admin',{BOOTSTRAP_ADMIN_EMAIL:'bootstrap_c@synthetic.invalid'});
  expect((await client.query('SELECT * FROM public.app_user ORDER BY user_id')).rows).toEqual(before);
},15000);
