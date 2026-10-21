import { expect, test } from 'vitest';
import { requireTestDatabase } from '../../scripts/database-safety.mjs';

test('test tooling rejects shared, remote, ambiguous and unconfirmed targets', () => {
  for (const target of ['postgresql://localhost/finsight', 'postgresql://remote/finsight_test', 'postgresql://localhost/finsight_test?host=remote', 'https://localhost/finsight_test']) {
    expect(() => requireTestDatabase({ ALLOW_TEST_DATABASE: 'true', TEST_DATABASE_URL: target })).toThrow();
  }
  expect(() => requireTestDatabase({ TEST_DATABASE_URL: 'postgresql://localhost/finsight_test' })).toThrow();
  expect(requireTestDatabase({ ALLOW_TEST_DATABASE: 'true', TEST_DATABASE_URL: 'postgresql://localhost/finsight_test' })).toBe('postgresql://localhost/finsight_test');
});
