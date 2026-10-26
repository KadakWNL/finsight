import { expect, test, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { parseTransactionQuery, transactionNextCursor, TransactionParameterError } from '../../src/server/transaction-parameters';

const actor = { userId: '80000000-0000-0000-0000-000000000001', role: 'analyst' as const };
const parse = (query = '') => parseTransactionQuery(new URLSearchParams(query),actor);

test('normalizes validated timestamps, exact IDs and decimal bounds without floating point', () => {
  expect(parse().options).toEqual({ limit:25,sort:'occurred_at',order:'desc',amountMode:'original' });
  const query = parse('from=2026-01-01T05%3A30%3A00.000001%2B05%3A30&to=2026-01-01T00%3A00%3A00.000002Z&currency=USD&amount_min=0.1&amount_max=999999999999999999.99');
  expect(query.options.from).toBe('2026-01-01T00:00:00.000001Z');
  expect(query.options.amountMin).toBe('0.10'); expect(query.options.amountMax).toBe('999999999999999999.99');
  expect(parse('q=AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA').options.query).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
});

test.each([
  'page_size=0','page_size=101','page_size=-1','page_size=2.5','page_size=2&page_size=3',
  'unknown=value','sort=amount','sort=drop_table','order=desc%3BDROP%20TABLE','status=safe','risk=safe',
  'transaction_id=invalid','account_id=invalid','merchant_id=invalid','device_id=invalid',
  'q=','q=%00','q='+ 'a'.repeat(501),'from=2026-02-30T00:00:00Z','from=2026-01-01',
  'from=2026-01-01T00:00:00%2B25:00','from=0000-01-01T00:00:00Z',
  'from=2026-01-01T00:00:00.000002Z&to=2026-01-01T00:00:00.000001Z',
  'amount_min=1','currency=EUR','currency=INR&amount_min=NaN','currency=INR&amount_min=1.001',
  'currency=INR&amount_min=1000000000000000000','currency=INR&amount_min=-1',
  'currency=INR&amount_min=2&amount_max=1','amount_mode=base&currency=INR','amount_mode=unknown',
])('rejects malformed or ambiguous filters: %s', query => {
  expect(() => parse(query)).toThrow(TransactionParameterError);
});

test('signs cursors and binds actor, role, filters, sort and page size', () => {
  const query = parse('page_size=2&status=posted');
  const cursor = transactionNextCursor(query,{ transaction_id:'30000000-0000-0000-0000-000000000105',_cursor_key:'2026-01-01T00:05:00.000001Z' });
  const same = new URLSearchParams({ page_size:'2',status:'posted',cursor });
  expect(parseTransactionQuery(same,actor).options.cursor?.occurredAt).toBe('2026-01-01T00:05:00.000001Z');
  expect(() => parseTransactionQuery(same,{ ...actor,userId:'80000000-0000-0000-0000-000000000002' })).toThrow(TransactionParameterError);
  expect(() => parseTransactionQuery(same,{ ...actor,role:'admin' })).toThrow(TransactionParameterError);
  for (const changed of [{page_size:'3'},{status:'pending'},{sort:'risk_score'},{order:'asc'}]) {
    const parameters = new URLSearchParams(same);
    for(const [key,value] of Object.entries(changed)) parameters.set(key,value);
    expect(() => parseTransactionQuery(parameters,actor)).toThrow(TransactionParameterError);
  }
  const tampered = cursor.startsWith('a') ? 'b'+cursor.slice(1) : 'a'+cursor.slice(1);
  expect(() => parse(`page_size=2&status=posted&cursor=${tampered}`)).toThrow(TransactionParameterError);
  expect(() => parse('cursor=invalid')).toThrow(TransactionParameterError);
  const payload = Buffer.from(cursor.split('.')[0],'base64url').toString('utf8');
  expect(payload).not.toContain(actor.userId); expect(payload).not.toContain('posted');
});
