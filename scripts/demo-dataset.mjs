import { createHash } from "node:crypto";
import { isoDay, shiftDay, rateForDay, validateSnapshot } from "./demo-fx.mjs";

export const GENERATOR_VERSION = "finsight-demo-1";
export function demoId(seed, kind, index) {
  const bytes = createHash("sha256")
    .update(`${GENERATOR_VERSION}:${seed}:${kind}:${index}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function demoOptions(input = {}) {
  const options = {
    seed: "finsight-2026-q1",
    start: "2026-01-01",
    days: 90,
    transactions: 10000,
    customers: 500,
    merchants: 100,
    ...input,
  };
  if (
    typeof options.seed !== "string" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(options.seed)
  )
    throw new Error(
      "Seed must contain 1-64 letters, digits, underscores or hyphens.",
    );
  isoDay(options.start);
  for (const [key, max] of [
    ["days", 365],
    ["transactions", 50000],
    ["customers", 5000],
    ["merchants", 1000],
  ])
    if (
      !Number.isSafeInteger(options[key]) ||
      options[key] < 1 ||
      options[key] > max
    )
      throw new Error(`Invalid demo ${key} bound.`);
  if (
    shiftDay(options.start, options.days - 1) >=
    new Date().toISOString().slice(0, 10)
  )
    throw new Error("Demo dates must be in the past.");
  if (options.customers > options.transactions)
    throw new Error("Use at least one transaction per customer.");
  return options;
}
function randomGenerator(seed) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE();
  return (max) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * max);
  };
}
const places = [
  ["Bengaluru", "Karnataka", "560001"],
  ["Mumbai", "Maharashtra", "400001"],
  ["Pune", "Maharashtra", "411001"],
  ["Hyderabad", "Telangana", "500001"],
  ["Chennai", "Tamil Nadu", "600001"],
];
const shops = [
  ["Copper Leaf Market", "5411"],
  ["Riverbend Electronics", "5732"],
  ["Orchard Books", "5942"],
  ["Cedar Travel", "4722"],
  ["Willow Apparel", "5691"],
  ["Harbor Kitchen", "5812"],
  ["Meadow Pharmacy", "5912"],
  ["Maple Services", "7399"],
];
const cents = (value) =>
  `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
export function buildDemoDataset(input, snapshot) {
  const options = demoOptions(input);
  validateSnapshot(snapshot);
  const random = randomGenerator(options.seed);
  /** @type {{customer: Array<Record<string,string>>,address: Array<Record<string,string|boolean>>,account: Array<Record<string,string>>,payment_method: Array<Record<string,string>>,merchant: Array<Record<string,string|boolean>>,device_fingerprint: Array<Record<string,string>>,transaction: Array<Record<string,string>>}} */
  const tables = {
    customer: [],
    address: [],
    account: [],
    payment_method: [],
    merchant: [],
    device_fingerprint: [],
    transaction: [],
  };
  const key = (kind, n) => demoId(options.seed, kind, n);
  const referenceByDay = Object.fromEntries(
    Array.from({ length: options.days }, (_, n) => {
      const day = shiftDay(options.start, n);
      return [day, rateForDay(snapshot, day)];
    }),
  );
  for (let n = 0; n < options.customers; n++) {
    const [city, state, postal] = places[n % places.length];
    tables.customer.push({
      customer_id: key("customer", n),
      full_name: `Synthetic customer ${n + 1}`,
      email: `customer_${n + 1}@synthetic.invalid`,
      country_code: "IN",
      status: "active",
    });
    tables.address.push({
      address_id: key("address", n),
      customer_id: key("customer", n),
      line1: `Synthetic address ${n + 1}`,
      city,
      state,
      postal_code: postal,
      country_code: "IN",
      is_primary: true,
    });
    for (const [slot, currency] of ["INR", "USD"].entries()) {
      const index = n * 2 + slot;
      tables.account.push({
        account_id: key("account", index),
        customer_id: key("customer", n),
        account_number: `SYN-${key("account", index).slice(0, 8)}-${String(index).padStart(6, "0")}`,
        account_type: n % 5 ? "savings" : "current",
        currency_code: currency,
        balance: "100000.00",
        status: "active",
        opened_at: shiftDay(options.start, -30),
      });
      tables.payment_method.push({
        method_id: key("method", index),
        account_id: key("account", index),
        method_type: "card",
        token: `synthetic-noncredential-${key("method", index)}`,
        last4: String(1000 + random(9000)),
        status: "active",
      });
      tables.device_fingerprint.push({
        device_id: key("device", index),
        device_hash: createHash("sha256")
          .update("synthetic-device:" + key("device", index))
          .digest("hex"),
        os_family: ["Android", "iOS", "Windows", "macOS"][random(4)],
        first_seen_country: "IN",
        first_seen_at: shiftDay(options.start, -30) + "T00:00:00Z",
      });
    }
  }
  for (let n = 0; n < options.merchants; n++) {
    const [name, category] = shops[n % shops.length];
    tables.merchant.push({
      merchant_id: key("merchant", n),
      merchant_name: `Demo ${name} ${n + 1}`,
      category_code: category,
      country_code: "IN",
      city: places[n % places.length][0],
      risk_tier: n % 10 < 7 ? "low" : n % 10 < 9 ? "medium" : "high",
      is_watchlisted: false,
    });
  }
  const fxAssignments = [];
  for (let n = 0; n < options.transactions; n++) {
    const customer = n < options.customers ? n : random(options.customers),
      slot = random(100) < 25 ? 1 : 0,
      index = customer * 2 + slot;
    const merchant =
      random(100) < 65
        ? customer % options.merchants
        : random(options.merchants);
    const day = shiftDay(options.start, random(options.days));
    const hour = random(100) < 5 ? random(6) : 7 + random(16),
      minute = random(60),
      second = random(60);
    const mode = random(100),
      value = slot
        ? mode < 75
          ? 100 + random(8000)
          : mode < 97
            ? 9000 + random(40000)
            : 100000 + random(250000)
        : mode < 75
          ? 10000 + random(790000)
          : mode < 97
            ? 800000 + random(4200000)
            : 7500000 + random(12500000);
    const statusRoll = random(100),
      reference = referenceByDay[day],
      transactionId = key("transaction", n);
    tables.transaction.push({
      transaction_id: transactionId,
      account_id: key("account", index),
      method_id: key("method", index),
      merchant_id: key("merchant", merchant),
      device_id: key("device", index),
      amount: cents(value),
      currency_code: slot ? "USD" : "INR",
      exchange_rate: slot ? reference.rate : "1.00000000",
      direction: "debit",
      txn_type: "card_payment",
      status:
        statusRoll < 96
          ? "posted"
          : statusRoll < 98
            ? "pending"
            : statusRoll === 98
              ? "reversed"
              : "blocked",
      occurred_at: `${day}T${[hour, minute, second].map((x) => String(x).padStart(2, "0")).join(":")}Z`,
      merchant_country_code: "IN",
      merchant_city: tables.merchant[merchant].city,
      description: `Synthetic card purchase at ${tables.merchant[merchant].merchant_name}, ${tables.merchant[merchant].city}`,
    });
    if (slot)
      fxAssignments.push({
        transaction_id: transactionId,
        reference_date: reference.date,
        rate: reference.rate,
      });
  }
  const manifest = {
    format: 1,
    generator: GENERATOR_VERSION,
    synthetic: true,
    options,
    counts: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.length]),
    ),
    fx: {
      provider: "ecb",
      source_url: snapshot.source_url,
      snapshot_sha256: snapshot.sha256,
      policy:
        "Latest available observation strictly before the UTC transaction date; maximum age 7 days. Daily reference conversion, not bank settlement.",
      assignments: fxAssignments,
    },
    limitations: [
      "Synthetic activity, not real bank records or a calibrated fraud benchmark.",
      "Opening balances are fixture facts, not a replay of payment execution.",
      "Device and customer details are fabricated. No ground-truth fraud labels are assigned.",
    ],
  };
  return { tables, manifest };
}
