# Deterministic financial seed and risk SQL

[`040_deterministic_risk.sql`](../migrations/040_deterministic_risk.sql) implements the two formulas accepted in [PR #21](https://github.com/KadakWNL/finsight/pull/21). The [formula contract](risk-formula-contract.md) owns the exact scenario matrix, observations, weights and score bands. This implementation is a synthetic demonstration without production fraud calibration.

## Seed and scoring commands

Use a local PostgreSQL 17 database ending in `_demo` or `_test`, owned by a dedicated non-superuser migrator. Set `MIGRATOR_DATABASE_URL` and explicitly set `ALLOW_SYNTHETIC_SEED=true` in an ignored `.env.local` or in the process environment. [Development setup](development-setup.md) owns the connection-variable inventory. Run:

```powershell
npm run db:migrate
npm run db:seed
npm run db:seed
```

The seed transaction takes an advisory lock and inserts deterministic IDs for a customer, INR/USD accounts and methods, three merchant tiers, one device, eight transactions, two rules and evaluation-only scenario labels. Every conflict checks the existing facts against the expected values and aborts on disagreement. Final verification checks each canonical transaction's score, count, observations, contributions and evidence before commit. Reruns preserve financial facts, signal IDs, evidence and recording times. No credentials or human operator identities are seeded. Financial balances are fixture facts; these historical transactions do not simulate payment execution or recalculate balances.

`score_transaction(uuid)` locks the subject row, checks the merchant input, and validates both rule definitions before writing either signal. Only the two approved version-one codes are accepted. Thresholds and dimensions must match their formula units. Disabled definitions are validated and then skipped. Matching zero-weight rules still record a signal. All numeric source amounts come from database facts; no evaluation label enters a predicate.

Rule configurations and merchant tiers are frozen by guards. Changing formulas, enabling/disabling stored rules or changing tiers requires a separately reviewed design. Disabled/zero-weight verification uses separate fresh fixture transactions, rather than changing rules after scoring. Once-only uniqueness and conflict-safe inserts preserve an existing signal; no rescoring revision mechanism is installed.

The `v_transaction_risk` view starts from every transaction and left joins signals, returning decimal `risk_score`, integer `signal_count` and a derived band. Raw sums are uncapped. A zero count means "No recorded signals", without asserting safety or evaluation completeness. Missing telemetry/location does not affect the two predicates; device, location, time and frequency remain unevaluated.

## Query boundary

[`src/server/financial-queries.ts`](../src/server/financial-queries.ts) exports server-only parameterized reads. These are SQL modules; authentication and HTTP routes remain later work.

| Function | Parameters/defaults | Usage |
|---|---|---|
| `listTransactions` | Client; optional `limit` default 25, maximum 100; occurrence/UUID cursor; account/merchant UUID; description query up to 500 characters; risk band | Stable descending explorer pages with joined merchant/risk facts. Full-text input uses bound `plainto_tsquery`. |
| `transactionRiskDetail` | Client; transaction UUID | Monetary facts and stored signals, observations, contributions, evidence and recording times; null if absent. |
| `merchantRiskSummary` | Client; minimum flagged count default 1; limit default 25, maximum 100 | JOIN/GROUP BY/HAVING/subquery demonstration ordered by raw recorded points. |

Amounts, rates, observations, contributions and scores remain decimal strings from the PostgreSQL driver, including values explicitly cast to text before JSON signal aggregation. Counts are integers. Explorer occurrence timestamps use UTC strings retaining microseconds for cursor comparisons. Detail reads use one SQL snapshot for totals and signals, and label joined rule settings and merchant tier as current configuration. Stored evidence records the firing observation. Projections exclude evaluation labels, payment tokens, account numbers and customer PII. No case ownership/history projection is included.

PUBLIC has no scoring/banding function or risk-view privileges. Runtime/service grants belong to migration 050. A separate nonowner application connection must receive only the approved read/function permissions there.

## Verification

Use a fresh local disposable PostgreSQL 17 database owned by a non-superuser login. Set `TEST_DATABASE_URL` and `ALLOW_TEST_DATABASE=true` per development setup, then run:

```powershell
npm run db:migrate:test
npm run db:migrate:test
node --conditions=react-server tests/risk-verification.mjs
```

The server condition loads the server-only SQL module in the standalone Node verifier. This verifier requires an empty transaction table and retains synthetic data. Use another fresh database to repeat it. The [risk workflow](../.github/workflows/deterministic-risk.yml) runs these commands and two seed CLI passes.

Local Node 24.15.0/PostgreSQL 17.11 verification passed the eight exact fixture results, seven signal rows, decimal-string queries, no-signal preservation, disabled/zero-weight behavior, invalid rule rejection, concurrent duplicate prevention, failed-second-signal rollback, seed conflicts, raw score boundaries, label exclusion, bounded FTS/cursor reads and merchant aggregate results. A failed seed rolls back all financial inserts and signals. These checks establish database behavior; they do not establish authenticated APIs or VS01-VS16 completion.
