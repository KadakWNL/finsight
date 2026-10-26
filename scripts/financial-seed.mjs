export const syntheticId = n => `30000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

export const scenarios = [
  { code: 'control-inr', amount: '500.00', currency: 'INR', rate: '1.00000000', tier: 0, base: '500.00', score: '0', count: 0, band: 'low', suspicious: false },
  { code: 'control-usd', amount: '10.00', currency: 'USD', rate: '80.00000000', tier: 1, base: '800.00', score: '0', count: 0, band: 'low', suspicious: false },
  { code: 'amount-below', amount: '9999.99', currency: 'INR', rate: '1.00000000', tier: 0, base: '9999.99', score: '0', count: 0, band: 'low', suspicious: false },
  { code: 'amount-equal', amount: '10000.00', currency: 'INR', rate: '1.00000000', tier: 0, base: '10000.00', score: '40', count: 1, band: 'medium', suspicious: false },
  { code: 'merchant-only', amount: '500.00', currency: 'INR', rate: '1.00000000', tier: 2, base: '500.00', score: '25', count: 1, band: 'low', suspicious: true },
  { code: 'both-high', amount: '12000.00', currency: 'INR', rate: '1.00000000', tier: 2, base: '12000.00', score: '65', count: 2, band: 'high', suspicious: true },
  { code: 'both-usd', amount: '125.00', currency: 'USD', rate: '80.00000000', tier: 2, base: '10000.00', score: '65', count: 2, band: 'high', suspicious: true },
  { code: 'rounded-boundary', amount: '125.00', currency: 'USD', rate: '79.99996000', tier: 0, base: '10000.00', score: '40', count: 1, band: 'medium', suspicious: false },
];

async function insertVerified(client, table, fields) {
  const columns = Object.keys(fields);
  const values = Object.values(fields);
  const parameters = columns.map((_, i) => `$${i + 1}`);
  await client.query(`INSERT INTO public.${table} (${columns.join(',')}) VALUES (${parameters.join(',')}) ON CONFLICT DO NOTHING`, values);
  const predicates = columns.map((column, i) => `${column} IS NOT DISTINCT FROM $${i + 1}`);
  const result = await client.query(`SELECT EXISTS(SELECT 1 FROM public.${table} WHERE ${predicates.join(' AND ')}) AS matches`, values);
  if (!result.rows[0].matches) throw new Error(`Synthetic seed conflict in ${table}; no existing facts were overwritten.`);
}

export async function seedFinancialFacts(client) {
  await insertVerified(client, 'customer', { customer_id: syntheticId(1), country_code: 'IN', status: 'active' });
  for (const [index, currency] of ['INR', 'USD'].entries()) {
    await insertVerified(client, 'account', { account_id: syntheticId(10 + index), customer_id: syntheticId(1), account_number: `SYNTHETIC-RISK-${currency}`, account_type: 'savings', currency_code: currency, balance: '100000.00', status: 'active', opened_at: '2026-01-01' });
    await insertVerified(client, 'payment_method', { method_id: syntheticId(20 + index), account_id: syntheticId(10 + index), method_type: 'card', token: `synthetic-noncredential-${currency}`, status: 'active' });
  }
  for (const [index, tier] of ['low', 'medium', 'high'].entries()) {
    await insertVerified(client, 'merchant', { merchant_id: syntheticId(30 + index), merchant_name: `Synthetic ${tier} merchant`, category_code: '5411', country_code: 'IN', risk_tier: tier });
  }
  await insertVerified(client, 'device_fingerprint', { device_id: syntheticId(40), device_hash: 'd'.repeat(64), os_family: 'synthetic', first_seen_at: '2026-01-01T00:00:00Z' });
  for (const [index, scenario] of scenarios.entries()) {
    const currencyIndex = scenario.currency === 'INR' ? 0 : 1;
    await insertVerified(client, 'transaction', { transaction_id: syntheticId(100 + index), account_id: syntheticId(10 + currencyIndex), method_id: syntheticId(20 + currencyIndex), merchant_id: syntheticId(30 + scenario.tier), device_id: syntheticId(40), amount: scenario.amount, currency_code: scenario.currency, exchange_rate: scenario.rate, direction: 'debit', txn_type: 'card_payment', status: 'posted', occurred_at: `2026-01-01T00:0${index}:00Z`, merchant_country_code: 'IN', description: `Synthetic card purchase ${scenario.currency} fixture ${index + 1}` });
    await insertVerified(client, 'fraud_scenario', { scenario_id: syntheticId(200 + index), scenario_code: scenario.code, scenario_name: `Synthetic ${scenario.code}`, description: 'Synthetic evaluation label; never an investigator answer.' });
    await insertVerified(client, 'transaction_label', { transaction_id: syntheticId(100 + index), scenario_id: syntheticId(200 + index), is_suspicious: scenario.suspicious });
  }
}

export async function seedRiskRules(client) {
  await insertVerified(client, 'risk_rule', { rule_id: syntheticId(50), rule_code: 'AMOUNT_BASE_GTE', rule_name: 'Synthetic INR amount threshold', dimension: 'amount', weight: '40', threshold_value: '10000.00', is_active: true, version: 1 });
  await insertVerified(client, 'risk_rule', { rule_id: syntheticId(51), rule_code: 'MERCHANT_TIER_GTE', rule_name: 'Synthetic merchant tier threshold', dimension: 'merchant', weight: '25', threshold_value: '2', is_active: true, version: 1 });
}

export async function seedFinancial(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(71048502)');
    await seedFinancialFacts(client);
    await seedRiskRules(client);
    for (let index = 0; index < scenarios.length; index++) {
      await client.query('SELECT public.score_transaction($1)', [syntheticId(100 + index)]);
    }
    for (const [index, scenario] of scenarios.entries()) {
      const subject = syntheticId(100 + index);
      const risk = (await client.query('SELECT risk_score,signal_count,risk_band FROM public.v_transaction_risk WHERE transaction_id=$1', [subject])).rows[0];
      const actual = (await client.query(`SELECT rr.rule_code,s.observed_value,s.score_contribution,s.evidence
        FROM public.risk_signal s JOIN public.risk_rule rr USING(rule_id)
        WHERE s.transaction_id=$1 ORDER BY rr.rule_code`, [subject])).rows;
      const expected = [];
      if (Number(scenario.base) >= 10000) expected.push({ rule_code: 'AMOUNT_BASE_GTE', observed_value: scenario.base, score_contribution: '40',
        evidence: `Synthetic amount rule: INR base ${scenario.base} >= threshold 10000.00 INR; contribution 40 points.` });
      if (scenario.tier === 2) expected.push({ rule_code: 'MERCHANT_TIER_GTE', observed_value: '2', score_contribution: '25',
        evidence: 'Synthetic merchant rule: high tier (low=0, medium=1, high=2), code 2 >= threshold 2; contribution 25 points.' });
      if (risk?.risk_score !== scenario.score || risk?.signal_count !== scenario.count || risk?.risk_band !== scenario.band
          || JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error('Synthetic seed conflict in risk_signal; recorded results do not match the canonical fixtures.');
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
