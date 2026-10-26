# Financial guards and query indexes

[`030_financial_guards.sql`](../migrations/030_financial_guards.sql) enforces paired geographic coordinates, one primary address per customer and retained transaction/signal facts. It applies after financial storage and the [operational schema](operational-schema.md). Currency, amount and method/account checks remain owned by [migration 010](financial-baseline.md).

Latitude and longitude must both be absent or both present, within -90 to 90 and -180 to 180 respectively. PostgreSQL range comparisons reject nonfinite numeric coordinates. The partial unique address index allows multiple nonprimary addresses and at most one primary address per customer.

Statement triggers reject every transaction/signal `UPDATE`, `DELETE` and `TRUNCATE`, including zero-row statements. Existing facts cannot be rewritten during seed retries or score retries. The migration owner can administratively disable triggers; production code must use a separate nonowner role. Runtime/service provisioning and protected command execution remain migration 050 work.

## Index evidence

[`tests/financial-verification.mjs`](../tests/financial-verification.mjs) inserts 10,000 synthetic plan fixtures spread over 100 accounts, merchants and devices, then runs `ANALYZE` and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. It asserts planner-selected indexes without disabling sequential scans. Local native PostgreSQL 17.11 selected these indexes:

| Query | Index | Purpose |
|---|---|---|
| Latest 25 transactions | `transaction_cursor` | Stable descending occurrence/UUID order |
| Latest 25 for an account | `transaction_account_activity` | Account equality and occurrence/UUID order |
| Latest 25 for a merchant | `transaction_merchant_activity` | Related merchant activity |
| Latest 25 for a device | `transaction_device_activity` | Related device activity |
| Rare description term | `transaction_description_search` | GIN over the generated English search vector |

`account_customer_lookup` and `payment_method_account_lookup` support customer/account and account/method equality joins. Existing primary keys cover subject lookups. Existing unique `(method_id, account_id)` and `(transaction_id, rule_id)` indexes cover their leading-key lookups and signal aggregation; no duplicate indexes are added for those paths. Plans depend on data distribution and are fixture evidence, not production latency guarantees.

## Isolated verification

Use PostgreSQL 17 with a fresh local database ending in `_test`, owned by a non-superuser migrator. Set the test URL/opt-in from [development setup](development-setup.md). An administrator must also provision a nonowner, non-superuser test role and grant role membership to the test migrator. The SQL suite temporarily grants that role attempted financial DML privileges inside its rolled-back fixture transaction; it installs no production runtime grants.

With matching libpq variables and the test role name, run:

```powershell
npm run db:migrate:test
npm run db:migrate:test
psql -X -v ON_ERROR_STOP=1 -v runtime_role=finsight_finance_runtime -f tests/sql/financial_guards.sql
node --env-file-if-exists=.env.local tests/financial-verification.mjs
```

The SQL suite checks method/account mismatches, missing parents, bad money/rates, coordinates and primary uniqueness. It proves runtime permission denials, then grants test-only attempted DML and proves retained-fact triggers still reject writes, truncation and trigger disabling. Its fixtures and grants roll back.

The Node verifier requires an empty transaction table and retains its synthetic data in the disposable database. Use a new isolated database for each run. Two connections contend for the same account row: one 700-unit debit from 1000 commits, the second sees 300 and fails the nonnegative check. A separate injected failure rolls back both balance and transaction insertion. These are isolated posted-card fixtures; broader ingestion/status/reversal semantics and payment execution are not implemented.

Local verification used Node 24.15.0 and PostgreSQL 17.11. SQL guard tests, contention/rollback checks and all five plan assertions passed. The [financial guard workflow](../.github/workflows/financial-guards.yml) runs the same checks against a disposable PostgreSQL 17 service.
