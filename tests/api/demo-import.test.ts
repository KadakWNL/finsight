import { afterAll, beforeAll, expect, test } from "vitest";
import pg from "pg";
import { requireTestDatabase } from "../../scripts/database-safety.mjs";
import { applyMigrations } from "../../scripts/migration-runner.mjs";
import { seedFinancial } from "../../scripts/financial-seed.mjs";
import { parseReferenceCsv } from "../../scripts/demo-fx.mjs";
import { buildDemoDataset } from "../../scripts/demo-dataset.mjs";
import { importDemoDataset } from "../../scripts/demo-import.mjs";

let client: pg.Client;
const fx = parseReferenceCsv(
  "date,base,quote,rate\n2025-12-31,USD,INR,89.87\n2026-01-02,USD,INR,90.2\n",
  "https://api.frankfurter.dev/v2/providers/ecb/rates.csv?base=USD&quotes=INR",
);
const options = {
  seed: "integration-demo",
  start: "2026-01-02",
  days: 3,
  transactions: 24,
  customers: 6,
  merchants: 10,
};
beforeAll(async () => {
  client = new pg.Client({ connectionString: requireTestDatabase() });
  await client.connect();
  await applyMigrations(client, new URL("../../migrations/", import.meta.url));
  await seedFinancial(client);
});
afterAll(async () => {
  if (client) {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await client.end();
  }
});

test("imports connected facts, preserves exact conversions, and retries without replacing evidence", async () => {
  const data = buildDemoDataset(options, fx);
  await importDemoDataset(client, data);
  expect(
    (await client.query("SELECT count(*)::int AS n FROM public.transaction"))
      .rows[0].n,
  ).toBe(32);
  for (const row of data.tables.transaction) {
    const stored = (
      await client.query(
        "SELECT amount::text,exchange_rate::text,amount_base=round(amount*exchange_rate,2) AS exact FROM public.transaction WHERE transaction_id=$1",
        [row.transaction_id],
      )
    ).rows[0];
    expect(stored).toEqual({
      amount: row.amount,
      exchange_rate: row.exchange_rate,
      exact: true,
    });
  }
  const evidence = (
    await client.query(
      "SELECT signal_id,triggered_at,evidence FROM public.risk_signal ORDER BY signal_id",
    )
  ).rows;
  await importDemoDataset(client, data);
  expect(
    (
      await client.query(
        "SELECT signal_id,triggered_at,evidence FROM public.risk_signal ORDER BY signal_id",
      )
    ).rows,
  ).toEqual(evidence);
  const conflicting = buildDemoDataset({ ...options, transactions: 25 }, fx);
  conflicting.tables.transaction[5].amount = "999.00";
  await expect(importDemoDataset(client, conflicting)).rejects.toThrow(
    "conflicts",
  );
  expect(
    (await client.query("SELECT count(*)::int AS n FROM public.transaction"))
      .rows[0].n,
  ).toBe(32);
  expect(
    (
      await client.query(
        "SELECT signal_id,triggered_at,evidence FROM public.risk_signal ORDER BY signal_id",
      )
    ).rows,
  ).toEqual(evidence);
});

test("a failure during scoring rolls back the entire new dataset and partial signals", async () => {
  const data = buildDemoDataset({ ...options, seed: "scoring-rollback" }, fx);
  let scores = 0;
  const failing = {
    query: async (text: string, values?: unknown[]) => {
      if (text === "SELECT public.score_transaction($1)" && ++scores === 2)
        throw new Error("Injected scoring failure");
      return client.query(text, values);
    },
  };
  await expect(importDemoDataset(failing, data)).rejects.toThrow(
    "Injected scoring failure",
  );
  expect(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM public.transaction WHERE transaction_id=ANY($1::uuid[])",
        [data.tables.transaction.map((t) => t.transaction_id)],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await client.query(
        "SELECT count(*)::int AS n FROM public.customer WHERE customer_id=ANY($1::uuid[])",
        [data.tables.customer.map((c) => c.customer_id)],
      )
    ).rows[0].n,
  ).toBe(0);
});

test("refuses mismatched prior evidence without attempting to correct immutable signals", async () => {
  const data = buildDemoDataset(options, fx);
  const subject = (
    await client.query(
      "SELECT transaction_id FROM public.v_transaction_risk WHERE transaction_id=ANY($1::uuid[]) AND signal_count=0 LIMIT 1",
      [data.tables.transaction.map((t) => t.transaction_id)],
    )
  ).rows[0].transaction_id;
  await client.query(
    `INSERT INTO public.risk_signal(signal_id,transaction_id,rule_id,observed_value,score_contribution,evidence)
    SELECT gen_random_uuid(),$1,rule_id,1,9,'Synthetic conflicting probe' FROM public.risk_rule WHERE rule_code='AMOUNT_BASE_GTE'`,
    [subject],
  );
  await expect(importDemoDataset(client, data)).rejects.toThrow(
    "conflicts with recorded risk evidence",
  );
  expect(
    (
      await client.query(
        "SELECT evidence FROM public.risk_signal WHERE transaction_id=$1",
        [subject],
      )
    ).rows[0].evidence,
  ).toBe("Synthetic conflicting probe");
});
