import { expect, test } from 'vitest';
import { acceptanceConnections } from '../../scripts/acceptance-safety.mjs';
import { acceptanceMatrix, evaluateMatrix, playwrightRecords } from '../../scripts/acceptance-matrix.mjs';

test('acceptance refuses ambiguous, shared and owner-equivalent runtime targets', () => {
  const env = { ALLOW_TEST_DATABASE: 'true', TEST_DATABASE_URL: 'postgresql://owner@localhost/finsight_acceptance_test' };
  for (const runtime of [undefined, env.TEST_DATABASE_URL, 'postgresql://finsight_runtime@remote/finsight_acceptance_test', 'postgresql://finsight_runtime@localhost/demo_test']) {
    expect(() => acceptanceConnections({ ...env, ACCEPTANCE_RUNTIME_DATABASE_URL: runtime })).toThrow();
  }
  expect(acceptanceConnections({ ...env, ACCEPTANCE_RUNTIME_DATABASE_URL: 'postgresql://finsight_runtime@localhost/finsight_acceptance_test' }).runtime).toContain('finsight_runtime');
});

test('missing evidence, skipped tests and failed prerequisites cannot become passing scenarios', () => {
  expect(acceptanceMatrix.map(value => value.id)).toEqual(Array.from({ length: 16 }, (_, n) => `VS${String(n + 1).padStart(2, '0')}`));
  const stages = [...new Set(acceptanceMatrix.flatMap(value => value.evidence.map(item => item.stage)))].map(id => ({ id, status: 'passed' }));
  const records = acceptanceMatrix.flatMap(value => value.evidence.filter(item => item.match).map(item => ({ ...item, title: item.match, status: 'passed' })));
  expect(evaluateMatrix(stages, records).every(value => value.status === 'passed')).toBe(true);
  expect(evaluateMatrix(stages, []).every(value => value.status === 'blocking')).toBe(true);
  const skipped = records.map(value => ({ ...value, status: 'skipped' }));
  expect(evaluateMatrix(stages, skipped).every(value => value.status === 'blocking')).toBe(true);
  expect(evaluateMatrix(stages.map(value => ({ ...value, status: 'failed' })), records).every(value => value.status === 'blocking')).toBe(true);
});

test('browser report parsing fails closed for retries and omitted results', () => {
  const report = { config: { rootDir: 'C:/source/tests/e2e' }, suites: [{ file: 'probe.spec.ts', specs: [
    { title: 'retried', tests: [{ results: [{ status: 'failed' }, { status: 'passed' }] }] },
    { title: 'missing', tests: [] },
  ] }] };
  expect(playwrightRecords(report).every(value => value.status === 'blocking')).toBe(true);
  expect(playwrightRecords(report).every(value => value.file.endsWith('/tests/e2e/probe.spec.ts'))).toBe(true);
});
