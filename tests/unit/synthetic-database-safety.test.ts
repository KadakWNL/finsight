import { expect, test } from 'vitest';
import { requireSyntheticDatabase } from '../../scripts/database-safety.mjs';

test('synthetic seed requires explicit local isolated migrator target', () => {
  for (const name of ['finsight_demo', 'finsight_test']) {
    const env = { MIGRATOR_DATABASE_URL: `postgresql://migrator@localhost/${name}`, ALLOW_SYNTHETIC_SEED: 'true' };
    expect(requireSyntheticDatabase(env)).toBe(env.MIGRATOR_DATABASE_URL);
  }
  for (const env of [
    {},
    { MIGRATOR_DATABASE_URL: 'postgresql://migrator@localhost/finsight_demo' },
    { MIGRATOR_DATABASE_URL: 'postgresql://migrator@remote/finsight_demo', ALLOW_SYNTHETIC_SEED: 'true' },
    { MIGRATOR_DATABASE_URL: 'postgresql://migrator@localhost/finsight', ALLOW_SYNTHETIC_SEED: 'true' },
    { MIGRATOR_DATABASE_URL: 'postgresql://migrator@localhost/finsight_demo?options=-csearch_path=other', ALLOW_SYNTHETIC_SEED: 'true' },
    { DATABASE_URL: 'postgresql://app@localhost/finsight_demo', ALLOW_SYNTHETIC_SEED: 'true' },
  ]) expect(() => requireSyntheticDatabase(env)).toThrow();
});
