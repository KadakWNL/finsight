# Financial baseline

`migrations/010_financial_baseline.sql` implements the eleven financial and risk-storage tables from the [canonical ER inventory](er-diagram.mmd). It supplies keys and fixed-scale money storage, without operational tables, scoring, application routes or runtime grants. The [currency contract](architecture-gaps.md#reporting-currency-contract) owns INR/USD semantics; the [development contract](development-and-testing-contract.md#2-sql-migration-contract) owns migration order.

## Schema boundary

Use lowercase unquoted PostgreSQL names, including `public.transaction`. UUIDs are supplied by callers. The ER dictionary lists fields; SQL defines executable types, nullability and defaults. The table below records optional fields; all other columns are required. Generated columns derive solely from required source values.

| Table | Optional fields | Keys and implementation notes |
|---|---|---|
| `customer` | `user_id`, `full_name`, `date_of_birth`, `email`, `phone`, `kyc_verified_on` | Unique nullable operator link; its FK waits for `APP_USER` in migration 020 |
| `address` | `state`, `postal_code`, `latitude`, `longitude` | Required customer; primary-address uniqueness and coordinate guards wait for 030 |
| `account` | None | Unique number; INR/USD, finite nonnegative balance; unique account/currency target |
| `payment_method` | `last4`, `expiry_date` | Required account; unique method/account target supports composite transaction FK |
| `merchant` | `city`, `latitude`, `longitude` | Required name/category/country/tier; coordinate guards wait for 030 |
| `device_fingerprint` | `first_seen_country` | Unique hash; variable-length OS family supports readable synthetic categories |
| `transaction` | `method_id`, `merchant_city`, `latitude`, `longitude` | Required merchant/device, same-currency account FK and optional same-account method FK |
| `risk_rule` | None | Unique code, finite nonnegative threshold, integer weight 0-100, positive version |
| `risk_signal` | None | Unique transaction/rule; finite nonnegative observation; integer contribution 0-100, including zero |
| `fraud_scenario` | None | Unique synthetic scenario code |
| `transaction_label` | None | Transaction primary/FK; one scenario per labeled transaction; evaluation data only |

Money and balances use `numeric(20,2)`, and rates use `numeric(20,8)`. INR rates must equal one. Stored generated `amount_base` uses rounded INR conversion; overflow fails. Generated English `search_vector` supports later query/index work. PostgreSQL fixed-scale fields coerce decimal inputs, so input precision must be validated before coercion by later ingestion/API work. This migration does not claim to reject excess precision before that boundary exists.

Transactions are restricted to the approved `card_payment` slice. Other transaction kinds need separately reviewed semantics. Payment-method catalog vocabulary retains the ER values without adding transfer execution. All parent references use `ON DELETE RESTRICT`. No table privileges are granted to PUBLIC or to application/service roles. A migration owner can still edit its tables; financial immutability guards and scoped runtime permissions remain later migrations.

Migration 020 can reference `transaction.transaction_id`, add `CUSTOMER.user_id`'s operator FK and create operational relationships. Migration 030 owns financial immutability, coordinates, row-lock guards and additional indexes; migration 040 owns deterministic seeds/scoring. No vector, redaction or cleanup table is included here. No test storage probe represents successful rule evaluation or VS04/VS05 acceptance.

## Isolated verification

Use a fresh disposable PostgreSQL 17 database owned by a dedicated non-superuser migration login. Set standard libpq variables `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` locally. Never run these test fixtures against retained/shared financial data.

```powershell
psql -v ON_ERROR_STOP=1 --single-transaction -f migrations/010_financial_baseline.sql
psql -v ON_ERROR_STOP=1 -f tests/sql/financial_baseline.sql
```

The first command wraps the migration in a transaction. The SQL file contains no transaction wrappers because the reviewed migration runner owns that boundary. After the scaffold runner is merged, use `npm run db:migrate` with the dedicated migrator connection for ledger/checksum handling. Do not reapply the SQL manually to an existing database or edit an applied migration.

The second command inserts synthetic storage probes, checks expected SQLSTATE failures and rolls back its fixtures. It covers all eleven tables, two transactions sharing a method, a null method, rounded USD conversion, nonfinite/negative amounts and rates, generated-base overflow/write rejection, unsupported currency/type, account/method mismatch, required relationships, once-only signals/labels, restrictive deletion and absence of PUBLIC table grants. The dedicated [financial baseline workflow](../.github/workflows/financial-baseline.yml) runs the same commands against a disposable PostgreSQL 17 service.
