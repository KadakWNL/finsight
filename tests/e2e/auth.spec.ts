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
const uiId='70000000-0000-0000-0000-000000000014';
const uiEmail='ui_analyst@synthetic.invalid';
const adminId='70000000-0000-0000-0000-000000000015';
const origin='http://127.0.0.1:3100';
let client:pg.Client;

test.beforeAll(async()=>{
  client=new pg.Client({connectionString:requireTestDatabase()}); await client.connect();
  await applyMigrations(client,new URL('../../migrations/',import.meta.url));
  const hash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  await client.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role)
    VALUES ($1,$2,$3,'Synthetic HTTP analyst','analyst')`,[userId,email,hash]);
  await client.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role)
    VALUES ($1,$2,$3,'Synthetic UI analyst','analyst'),($4,'ui_admin@synthetic.invalid',$3,'Synthetic UI admin','admin')`,[uiId,uiEmail,hash,adminId]);
  await seedFinancial(client);
  await client.query("UPDATE public.customer SET full_name='HTTP_PRIVATE_CUSTOMER',email='http_private@synthetic.invalid'");
  await client.query(`INSERT INTO public.app_user(user_id,email,password_hash,display_name,role)
    VALUES ('70000000-0000-0000-0000-000000000002','http_peer@synthetic.invalid','synthetic-noncredential','Synthetic peer','analyst')`);
  await client.query(`SELECT * FROM public.execute_case_command('create','70000000-0000-0000-0000-000000000002',
    gen_random_uuid(),repeat('c',64),NULL,NULL,$1,'low','HTTP_PRIVATE_REASON',NULL,NULL,'HTTP_PRIVATE_CASE')`,[syntheticId(106)]);
});

test('discovery UI uses real database reads, safe deep links, filters, evidence and guarded creation',async({page})=>{
  test.setTimeout(90000);
  await page.goto('/transactions?risk=high&page_size=2');
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.screenshot({path:'test-results/ui-sign-in-desktop.png',fullPage:true,caret:'initial'});
  await page.getByLabel('Email address').fill(uiEmail);await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Transactions',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:/View transaction/})).toHaveCount(2);
  await page.screenshot({path:'test-results/ui-explorer-desktop.png',fullPage:true,caret:'initial'});
  await page.goto('/transactions?page_size=2');
  await expect(page.getByRole('link',{name:/View transaction/})).toHaveCount(2);
  const first=await page.getByRole('link',{name:/View transaction/}).first().getAttribute('href');
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page).toHaveURL(/cursor=/);
  await expect.poll(()=>page.getByRole('link',{name:/View transaction/}).first().getAttribute('href')).not.toBe(first);
  await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(page).not.toHaveURL(/cursor=/);
  await page.getByLabel('Description or exact transaction ID').fill('missingwordnosynthetic');
  await page.getByRole('button',{name:'Apply filters'}).click();await expect(page.getByRole('heading',{name:'No transactions match these filters'})).toBeVisible();
  await page.getByRole('button',{name:'Reset filters'}).click();await expect(page.getByRole('link',{name:/View transaction/})).toHaveCount(8);
  await page.goto('/transactions?amount_min=1');await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Minimum amount')).toHaveValue('1');
  await page.getByLabel('Original currency').selectOption('INR');await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.getByRole('link',{name:/View transaction/})).toHaveCount(5);
  await page.goto('/transactions/'+syntheticId(106));
  await expect(page.getByRole('heading',{name:'Risk evidence'})).toBeVisible();
  await page.getByLabel('Show full transaction ID',{exact:true}).click();
  await expect(page.getByLabel('Full transaction ID',{exact:true})).toHaveValue(syntheticId(106));
  await page.getByLabel('Show full transaction ID',{exact:true}).click();
  await page.getByLabel('Show full account ID',{exact:true}).click();
  await expect(page.getByLabel('Full account ID',{exact:true})).toHaveValue(syntheticId(11));
  await page.getByLabel('Show full account ID',{exact:true}).click();
  await page.getByLabel('Show full device ID',{exact:true}).click();
  await expect(page.getByLabel('Full device ID',{exact:true})).toHaveValue(syntheticId(40));
  await page.getByLabel('Show full device ID',{exact:true}).click();
  await expect(page.getByText('65 points · 2 signals',{exact:true})).toBeVisible();
  await expect(page.getByText('USD 125.00',{exact:true})).toBeVisible();
  await expect(page.getByText('An active case exists. Its details are restricted.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Create case',exact:true})).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('HTTP_PRIVATE_');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/ui-detail-desktop.png',fullPage:true,caret:'initial'});
  await page.goto('/transactions/'+syntheticId(100));
  await expect(page.getByRole('heading',{name:'No recorded signals'})).toBeVisible();
  await page.getByRole('button',{name:'Create case',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('Reason',{exact:true}).fill('Synthetic preserved draft');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Create case',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.getByLabel('Reason',{exact:true})).toHaveValue('Synthetic preserved draft');
  await client.query("UPDATE public.app_session SET revoked_at=clock_timestamp(),revocation_reason='sign_out' WHERE user_id=$1 AND revoked_at IS NULL",[uiId]);
  await page.getByRole('button',{name:'Save case',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Your session ended');
  await expect(page.getByLabel('Reason',{exact:true})).toHaveValue('Synthetic preserved draft');
  const recovery=await page.context().newPage();await recovery.goto('/sign-in');
  await recovery.getByLabel('Email address').fill(uiEmail);await recovery.getByLabel('Password',{exact:true}).fill(password);await recovery.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(recovery.getByRole('heading',{name:'Your overview'})).toBeVisible();await recovery.close();
  await page.getByRole('button',{name:'Save case',exact:true}).click();await expect(page.getByText('Case created and assigned to you. Its reference appears under Investigation.')).toBeVisible();
  await expect(page.getByText(/Active case CASE-/)).toBeVisible();
  const cases=await client.query('SELECT assigned_to_user_id FROM public.investigation_case WHERE transaction_id=$1',[syntheticId(100)]);expect(cases.rows).toEqual([{assigned_to_user_id:uiId}]);
  await page.goto('/transactions/'+syntheticId(999));await expect(page.getByRole('heading',{name:'Transaction not found'})).toBeVisible();
  await page.goto('/admin');await expect(page.getByRole('heading',{name:'Access is restricted'})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.goto('/transactions');
  await expect(page.getByRole('link',{name:/View transaction/})).toHaveCount(8);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/ui-explorer-mobile.png',fullPage:true,caret:'initial'});
  await page.getByText('Menu',{exact:true}).click();await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('link',{name:'Overview'}).click();
  await expect(page.getByRole('heading',{name:'Your overview'})).toBeVisible();
  await page.getByRole('button',{name:'Sign out'}).click();await expect(page.getByRole('heading',{name:'Sign in to FinSight'})).toBeVisible();
  await page.screenshot({path:'test-results/ui-sign-in-mobile.png',fullPage:true,caret:'initial'});
});

test('admin UI lands on team oversight without analyst creation or unavailable navigation',async({page})=>{
  await page.goto('/sign-in');await page.getByLabel('Email address').fill('ui_admin@synthetic.invalid');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Team overview'})).toBeVisible();
  await page.goto('/transactions/'+syntheticId(105));await expect(page.getByRole('heading',{name:'Risk evidence'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create case',exact:true})).toHaveCount(0);
  await expect(page.getByText('An analyst can create a case for this transaction.')).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link')).toHaveCount(2);
});

test('UI failures retain filters and stale labels; duplicate case recheck preserves the draft',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/sign-in');await page.getByLabel('Email address').fill(uiEmail);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your overview'})).toBeVisible();
  await page.goto('/transactions?risk=high');await expect(page.getByRole('link',{name:/View transaction/})).toHaveCount(2);
  // Fault injection is confined to error-state checks; normal reads above use PostgreSQL.
  await page.route('**/api/v1/transactions?*',route=>route.fulfill({status:503,json:{error:{message:'Temporarily unavailable'}}}));
  await page.getByLabel('Risk band').selectOption('low');await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.getByText('Previous results shown. The latest request did not succeed.')).toBeVisible();
  await expect(page.getByLabel('Risk band')).toHaveValue('low');await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await page.unroute('**/api/v1/transactions?*');await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByRole('link',{name:/View transaction/})).toHaveCount(4);
  await page.route('**/api/v1/transactions?*',route=>route.fulfill({status:401,json:{error:{message:'Sign in'}}}));
  await page.getByLabel('Risk band').selectOption('medium');await page.getByRole('button',{name:'Apply filters'}).click();
  await expect(page.getByRole('heading',{name:'Your session ended'})).toBeVisible();await expect(page.getByRole('link',{name:'Sign in again',exact:true})).toHaveAttribute('href',/next=%2Ftransactions%3F/);
  await expect(page.getByRole('link',{name:/View transaction/})).toHaveCount(0);await page.unroute('**/api/v1/transactions?*');
  await page.route('**/api/v1/transactions/'+syntheticId(104),route=>route.fulfill({status:403,json:{error:{message:'Restricted'}}}));
  await page.goto('/transactions/'+syntheticId(104));await expect(page.getByRole('heading',{name:'Access is restricted'})).toBeVisible();await page.unroute('**/api/v1/transactions/'+syntheticId(104));
  await page.goto('/transactions/'+syntheticId(104));await page.getByRole('button',{name:'Create case',exact:true}).click();await page.getByLabel('Reason',{exact:true}).fill('Synthetic concurrent draft');
  await client.query(`SELECT * FROM public.execute_case_command('create','70000000-0000-0000-0000-000000000002',gen_random_uuid(),repeat('d',64),NULL,NULL,$1,'low','Synthetic race',NULL,NULL,'PRIVATE_RACE_CASE')`,[syntheticId(104)]);
  await page.getByRole('button',{name:'Save case',exact:true}).click();await page.getByRole('button',{name:'Check existing case'}).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('An active case exists. Its details are restricted.');await expect(page.getByLabel('Reason',{exact:true})).toHaveValue('Synthetic concurrent draft');
  await expect(page.locator('body')).not.toContainText('PRIVATE_RACE_CASE');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/ui-dialog-mobile.png',fullPage:true,caret:'initial'});
  await page.keyboard.press('Escape');await page.screenshot({path:'test-results/ui-detail-mobile.png',fullPage:true,caret:'initial'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test.afterAll(async()=>{
  if(client){await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await client.end();}
});

test('theme follows the system and preserves explicit choices across reloads and routes',async({page})=>{
  await page.emulateMedia({colorScheme:'dark'});await page.goto('/sign-in');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.goto('/');await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await page.goto('/sign-in');await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
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
