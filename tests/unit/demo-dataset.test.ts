import { expect, test } from "vitest";
import { buildDemoDataset, demoOptions } from "../../scripts/demo-dataset.mjs";
import {
  exactRate,
  fetchReferenceSnapshot,
  parseReferenceCsv,
  rateForDay,
  validateSnapshot,
} from "../../scripts/demo-fx.mjs";

const source =
  "https://api.frankfurter.dev/v2/providers/ecb/rates.csv?base=USD&quotes=INR&from=2025-12-23&to=2026-01-03";
const csv =
  "date,base,quote,rate\n2025-12-31,USD,INR,89.87\n2026-01-02,USD,INR,90.2\n";
const snapshot = () => parseReferenceCsv(csv, source, "2026-10-27T00:00:00Z");
const options = {
  seed: "unit-demo",
  start: "2026-01-02",
  days: 3,
  transactions: 100,
  customers: 10,
  merchants: 12,
};

test("uses exact decimal reference rates and never looks ahead across weekends", () => {
  expect(exactRate("90.2")).toBe("90.20000000");
  for (const bad of [
    "0",
    "NaN",
    "Infinity",
    "1e2",
    "90.123456789",
    "-2",
    "1000000000000",
  ])
    expect(() => exactRate(bad)).toThrow();
  const fx = snapshot();
  expect(rateForDay(fx, "2026-01-02")).toEqual({
    date: "2025-12-31",
    rate: "89.87000000",
  });
  expect(rateForDay(fx, "2026-01-04").date).toBe("2026-01-02");
  expect(() => rateForDay(fx, "2026-01-20")).toThrow();
  expect(() =>
    validateSnapshot({
      ...fx,
      observations: [{ date: "2025-12-31", rate: "1.00000000" }],
    }),
  ).toThrow();
  expect(() => parseReferenceCsv(csv.replace("USD", "EUR"), source)).toThrow();
});
test("generates repeatable linked activity, diverse identifiers and isolated provenance", () => {
  const first = buildDemoDataset(options, snapshot()),
    second = buildDemoDataset(options, snapshot());
  expect(first).toEqual(second);
  expect(first.tables.transaction).toHaveLength(100);
  expect(
    new Set(first.tables.transaction.map((t) => t.transaction_id)).size,
  ).toBe(100);
  const accounts = new Map(first.tables.account.map((a) => [a.account_id, a]));
  const methods = new Map(
    first.tables.payment_method.map((m) => [m.method_id, m]),
  );
  const devices = new Set(
    first.tables.device_fingerprint.map((d) => d.device_id),
  );
  for (const tx of first.tables.transaction) {
    expect(accounts.get(tx.account_id)?.currency_code).toBe(tx.currency_code);
    expect(methods.get(tx.method_id!)?.account_id).toBe(tx.account_id);
    expect(devices.has(tx.device_id)).toBe(true);
    expect(tx.description).toContain("Synthetic");
    if (tx.currency_code === "INR") expect(tx.exchange_rate).toBe("1.00000000");
  }
  expect(first.manifest.fx.assignments.length).toBeGreaterThan(0);
  expect(
    new Set(first.tables.transaction.map((t) => t.transaction_id.slice(0, 8)))
      .size,
  ).toBeGreaterThan(90);
  expect(first.manifest.synthetic).toBe(true);
  expect(() => demoOptions({ ...options, transactions: 50001 })).toThrow();
  expect(() => demoOptions({ ...options, days: 0 })).toThrow();
});
test("fetches only the fixed provider and validates coverage before accepting an observation set", async () => {
  let called = "";
  const fx = await fetchReferenceSnapshot("2026-01-02", 3, async (url) => {
    called = String(url);
    return new Response(csv);
  });
  expect(new URL(called).pathname).toBe("/v2/providers/ecb/rates.csv");
  expect(fx.provider).toBe("ecb");
  await expect(
    fetchReferenceSnapshot(
      "2026-01-02",
      3,
      async () => new Response("unavailable", { status: 503 }),
    ),
  ).rejects.toThrow();
  await expect(
    fetchReferenceSnapshot("2026-01-20", 3, async () => new Response(csv)),
  ).rejects.toThrow();
});
