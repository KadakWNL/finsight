import 'server-only';
import type { Client } from 'pg';

type SqlClient = Pick<Client, 'query'>;
type Cursor = { occurredAt: string; transactionId: string };
type ExplorerOptions = {
  limit?: number;
  cursor?: Cursor;
  accountId?: string;
  merchantId?: string;
  query?: string;
  riskBand?: 'low' | 'medium' | 'high' | 'critical';
};

function uuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new RangeError('Invalid UUID');
  }
  return value;
}

const projection = `t.transaction_id, t.account_id, t.merchant_id, t.device_id,
  t.amount, t.currency_code, t.exchange_rate, t.amount_base, t.direction, t.status,
  to_char(t.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
  t.description, m.merchant_name, m.risk_tier AS current_merchant_tier,
  r.risk_score, r.signal_count, r.risk_band`;
const joins = `FROM public.transaction t JOIN public.account a USING (account_id)
  JOIN public.merchant m USING (merchant_id)
  JOIN public.v_transaction_risk r USING (transaction_id)`;

export async function listTransactions(client: SqlClient, options: ExplorerOptions = {}) {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Page size must be 1-100');
  const values: (string | number)[] = [];
  const where: string[] = [];
  const bind = (value: string | number) => { values.push(value); return `$${values.length}`; };
  if (options.accountId) where.push(`t.account_id=${bind(uuid(options.accountId))}`);
  if (options.merchantId) where.push(`t.merchant_id=${bind(uuid(options.merchantId))}`);
  if (options.query !== undefined) {
    if (!options.query.trim() || options.query.length > 500) throw new RangeError('Search must contain 1-500 characters');
    where.push(`t.search_vector @@ plainto_tsquery('english',${bind(options.query)})`);
  }
  if (options.riskBand) {
    if (!['low', 'medium', 'high', 'critical'].includes(options.riskBand)) throw new RangeError('Invalid risk band');
    where.push(`r.risk_band=${bind(options.riskBand)}`);
  }
  if (options.cursor) {
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(options.cursor.occurredAt)
        || !Number.isFinite(Date.parse(options.cursor.occurredAt))) throw new RangeError('Invalid cursor time');
    where.push(`(t.occurred_at,t.transaction_id)<(${bind(options.cursor.occurredAt)}::timestamptz,${bind(uuid(options.cursor.transactionId))}::uuid)`);
  }
  return (await client.query(`SELECT ${projection} ${joins}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.occurred_at DESC,t.transaction_id DESC LIMIT ${bind(limit)}`, values)).rows;
}

export async function transactionRiskDetail(client: SqlClient, transactionId: string) {
  const id = uuid(transactionId);
  const result = await client.query(`SELECT ${projection},
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'signal_id',s.signal_id,'observed_value',s.observed_value::text,
      'score_contribution',s.score_contribution::text,'evidence',s.evidence,'triggered_at',s.triggered_at,
      'rule_code',rr.rule_code,'rule_name',rr.rule_name,'dimension',rr.dimension,
      'current_rule_weight',rr.weight::text,'current_rule_threshold',rr.threshold_value::text,
      'current_rule_active',rr.is_active,'current_rule_version',rr.version
    ) ORDER BY rr.rule_code,s.signal_id),'[]'::jsonb)
    FROM public.risk_signal s JOIN public.risk_rule rr USING (rule_id)
    WHERE s.transaction_id=t.transaction_id) AS signals
    ${joins} WHERE t.transaction_id=$1`, [id]);
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
