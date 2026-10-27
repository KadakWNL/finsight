import { seedRiskRules } from "./financial-seed.mjs";

const keys = {
  customer: "customer_id",
  address: "address_id",
  account: "account_id",
  payment_method: "method_id",
  merchant: "merchant_id",
  device_fingerprint: "device_id",
  transaction: "transaction_id",
};
const fields = {
  customer: ["customer_id", "full_name", "email", "country_code", "status"],
  address: [
    "address_id",
    "customer_id",
    "line1",
    "city",
    "state",
    "postal_code",
    "country_code",
    "is_primary",
  ],
  account: [
    "account_id",
    "customer_id",
    "account_number",
    "account_type",
    "currency_code",
    "balance",
    "status",
    "opened_at",
  ],
  payment_method: [
    "method_id",
    "account_id",
    "method_type",
    "token",
    "last4",
    "status",
  ],
  merchant: [
    "merchant_id",
    "merchant_name",
    "category_code",
    "country_code",
    "city",
    "risk_tier",
    "is_watchlisted",
  ],
  device_fingerprint: [
    "device_id",
    "device_hash",
    "os_family",
    "first_seen_country",
    "first_seen_at",
  ],
  transaction: [
    "transaction_id",
    "account_id",
    "method_id",
    "merchant_id",
    "device_id",
    "amount",
    "currency_code",
    "exchange_rate",
    "direction",
    "txn_type",
    "status",
    "occurred_at",
    "merchant_country_code",
    "merchant_city",
    "description",
  ],
};
export async function importDemoDataset(client, dataset) {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(71048502)");
    await seedRiskRules(client);
    for (const [table, key] of Object.entries(keys)) {
      const rows = dataset.tables[table];
      for (let n = 0; n < rows.length; n += 250) {
        const batch = rows.slice(n, n + 250),
          columns = Object.keys(batch[0]);
        if (
          columns.length !== fields[table].length ||
          batch.some(
            (row) =>
              Object.keys(row).length !== columns.length ||
              Object.keys(row).some((c) => !fields[table].includes(c)),
          )
        )
          throw new Error("Unexpected demo row fields.");
        const source = `SELECT (jsonb_populate_record(NULL::public.${table},value)).* FROM jsonb_array_elements($1::jsonb)`;
        await client.query(
          `WITH input AS (${source}) INSERT INTO public.${table} (${columns.join(",")}) SELECT ${columns.join(",")} FROM input ON CONFLICT DO NOTHING`,
          [JSON.stringify(batch)],
        );
        const expected = columns.map((c) => `i.${c}`).join(","),
          actual = columns.map((c) => `t.${c}`).join(",");
        const check = await client.query(
          `WITH input AS (${source}) SELECT count(*)::int AS conflicts FROM input i LEFT JOIN public.${table} t ON t.${key}=i.${key} WHERE ROW(${expected}) IS DISTINCT FROM ROW(${actual})`,
          [JSON.stringify(batch)],
        );
        if (check.rows[0].conflicts)
          throw new Error(
            `Demo import conflicts with retained ${table} facts; use another seed. No existing facts were overwritten.`,
          );
      }
    }
    for (const row of dataset.tables.transaction)
      await client.query("SELECT public.score_transaction($1)", [
        row.transaction_id,
      ]);
    const verification = await client.query(
      `WITH expected AS (
      SELECT t.transaction_id,r.rule_id,r.weight,r.threshold_value,
        CASE r.rule_code WHEN 'AMOUNT_BASE_GTE' THEN t.amount_base ELSE CASE m.risk_tier WHEN 'low' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END END AS observation,
        CASE r.rule_code WHEN 'AMOUNT_BASE_GTE' THEN format('Synthetic amount rule: INR base %s >= threshold %s INR; contribution %s points.',t.amount_base,r.threshold_value,r.weight)
          ELSE format('Synthetic merchant rule: %s tier (low=0, medium=1, high=2), code %s >= threshold %s; contribution %s points.',m.risk_tier,CASE m.risk_tier WHEN 'low' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,r.threshold_value,r.weight) END AS evidence
      FROM public.transaction t JOIN public.merchant m USING(merchant_id) CROSS JOIN public.risk_rule r
      WHERE t.transaction_id=ANY($1::uuid[])
    ) SELECT count(*)::int AS conflicts FROM expected e LEFT JOIN public.risk_signal s USING(transaction_id,rule_id)
    WHERE (e.observation>=e.threshold_value) IS DISTINCT FROM (s.signal_id IS NOT NULL)
      OR (s.signal_id IS NOT NULL AND (s.observed_value<>e.observation OR s.score_contribution<>e.weight OR s.evidence<>e.evidence))`,
      [dataset.tables.transaction.map((row) => row.transaction_id)],
    );
    if (verification.rows[0].conflicts)
      throw new Error(
        "Demo import conflicts with recorded risk evidence; no existing signals were rewritten.",
      );
    await client.query("COMMIT");
    return dataset.manifest.counts;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
