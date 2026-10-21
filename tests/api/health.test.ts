import { expect, test } from 'vitest';
import { GET } from '../../src/app/api/health/route';

test('process health returns only the public process status', async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', scope: 'process' });
});
