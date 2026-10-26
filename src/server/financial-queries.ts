import 'server-only';
import type { Client } from 'pg';
import type { SessionUser } from './session';

type SqlClient = Pick<Client, 'query'>;
type Cursor = { occurredAt: string; transactionId: string };
export type ExplorerOptions = {
  limit?: number;
  cursor?: Cursor;
  accountId?: string;
  merchantId?: string;
  deviceId?: string;
  transactionId?: string;
  query?: string;
  riskBand?: 'low' | 'medium' | 'high' | 'critical';
  status?: 'posted' | 'pending' | 'reversed' | 'blocked';
  from?: string;
  to?: string;
  currency?: 'INR' | 'USD';
  amountMode?: 'original' | 'base';
  amountMin?: string;
  amountMax?: string;
  sort?: 'occurred_at' | 'amount' | 'risk_score' | 'status';
  order?: 'asc' | 'desc';
  fetchExtra?: boolean;
};
type Actor = Pick<SessionUser, 'userId' | 'role'>;

function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new RangeError('Invalid UUID');
  return value;
}

const projection = `t.transaction_id, t.account_id, t.merchant_id, t.device_id,
  t.amount, t.currency_code, t.exchange_rate, t.amount_base, t.direction, t.status,t.txn_type,
  to_char(t.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
  t.description, m.merchant_name, m.risk_tier AS current_merchant_tier,
  r.risk_score, r.signal_count, r.risk_band,
  jsonb_build_object('account_id',a.account_id,'number_masked',
    CASE WHEN length(a.account_number)>4 THEN '****'||right(a.account_number,4) ELSE '****' END,
    'account_type',a.account_type,'currency_code',a.currency_code,'status',a.status) AS account,
  jsonb_build_object('customer_id',c.customer_id,'display_label','Customer '||right(c.customer_id::text,4),
    'country_code',c.country_code,'status',c.status) AS customer,
  jsonb_build_object('merchant_id',m.merchant_id,'name',m.merchant_name,'category_code',m.category_code,
    'country_code',m.country_code,'city',m.city,'current_risk_tier',m.risk_tier) AS merchant,
  jsonb_build_object('device_id',d.device_id,'os_family',d.os_family,'first_seen_country',d.first_seen_country) AS device,
  CASE WHEN pm.method_id IS NULL THEN NULL ELSE jsonb_build_object('method_id',pm.method_id,
    'method_type',pm.method_type,'last4',nullif(btrim(pm.last4),'')) END AS payment_method,
  jsonb_build_object('country_code',t.merchant_country_code,'city',t.merchant_city) AS transaction_location`;
const joins = `FROM public.transaction t JOIN public.account a USING (account_id)
  JOIN public.customer c USING (customer_id) JOIN public.merchant m USING (merchant_id)
  JOIN public.device_fingerprint d USING (device_id)
  LEFT JOIN public.payment_method pm ON pm.method_id=t.method_id AND pm.account_id=t.account_id
  JOIN public.v_transaction_risk r USING (transaction_id)`;

function caseIndicator(actorId: string, role: string) {
  return `coalesce((SELECT CASE WHEN ${role}::text='admin' OR ic.assigned_to_user_id=${actorId}::uuid
    THEN jsonb_build_object('exists',true,'access','permitted','case_id',ic.case_id,'case_ref',ic.case_ref,'status',ic.status)
    ELSE jsonb_build_object('exists',true,'access','restricted') END
    FROM public.investigation_case ic WHERE ic.transaction_id=t.transaction_id
      AND ic.status IN ('open','in_review','escalated') LIMIT 1),
    jsonb_build_object('exists',false,'access','none')) AS active_case`;
}

export async function listTransactions(client: SqlClient, options: ExplorerOptions = {}, actor?: Actor) {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Page size must be 1-100');
  const sort = options.sort ?? 'occurred_at';
  const order = options.order ?? 'desc';
  const sortExpressions = { occurred_at: 't.occurred_at', amount: options.amountMode === 'base' ? 't.amount_base' : 't.amount', risk_score: 'r.risk_score', status: 't.status' };
  if (!Object.hasOwn(sortExpressions,sort) || !['asc','desc'].includes(order)) throw new RangeError('Invalid sort');
  if (sort === 'amount' && options.amountMode !== 'base' && !options.currency) throw new RangeError('Amount sort requires currency or base mode');
  const expression = sortExpressions[sort];
  const values: (string | number | null)[] = [actor?.userId ?? null, actor?.role ?? null];
  const where: string[] = [];
  const bind = (value: string | number) => { values.push(value); return `$${values.length}`; };
  if (options.transactionId) where.push(`t.transaction_id=${bind(uuid(options.transactionId))}`);
  if (options.accountId) where.push(`t.account_id=${bind(uuid(options.accountId))}`);
  if (options.merchantId) where.push(`t.merchant_id=${bind(uuid(options.merchantId))}`);
  if (options.deviceId) where.push(`t.device_id=${bind(uuid(options.deviceId))}`);
  if (options.query !== undefined) {
    if (!options.query.trim() || options.query.length > 500) throw new RangeError('Search must contain 1-500 characters');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.query)) where.push(`t.transaction_id=${bind(options.query)}`);
    else where.push(`t.search_vector @@ plainto_tsquery('english',${bind(options.query)})`);
  }
  if (options.riskBand) where.push(`r.risk_band=${bind(options.riskBand)}`);
  if (options.status) where.push(`t.status=${bind(options.status)}`);
  if (options.from) where.push(`t.occurred_at>=${bind(options.from)}::timestamptz`);
  if (options.to) where.push(`t.occurred_at<${bind(options.to)}::timestamptz`);
  if (options.currency) where.push(`t.currency_code=${bind(options.currency)}`);
  const amount = options.amountMode === 'base' ? 't.amount_base' : 't.amount';
  if (options.amountMin) where.push(`${amount}>=${bind(options.amountMin)}::numeric`);
  if (options.amountMax) where.push(`${amount}<=${bind(options.amountMax)}::numeric`);
  if (options.cursor) {
    const key = options.cursor.occurredAt;
    if (sort === 'occurred_at' && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(key)
        || !Number.isFinite(Date.parse(key)))) throw new RangeError('Invalid cursor time');
    const type = sort === 'occurred_at' ? 'timestamptz' : sort === 'status' ? 'varchar' : 'numeric';
    where.push(`(${expression},t.transaction_id)${order === 'desc' ? '<' : '>'}(${bind(key)}::${type},${bind(uuid(options.cursor.transactionId))}::uuid)`);
  }
  const cursorExpression = sort === 'occurred_at'
    ? `to_char(t.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    : `(${expression})::text`;
  return (await client.query(`SELECT ${projection},${caseIndicator('$1','$2')},${cursorExpression} AS _cursor_key ${joins}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${expression} ${order},t.transaction_id ${order} LIMIT ${bind(limit+(options.fetchExtra ? 1 : 0))}`,values)).rows;
}

export async function transactionRiskDetail(client: SqlClient, transactionId: string, actor?: Actor) {
  const id = uuid(transactionId);
  const result = await client.query(`SELECT ${projection},${caseIndicator('$2','$3')},
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signal_id',s.signal_id,'observed_value',s.observed_value::text,
      'score_contribution',s.score_contribution::text,'evidence',s.evidence,'triggered_at',s.triggered_at,
      'rule_code',rr.rule_code,'rule_name',rr.rule_name,'dimension',rr.dimension,
      'current_rule_weight',rr.weight::text,'current_rule_threshold',rr.threshold_value::text,
      'current_rule_active',rr.is_active,'current_rule_version',rr.version
    ) ORDER BY rr.rule_code,s.signal_id),'[]'::jsonb)
    FROM public.risk_signal s JOIN public.risk_rule rr USING (rule_id)
    WHERE s.transaction_id=t.transaction_id) AS signals
    ${joins} WHERE t.transaction_id=$1`,[id,actor?.userId ?? null,actor?.role ?? null]);
  if (!result.rows.length) return null;
  return { ...result.rows[0],
    coverage: 'Only amount and merchant rules; other dimensions are unevaluated.',
    signal_summary: result.rows[0].signal_count === 0 ? 'No recorded signals' : 'Recorded synthetic rule signals',
    configuration_label: 'Joined rule and merchant configuration is current; stored evidence records the observation.' };
}

export async function merchantRiskSummary(client: SqlClient, minimumFlagged = 1, limit = 25) {
  if (!Number.isInteger(minimumFlagged) || minimumFlagged < 1
      || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid summary bounds');
  return (await client.query(`SELECT m.merchant_id,m.merchant_name,
    count(*)::integer AS transaction_count,sum(r.risk_score) AS recorded_risk_points,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.risk_signal s WHERE s.transaction_id=t.transaction_id))::integer AS flagged_count
    FROM public.merchant m JOIN public.transaction t USING (merchant_id)
    JOIN public.v_transaction_risk r USING (transaction_id)
    GROUP BY m.merchant_id,m.merchant_name
    HAVING count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.risk_signal s WHERE s.transaction_id=t.transaction_id)) >= $1
    ORDER BY recorded_risk_points DESC,m.merchant_id LIMIT $2`, [minimumFlagged, limit])).rows;
}
