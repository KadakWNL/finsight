import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getAuthSecret, isSameOriginRequest, sessionCookieName, sessionCookieOptions } from '../../src/server/auth-security';
import { createLoginLimiter } from '../../src/server/login-limit';
import { getDatabaseUrl } from '../../src/server/db';

test('requires a configured secret in production and uses a host-only secure cookie', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('AUTH_SECRET', undefined); vi.stubEnv('NEXTAUTH_SECRET', undefined);
  try {
    expect(() => getAuthSecret()).toThrow('Set AUTH_SECRET');
    vi.stubEnv('AUTH_SECRET', 'short'); expect(() => getAuthSecret()).toThrow();
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(64)); expect(getAuthSecret()).toBe('a'.repeat(64));
    expect(sessionCookieName()).toBe('__Host-next-auth.session-token');
    expect(sessionCookieOptions()).toEqual({ secure: true, httpOnly: true, sameSite: 'lax', path: '/' });
  } finally { vi.unstubAllEnvs(); }
});

test('rejects missing, null and foreign origins including explicit cross-site requests', () => {
  for (const origin of [undefined, 'null', 'https://unrelated.invalid']) {
    const request = new Request('http://localhost:3000/api/auth/login', { headers: origin ? { origin } : {} });
    expect(isSameOriginRequest(request)).toBe(false);
  }
  expect(isSameOriginRequest(new Request('http://localhost:3000/api/auth/login', { headers: { origin: 'http://localhost:3000' } }))).toBe(true);
  expect(isSameOriginRequest(new Request('http://localhost:3000/api/auth/login', { headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' } }))).toBe(false);
});

test('bounds per-account attempts and a global process budget with expiry', () => {
  const limit = createLoginLimiter();
  for (let n = 0; n < 5; n++) expect(limit(' Analyst@synthetic.invalid ', 0)).toBe(true);
  expect(limit('analyst@synthetic.invalid', 0)).toBe(false);
  expect(limit('analyst@synthetic.invalid', 15 * 60_000)).toBe(true);
  const globalLimit = createLoginLimiter();
  for (let n = 0; n < 100; n++) expect(globalLimit(`synthetic-${n}`, 0)).toBe(true);
  expect(globalLimit('another-synthetic', 0)).toBe(false);
  expect(globalLimit('another-synthetic', 60_000)).toBe(true);
});

test('application connections never switch to the test owner outside tests', () => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('ALLOW_TEST_DATABASE', 'true');
  vi.stubEnv('DATABASE_URL', 'postgresql://runtime@localhost/finsight_demo');
  vi.stubEnv('TEST_DATABASE_URL', 'postgresql://owner@localhost/finsight_test');
  try { expect(getDatabaseUrl()).toBe('postgresql://runtime@localhost/finsight_demo'); }
  finally { vi.unstubAllEnvs(); }
});
