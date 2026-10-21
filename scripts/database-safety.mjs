/** @param {Record<string, string | undefined>} env */
export function requireTestDatabase(env = process.env) {
  if (env.ALLOW_TEST_DATABASE !== 'true' || !env.TEST_DATABASE_URL) {
    throw new Error('Set TEST_DATABASE_URL and ALLOW_TEST_DATABASE=true for an isolated local test database.');
  }
  const url = new URL(env.TEST_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !/^[a-z][a-z0-9_]*_test$/.test(url.pathname.slice(1))
      || url.search || url.hash) {
    throw new Error('Tests require a local PostgreSQL URL with a database name ending in _test and no URL options.');
  }
  return env.TEST_DATABASE_URL;
}
