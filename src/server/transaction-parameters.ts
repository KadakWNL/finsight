import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAuthSecret } from './auth-security';
import type { SessionUser } from './session';
import type { ExplorerOptions } from './financial-queries';

export class TransactionParameterError extends Error {
  constructor(public readonly fields: Record<string, string>) { super('Invalid request parameters.'); }
}

function invalid(field: string, message: string): never { throw new TransactionParameterError({ [field]: message }); }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function transactionUuid(value: string, field = 'id') {
  if (!uuidPattern.test(value)) invalid(field, 'Expected a UUID.');
  return value.toLowerCase();
}

function timestamp(value: string, field: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return invalid(field, 'Expected an RFC3339 timestamp with a timezone and at most six fractional digits.');
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const offset = parts[8];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
      || hour > 23 || minute > 59 || second > 59
      || (offset !== 'Z' && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4)) > 59
        || (Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4)) !== 0)))) {
    return invalid(field, 'Invalid calendar date or timezone.');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    return invalid(field, 'Timestamp is outside the supported range.');
  }
  return date.toISOString().slice(0, 19) + '.' + (parts[7] ?? '').padEnd(6, '0') + 'Z';
}

function money(value: string, field: string) {
  if (!/^(0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(value)) {
    return invalid(field, 'Expected a nonnegative decimal with at most 18 integer and two fractional digits.');
  }
  const [whole, fraction = ''] = value.split('.');
  return whole + '.' + fraction.padEnd(2, '0');
}
function cents(value: string) { return BigInt(value.replace('.', '')); }
function choice<T extends string>(value: string, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) return invalid(field, 'Unsupported value.');
  return value as T;
}

export interface ParsedTransactionQuery {
  options: ExplorerOptions;
  pageSize: number;
  binding: string;
}

type CursorPayload = { v: 1; binding: string; key: string; id: string };
function signature(encoded: string) {
  return createHmac('sha256', getAuthSecret()).update('transaction-cursor-v1:' + encoded).digest();
}

export function parseTransactionQuery(params: URLSearchParams, actor: Pick<SessionUser, 'userId' | 'role'>): ParsedTransactionQuery {
  const allowed = new Set(['q', 'transaction_id', 'account_id', 'merchant_id', 'device_id', 'from', 'to',
    'status', 'risk', 'currency', 'amount_mode', 'amount_min', 'amount_max', 'sort', 'order', 'page_size', 'cursor']);
  for (const key of params.keys()) {
    if (!allowed.has(key)) invalid('query', 'Unsupported query parameter.');
    if (params.getAll(key).length !== 1) invalid(key, 'Repeated parameters are not allowed.');
  }
  const page = params.get('page_size') ?? '25';
  if (!/^[1-9]\d{0,2}$/.test(page) || Number(page) > 100) invalid('page_size', 'Page size must be 1-100.');
  const options: ExplorerOptions = {
    limit: Number(page),
    sort: choice(params.get('sort') ?? 'occurred_at', ['occurred_at', 'amount', 'risk_score', 'status'] as const, 'sort'),
    order: choice(params.get('order') ?? 'desc', ['asc', 'desc'] as const, 'order'),
    amountMode: choice(params.get('amount_mode') ?? 'original', ['original', 'base'] as const, 'amount_mode'),
  };
  for (const [parameter, property] of [['transaction_id', 'transactionId'], ['account_id', 'accountId'], ['merchant_id', 'merchantId'], ['device_id', 'deviceId']] as const) {
    if (params.has(parameter)) options[property] = transactionUuid(params.get(parameter)!, parameter);
  }
  if (params.has('q')) {
    const query = params.get('q')!.trim();
    if (!query || query.length > 500 || [...query].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
      invalid('q', 'Search must contain 1-500 characters without control characters.');
    }
    options.query = uuidPattern.test(query) ? query.toLowerCase() : query;
  }
  if (params.has('from')) options.from = timestamp(params.get('from')!, 'from');
  if (params.has('to')) options.to = timestamp(params.get('to')!, 'to');
  if (options.from && options.to && options.from >= options.to) invalid('to', 'The exclusive end must follow the start.');
  if (params.has('status')) options.status = choice(params.get('status')!, ['posted', 'pending', 'reversed', 'blocked'] as const, 'status');
  if (params.has('risk')) options.riskBand = choice(params.get('risk')!, ['low', 'medium', 'high', 'critical'] as const, 'risk');
  if (params.has('currency')) options.currency = choice(params.get('currency')!, ['INR', 'USD'] as const, 'currency');
  if (params.has('amount_min')) options.amountMin = money(params.get('amount_min')!, 'amount_min');
  if (params.has('amount_max')) options.amountMax = money(params.get('amount_max')!, 'amount_max');
  if (options.amountMin && options.amountMax && cents(options.amountMin) > cents(options.amountMax)) invalid('amount_max', 'Maximum must not be below minimum.');
  if ((options.amountMin || options.amountMax || options.sort === 'amount') && options.amountMode !== 'base' && !options.currency) {
    invalid('currency', 'Original-amount filters and sorting require a currency, or select amount_mode=base for INR values.');
  }
  if (options.amountMode === 'base' && options.currency) invalid('currency', 'Base-amount mode uses INR across original currencies; omit currency.');
  const binding = createHmac('sha256', getAuthSecret()).update(JSON.stringify({ actor: [actor.userId, actor.role], options })).digest('hex');
  if (params.has('cursor')) {
    const cursor = params.get('cursor')!;
    const pieces = cursor.split('.');
    if (cursor.length > 4096 || pieces.length !== 2 || pieces.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) invalid('cursor', 'Invalid cursor.');
    const expected = signature(pieces[0]); const supplied = Buffer.from(pieces[1], 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) invalid('cursor', 'Invalid cursor.');
    let payload: CursorPayload;
    try { payload = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8')); }
    catch { return invalid('cursor', 'Invalid cursor.'); }
    if (!payload || payload.v !== 1 || payload.binding !== binding || typeof payload.key !== 'string' || typeof payload.id !== 'string') {
      invalid('cursor', 'Cursor does not match the current actor, filters, sort or page size.');
    }
    const id = transactionUuid(payload.id, 'cursor');
    if (options.sort === 'occurred_at') timestamp(payload.key, 'cursor');
    else if (options.sort === 'status') choice(payload.key, ['posted', 'pending', 'reversed', 'blocked'] as const, 'cursor');
    else if (!/^\d{1,40}(?:\.\d{1,2})?$/.test(payload.key)) invalid('cursor', 'Invalid cursor key.');
    options.cursor = { occurredAt: payload.key, transactionId: id };
  }
  return { options, pageSize: Number(page), binding };
}

export function transactionNextCursor(query: ParsedTransactionQuery, row: { transaction_id: string; _cursor_key: string }) {
  const payload: CursorPayload = { v: 1, binding: query.binding, key: row._cursor_key, id: row.transaction_id };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return encoded + '.' + signature(encoded).toString('base64url');
}

