import { expect, test } from 'vitest';
import { formatMoney, landingPath, safeWorkspacePath } from '../../src/lib/workspace';
test('recovery destinations keep only local workspace routes and preserve filters',()=>{
  const path='/transactions/30000000-0000-0000-0000-000000000100?returnTo=%2Ftransactions%3Frisk%3Dhigh';
  expect(safeWorkspacePath(path)).toBe(path);
  for(const value of ['https://example.com','//example.com','/\\example.com','/%2f%2fexample.com','/api/auth/logout','/transactions\n','/transactions/../../admin/users']) expect(safeWorkspacePath(value)).toBe('/transactions');
  expect(landingPath('admin','/overview')).toBe('/admin');
  expect(landingPath('analyst','/admin')).toBe('/overview');
  expect(landingPath('analyst','/transactions?risk=high')).toBe('/transactions?risk=high');
});
test('money formatting preserves large exact decimal values',()=>{
  expect(formatMoney('999999999999999999.99','USD')).toBe('USD 999,999,999,999,999,999.99');
  expect(formatMoney('10000.00','INR')).toBe('INR 10,000.00');
  expect(formatMoney('0.01','USD')).toBe('USD 0.01');
});
