# Reproducible demo dataset and historical conversion

The commands in `scripts/demo-cli.mjs` add bounded synthetic activity using saved historical USD-to-INR reference rates. They keep the [eight canonical regression scenarios](deterministic-risk.md) intact. No upstream dataset, customer records or simulator code is imported.

## Run the import

Configure the local database using [development setup](development-setup.md). Apply migrations through 055 and use a non-superuser migrator connection to a local database ending in `_demo` or `_test`. Set `ALLOW_SYNTHETIC_SEED=true` explicitly.

```powershell
npm run demo:fx -- --out=data/local/fx-2026-q1.json
npm run demo:import -- --snapshot=data/local/fx-2026-q1.json --manifest=data/local/demo-2026-q1.manifest.json
npm run demo:import -- --snapshot=data/local/fx-2026-q1.json --manifest=data/local/demo-2026-q1.manifest.json
```

The FX command fetches a CSV from [Frankfurter's ECB provider endpoint](https://frankfurter.dev/#rates-by-provider). The import commands use the saved file without a network request. Local snapshots and manifests under `data/local` are ignored by Git. Output files are created without overwriting existing content; use another snapshot path to capture another provider response.

The manifest describes the generated input and its rate assignments. It is written before database execution and does not prove that an import committed. Only a successful import command confirms the database transaction. An existing identical manifest supports retries; different content requires another manifest path.

## Dataset and command options

The original generator creates linked customers, synthetic addresses, currency-matched accounts/cards, devices, merchants and card transactions. Names carry `Synthetic` or `Demo` labels, emails use `synthetic.invalid`, and method tokens are explicitly noncredentials. UUIDs come from a deterministic namespaced hash rather than the canonical fixture prefix.

| Option | Commands | Default | Usage and bounds |
|---|---|---|---|
| `--seed` | import | `finsight-2026-q1` | 1-64 letters, digits, underscores or hyphens; determines identities and random sequence |
| `--start` | fx, import | `2026-01-01` | Valid UTC calendar date; begins the generated interval |
| `--days` | fx, import | `90` | 1-365 days; interval must finish before today |
| `--transactions` | import | `10000` | 1-50000 transaction rows |
| `--customers` | import | `500` | 1-5000 customers, no more than transaction count; two currency accounts, cards and devices per customer |
| `--merchants` | import | `100` | 1-1000 merchants with fixed low/medium/high tiers |
| `--out` | fx | Required | New local FX snapshot file |
| `--snapshot` | import | Required | Previously saved snapshot covering the generated interval |
| `--manifest` | import | Required | New or identical local generation manifest |

Use `--name=value` syntax. Unknown or repeated options fail. Different dimensions with the same seed may conflict with existing retained facts; use a new seed for a different dataset.

Activity includes recurring customer merchants, varying amounts, a small overnight share and posted/pending/reversed/blocked records. The two existing rules score recorded facts. The maximum available score remains the sum of those rules; this generator does not invent critical outcomes or new detection dimensions.

The generator assigns no ground-truth fraud labels. Its distributions support demonstration and query testing, not claims about real fraud prevalence or model accuracy. Opening balances are fixture facts rather than a replay of payment execution. The [Fraud Detection Handbook simulator](https://fraud-detection-handbook.github.io/fraud-detection-handbook/Chapter_3_GettingStarted/SimulatedDataset.html) is useful background for future behavioral simulation; this implementation is an independent generator.

## Reference-rate policy

`scripts/demo-fx.mjs` fetches only the fixed Frankfurter HTTPS origin and ECB CSV path. Requests have a timeout, reject redirects and limit response size. CSV validation preserves decimal rate text and rejects invalid dates, pairs, nonpositive values and precision beyond the existing `numeric(20,8)` contract.

For a transaction's UTC date, conversion uses the latest available observation strictly before that date, with a maximum age of seven days. This avoids using a daily rate published after an early transaction on the same day. Missing coverage stops generation; the importer never substitutes today's rate or a fabricated fallback. INR rows use exactly one.

These are daily reference conversions, not executed bank or card settlement rates. The transaction stores its selected exact `exchange_rate`; PostgreSQL generates rounded `amount_base`. Later imports do not recalculate retained financial facts.

The snapshot records the provider, source URL, retrieval time and ordered observations. Its SHA-256 digest covers the provider, currency pair and observations, not retrieval metadata or source authentication. The manifest records the observation date and rate for every generated USD transaction. Preserve both local artifacts to reproduce the import and inspect provenance; provenance is not added to the public transaction API or a new SQL table.

## Integrity and verification

`scripts/demo-import.mjs` uses one database transaction and the canonical seed advisory lock. It validates table fields, inserts bounded parameterized batches, checks retained facts and calls the existing guarded scorer. Conflicts and scoring failures roll back the entire import. Reruns preserve signal identities, evidence and recording times; mismatched existing evidence is rejected rather than rewritten.

Run `npm run lint`, `npm run typecheck`, `npm run test:unit` and `npm run test:api` in the isolated test environment. `tests/unit/demo-dataset.test.ts` checks exact rates, stale and future-date refusal, reproducibility, relationships and provider failures. `tests/api/demo-import.test.ts` checks decimal storage, retries, fact conflicts, scoring-stage rollback and immutable-evidence conflicts against PostgreSQL.
