# Academic verification

`npm run test:academic` runs the complete MVP acceptance gate and records additional SQL, MongoDB and contribution evidence. A passing command establishes technical evidence for review. It does not establish instructor acceptance, an independent teammate demonstration or completion of the course submission.

The [2026-10-30 execution record](academic/2026-10-30-verification.md) retains a passing CI run, exact SQL results and indexed plans.

The [session cleanup contract](session-cleanup-contract.md) owns the approved SQL DELETE scope. The [testing contract](development-and-testing-contract.md#6-academic-sqlnosql-scope) owns the selected advanced concepts. Vectors, Mongo notes/recovery, rule mutations and redaction remain deferred; they are not counted as delivered requirements.

## Run the verification

Use Node.js 24, PostgreSQL 17, MongoDB 7, `psql` on PATH and Playwright Chromium. Follow the [MVP isolation prerequisites](mvp-acceptance.md#isolated-prerequisites): a fresh local `_test` database, a non-superuser database owner, a separate `finsight_runtime` login with no owner membership, and the test probe role. The owner must have membership in the runtime and probe roles. Stop other servers for this checkout; the command builds `.next` and uses port 3100.

The PostgreSQL database must be empty. Once the fresh-database check succeeds, the command owns its test schema and resets it between verification layers. Never point it at an application database. A subsequent run needs another empty database.

Set these variables through the environment or ignored `.env.local`:

| Variable | Value | Usage |
|---|---|---|
| `TEST_DATABASE_URL` | Local owner connection to the fresh `_test` database | Migrations, synthetic setup, DDL and trigger probes |
| `ACCEPTANCE_RUNTIME_DATABASE_URL` | Separate `finsight_runtime` login to the same database | Application and protected-writer execution |
| `ALLOW_TEST_DATABASE` | `true` | Explicit isolated-database opt-in |
| `MONGODB_URI` | Single local `mongodb://` server connection | A new run-specific database; configured application database names are not used |

The command generates `finsight_academic_<timestamp>_<random>_test`, verifies it is empty and removes only that run's Mongo database at the end. Remote servers and SRV connections are rejected. Setup credentials must permit creating collections, validators and indexes in the isolated Mongo database; this does not grant write APIs to application users.

```powershell
npm ci
npx playwright install chromium
npm run test:academic
```

Run from a clean committed checkout with full Git history. Contribution verification checks that the pinned merge commits are ancestors of the tested revision and that their listed files exist at those commits. The [CI workflow](../.github/workflows/acceptance.yml) provisions disposable PostgreSQL/Mongo services and fetches the history automatically.

## Commands and result matrix

The command first runs `npm run test:acceptance`, including API/database tests, VS01-VS16, production browser recordings, SQL guards, rollback/concurrency checks and five real indexed query plans. It then runs [the academic SQL demonstrations](../scripts/academic-sql.mjs), using the migration owner for setup and the restricted runtime role for application operations.

| Requirement | Executed command or evidence ID | Required result |
|---|---|---|
| CREATE, ALTER, INSERT, DROP | `ddl-create`, `ddl-alter`, `ddl-insert`, `ddl-drop`, `ddl-drop-check` | One disposable temporary table is created, altered, populated and dropped; retained application tables are not dropped as the DDL demonstration |
| SELECT, JOIN, GROUP BY, HAVING, ORDER BY, aggregates, subquery | `joins-group-having-order` | Group merchants whose signalled transactions meet the count threshold; return ordered transaction counts, INR totals and maximum risk |
| Aggregate risk view | `risk-view` | Eight deterministic transactions; the combined-rule transaction has score 65 |
| Guarded stored function and meaningful INSERT/UPDATE | `guarded-case-insert`, `guarded-case-update`, `case-history` | Runtime creates an analyst-owned case, starts review, increments version to 2 and retains three typed events |
| Immutable trigger and least privilege | `immutable-event-trigger`, `runtime-event-mutation-denied` | Owner UPDATE is rejected with SQLSTATE 55000; runtime DELETE is rejected with 42501 |
| Atomic transaction and ROLLBACK | `cleanup-inside-rolled-back-transaction`, `rollback-restored-session-and-audit` | A tentative deletion is undone; three sessions remain and the preview has no completion facts |
| Application SQL DELETE | `cleanup-preview`, `cleanup-committed-delete`, `cleanup-replay` | One session unusable for over seven days is deleted and audited; replay returns the original count |
| Denials and retained data | `runtime-direct-delete-denied`, `analyst-cleanup-denied`, `cleanup-retained-active-recent-sessions`, `protected-row-counts` | Direct runtime/analyst deletion paths denied; two active/recent sessions survive; protected financial, risk, user, case, event and receipt counts match |
| Indexes/EXPLAIN and full-text search | `indexes-and-full-text-search`; `query-plans.json` | Five planner-selected indexes, including the GIN description-search index, appear in actual execution plans |
| Mongo document model and aggregation | `mongo-heterogeneous-validator-and-aggregation` | The SQL-resolved device has six connection and six environment observations; empty payload insertion fails with Mongo code 121 |
| Application SQL-to-Mongo integration | Required tests from `tests/api/telemetry.test.ts` | SQL subject/reference checks, time bound, masked projection and offline fallback execute and pass |
| Cleanup API/database/browser integration | Required tests from `tests/api/session-cleanup.test.ts`, `tests/db/session-cleanup.test.ts`, `tests/e2e/session-cleanup.spec.ts` | Required tests pass without skips or browser retries |
| Both teammates' source contributions | `merged-contribution-provenance` | At least two substantial database issues plus application/test changes are documented per teammate; merge ancestry and committed file paths verified |

Transactions/rollback, aggregate views, protected functions, immutable triggers, indexing/query plans and full-text search provide six selected SQL concepts. Mongo aggregation supplies the separate document-database concept. The demonstrations use synthetic data and do not claim production performance or fraud-detection accuracy.

## Retained artifacts

`test-results/academic/latest.json` locates the run directory. Each run writes:

- `report.json`: technical checks, tested commit/source hashes, migration checksums, required test names, Mongo pipeline/results, contribution provenance and pending human gates.
- `sql-results.json`: executed SQL and actual result rows or expected SQLSTATE denials. Bound parameter values and connection strings are omitted.
- `query-plans.json`: the five actual execution plans from the MVP harness.
- `report.md`: a compact result matrix.

The related MVP run retains production browser recordings and its scenario matrix. CI uploads `academic-verification-evidence` and `mvp-acceptance-evidence` for 14 days. Preserve the sanitized report and plans in the repository for review; raw test logs, credentials, cookies, authentication traces and local PDF stay out of commits.

## Contribution evidence and review handoff

The [contribution ledger](academic/contributions.json) records GitHub PR authors, merge SHAs and changed files, retrieved from the merged PR records. A PR may contain later review fixes from another contributor; authorship here does not claim exclusive authorship of every line.

| Member | Substantial database issues | Application and testing evidence |
|---|---|---|
| KadakWNL | [#6 / PR #27](https://github.com/KadakWNL/finsight/pull/27), [#7 / PR #29](https://github.com/KadakWNL/finsight/pull/29), [#10 / PR #30](https://github.com/KadakWNL/finsight/pull/30): financial schema, invariants/indexes, deterministic risk SQL | [PR #35](https://github.com/KadakWNL/finsight/pull/35): discovery workspace and browser checks; [PR #39](https://github.com/KadakWNL/finsight/pull/39): complete acceptance harness and evidence |
| ShrikarDesai07 | [#9 / PR #31](https://github.com/KadakWNL/finsight/pull/31), [#17 / PR #40](https://github.com/KadakWNL/finsight/pull/40), [#23 / PR #41](https://github.com/KadakWNL/finsight/pull/41): guarded case functions/privileges, Mongo telemetry, audited session cleanup | [PR #32](https://github.com/KadakWNL/finsight/pull/32), [PR #34](https://github.com/KadakWNL/finsight/pull/34), [PR #37](https://github.com/KadakWNL/finsight/pull/37): authentication, case APIs/UI and associated tests |

Shrikar's independent review should run the command from a fresh checkout/database and record the tested commit, actual command result and any defects. He should demonstrate case creation/transition through `execute_case_command`, direct runtime-write denial, immutable events and rollback, then review the grouped financial query, deterministic risk view and indexed plans. This is a requested demonstration checklist, not a claim that it has happened.

## Missing items and defect triage

Instructor acceptance of the expired-session DELETE workload is not confirmed. The project owner considers the workload sufficient and approved its scope, but that is recorded separately from instructor approval. Shrikar's independent case-function demonstration and review of the financial evidence are also pending. The generated report always keeps these human gates separate from its technical result.

Any failed/missing required technical check blocks the command. A report is evidence only for its pinned source and environment. Retain failures as defects with commands and responsible workstreams; do not weaken ownership denials, constraints or required tests to obtain a pass. Final documentation, timed demonstration, title/team confirmation and submission evidence remain under [#19](https://github.com/KadakWNL/finsight/issues/19) and course review. [#18](https://github.com/KadakWNL/finsight/issues/18) remains open until its required human gates are recorded.
