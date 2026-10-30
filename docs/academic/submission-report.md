# FinSight: academic submission report

Project title: **FinSight**
Team members: **Shrikar Desai** and **Shreyas P Kulkarni**
Repository: [KadakWNL/finsight](https://github.com/KadakWNL/finsight)

## Purpose and architecture

FinSight supports synthetic financial transaction review and traceable investigation. Analysts discover transactions, inspect recorded risk signals and device telemetry, and manage cases with retained history. Administrators preview and confirm bounded deletion of old unusable sessions.

Next.js App Router, React and TypeScript provide pages, route handlers and server actions. PostgreSQL 17 stores financial facts, rules/signals, users/sessions, cases/events and cleanup audits. MongoDB stores heterogeneous telemetry. NextAuth Credentials authentication uses Argon2id passwords and encrypted cookie tokens linked to persisted PostgreSQL sessions. Runtime authority is separate from the migration owner. Exact dependency versions are pinned in `package-lock.json`.

All demonstration data is synthetic. This project does not establish fraud-detection accuracy, production banking readiness or load performance. Vector retrieval, Mongo notes/recovery, rule editing and redaction remain deferred.

## Implemented relational inventory and diagrams

The [schema catalog](../printable/schema-catalog.json) and seven migrations define 17 application tables:

`customer`, `address`, `account`, `payment_method`, `merchant`, `device_fingerprint`, `transaction`, `risk_rule`, `risk_signal`, `fraud_scenario`, `transaction_label`, `app_user`, `investigation_case`, `app_session`, `case_command_receipt`, `case_event`, `app_session_cleanup`.

`schema_migrations` is tooling metadata and `v_transaction_risk` is a derived view. The catalog contains 161 SQL attributes across these 19 objects and 20 declared foreign keys. `app_session_cleanup.candidate_session_ids` is an audit UUID-array snapshot, not an FK. Cross-database UUID references are application-validated.

Use the [current print masters](../printable/README.md). Both are single-page A4 landscape, titled FinSight, with Shrikar Desai and Shreyas P Kulkarni. This documentation change alters no schema or telemetry properties. Regenerate and visually inspect diagrams if the model changes before demonstration.

## Application workflows

| Workflow | Implemented behavior | Reference |
|---|---|---|
| Authentication | Current-role/session checks, idle and absolute expiry | [Authentication](../authentication.md) |
| Discovery | Risk/status/time/amount/context filters, sorting, signed cursors | [Discovery UI](../discovery-ui.md) |
| Transaction detail | Original/base amounts, signal evidence, masked context and device telemetry | [Transaction API](../transaction-api.md) |
| Investigation | Creation, assignment, guarded lifecycle, version conflicts and typed history | [Case UI](../case-ui.md) |
| Administration | Audited bounded deletion of old unusable sessions | [Cleanup contract](../session-cleanup-contract.md) |

### Risk scoring

There are two seeded rules, defined in `scripts/financial-seed.mjs`:

| Rule | Threshold | Points |
|---|---|---|
| `AMOUNT_BASE_GTE` | INR base amount at least 10,000 | 40 |
| `MERCHANT_TIER_GTE` | Merchant tier code at least 2 (high) | 25 |

`score_transaction` records applicable signals once; `v_transaction_risk` aggregates them. Transaction `30000000-0000-0000-0000-000000000106` is USD 125 at synthetic fixture rate 80, giving INR 10,000, two signals and score 65 (high). Transaction ending `101` is the USD 10 control with no signals and score zero. These eight fixtures use fixed regression rates. The optional larger generator uses historical ECB rates and different UUIDs.

### Case and retention guards

`execute_case_command` checks authority, ownership, transition, expected version and idempotency. `case_one_active_transaction` enforces one active case per transaction. `case_event` stores types including `created`, `assigned` and `status_change`. Migration 050 implements `case_event_immutable_row` and `case_event_immutable_stmt` using `reject_case_event_mutation`. Retained evidence records owner event UPDATE rejection (55000) and runtime DELETE rejection (42501).

### Application SQL DELETE

An active admin previews at most 100 sessions whose earliest idle expiry, absolute expiry or nonnull revocation was over seven days before preview. The preview expires after ten minutes. Confirmation rechecks eligibility, deletes captured eligible candidates and commits the exact deleted count with audit completion. Replay does not delete again. Runtime has no direct session DELETE grant. Financial facts, users, signals, cases, events, receipts and cleanup audits remain retained.

The [SQL transcript](2026-10-30-sql-results.json) records rollback restoration, one committed session deletion, idempotent replay, two surviving active/recent sessions and unchanged protected row counts. The [owner decision](delete-scope-decision.md) accepts this workload and removes separate instructor DELETE approval. No new instructor review is required.

### MongoDB

`device_telemetry` has a strict validator for `connection_telemetry` and `client_environment`, compound indexes and bounded aggregation. The server first resolves the SQL device and transaction timestamp. The most recent 100 qualifying observations bound the summaries. Projected fields exclude raw secrets; unreachable MongoDB yields unavailable telemetry while relational workflows remain usable. The pinned run records six observations of each shape and invalid-document rejection code 121. [Mongo telemetry](../mongo-telemetry.md) owns exact properties and pipeline details.

## Academic evidence

The [requirement-to-command matrix](../academic-verification.md#commands-and-result-matrix) maps transactions/rollback, aggregate views, protected functions, immutable triggers, indexing/query plans, full-text search and Mongo aggregation to executable evidence. Disposable DDL demonstrates CREATE/ALTER/DROP without dropping retained tables. Application workflows and cleanup exercise INSERT, UPDATE, DELETE and SELECT. The grouped financial query includes JOIN, subquery, GROUP BY, HAVING, aggregates and ORDER BY.

The [2026-10-30 execution record](2026-10-30-verification.md) identifies the tested revisions, CI run and environment:

| Check | Result in that pinned run |
|---|---|
| Acceptance | VS01 through VS16 passed |
| Unit / API / database / browser tests | 98 / 88 / 24 / 17 passed |
| Risk fixtures | Eight verified transactions |
| Indexed plans | Five actual planner-selected plans |
| Mongo and contribution checks | Passed with retained results/provenance |

These are execution counts, not coverage percentages. [Raw report](2026-10-30-report.json), [SQL results](2026-10-30-sql-results.json) and [plans](2026-10-30-query-plans.json) remain unchanged historical evidence. Current PR checks must also pass before merge.

## Contributions and review status

The [contribution ledger](contributions.json) pins PRs, merge commits, database issues and paths. Shrikar Desai implemented case guards, authentication/sessions, case APIs/UI, telemetry and cleanup. Shreyas P Kulkarni implemented financial baseline/guards, deterministic risk, discovery UI, acceptance and academic verification, and printable diagrams. Each member must explain their work individually; Git provenance alone does not prove attendance or exclusive authorship.

The raw report predates the DELETE decision and [Shrikar's approval of PR #42](https://github.com/KadakWNL/finsight/pull/42), which records independent inspection and reproduction of case, SQL, Mongo and contribution checks. Issue #18 is closed. Frozen pending fields remain historical; they are not reinterpreted as the upcoming course defense. Final setup, presentation and submission belong to #19.

## Reproduction and course submission

Follow [development setup](../development-setup.md) for roles, secrets, migrations, canonical seed, identities and telemetry. Prepare the synthetic expired session before the [timed demonstration](timed-demonstration.md). Run `npm run test:academic` only against a fresh isolated local `_test` database with its separate runtime role and local MongoDB.

Both members must start the same revision on their systems, rehearse and compare both A4 printouts with the implementation. The announcement allows approximately 30 minutes and awards marks individually. Use exactly FinSight and both registered names. Enter the unique finalized title in the supplied sheet and follow the course PDF privately; it is not redistributed here. Submit the soft copy and compulsory GitHub link only after demonstration. This report does not assert that the lab demonstration or form submission has happened.
