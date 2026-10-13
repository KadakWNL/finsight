# Development, Migration, Testing, and Academic-Scope Contract

- **Status:** Proposed for cross-review — not approved and not implemented.
- **Related work:** [Issue #4](https://github.com/KadakWNL/finsight/issues/4)
- **Decision owner:** ShrikarDesai07 · **Cross-review:** KadakWNL
- **Prepared:** 2026-10-13

This is the proposed team contract for repeatable local development and safe parallel work. The commands below are planned interfaces; they cannot run until issue #5 creates the package scripts and test harness.

## 1. Shared toolchain

| Area | Proposed choice | Rule |
|---|---|---|
| Runtime | Node.js 24 LTS for the initial scaffold | Pin the agreed major in the runtime file and CI. Upgrade only through a reviewed PR. |
| Package management | npm with committed `package-lock.json` | Use `npm ci` for clean installs; do not commit `node_modules` or add a second lockfile. |
| Web app | Next.js App Router + TypeScript + Tailwind + shadcn/ui | One shared scaffold; shell contracts are reviewed before case UI depends on them. |
| SQL access | PostgreSQL 17 + maintained `node-postgres` (`pg`) driver; hand-written parameterized SQL, no ORM | Keep the same PostgreSQL major in developer/test/CI environments. The first slice does not depend on pgvector. |
| Migrations | Ordered SQL files applied by a small reviewed Node migration runner | See section 2. No schema edits by manual clicking in shared environments. |
| Unit/integration tests | Vitest | One runner for TypeScript validation/logic, database integration, API contracts, and failure cases. |
| Browser tests | Playwright | Exercise real sign-in, transaction pages, case lifecycle, denied access, and conflict recovery. |
| Static quality | ESLint and TypeScript no-emit checking | Both must pass before a PR can be approved. |
| CI | GitHub Actions with a disposable PostgreSQL service | CI runs the same scripts documented for developers. Docker Desktop is not a local prerequisite. |
| Secrets/config | Environment variables and a committed `.env.example` with placeholders only | Never commit `.env`, credentials, session secrets, course PDF, or real customer data. |

Next.js documents Node.js 20.9 as its minimum, so the team should use one pinned supported LTS major rather than relying on each machine's installation: [Next.js installation requirements](https://nextjs.org/docs/app/getting-started/installation). The supported Node release schedule is published at [Node.js Release](https://github.com/nodejs/Release).

## 2. SQL migration contract

### File naming and ownership

Migration filenames use a fixed three-digit sequence and lowercase descriptive name, e.g. `010_financial_baseline.sql`. Files are append-only after merge. Fixes go into a later migration; do not edit an applied migration to make a local database pass.

| Sequence | Scope | Owner | Prerequisites |
|---|---|---|---|
| `010` | Financial baseline: customer/address/account/payment method/merchant/device/transaction/rules/signals/labels; approved INR decimal contract and core keys | KadakWNL | Issues #1 and #4 reviewed; contracts accepted |
| `020` | `APP_USER`, cases with proposed `version BIGINT NOT NULL DEFAULT 1`, typed `CASE_EVENT`, approved `APP_SESSION` and `CASE_COMMAND_RECEIPT` additions; add `CUSTOMER.user_id` FK after `APP_USER` exists | ShrikarDesai07 | Issues #3 and #4; stable keys from 010 |
| `030` | Financial guards, relationship checks, immutable financial facts, selected indexes, and negative SQL tests | KadakWNL | 010 and 020 applied |
| `040` | Deterministic synthetic data, approved scoring SQL/function, `v_transaction_risk`, and transaction/risk query support | KadakWNL | Issue #2 accepted; 030 financial guards reviewed |
| `050` | Protected case commands with guarded `expected_version` checks and atomic version increments, active-assignee/current-actor guards, command/event atomicity, immutability trigger, runtime/service/migrator privileges | ShrikarDesai07 | 020, 030, and 040 applied and cross-reviewed |

No two people edit the same migration concurrently. Before work starts, the owner posts intended files, constraints/functions, and public interfaces in the issue. If a change touches another owner's migration, agree a separate migration or revise the ownership manifest first.

### Runner behavior

The small Node runner should:

1. Discover only files matching the numbered SQL pattern, sort by version, and reject duplicate versions.
2. Maintain a `schema_migrations` ledger with version, filename, SHA-256 checksum, and server-applied timestamp.
3. Acquire a PostgreSQL advisory lock so two developers/CI jobs cannot apply migrations concurrently.
4. For each unapplied migration, run the complete file inside one transaction; insert the ledger row in that same transaction and roll back on failure.
5. Compare checksums for every applied file; fail clearly if a committed migration was edited.
6. Stop at the first failed migration and print a safe error context, not credentials or the connection string.
7. Use a dedicated migrator connection, never the least-privilege application role.

Migration files do not include their own `BEGIN`/`COMMIT` wrappers because the runner owns the transaction boundary. Keep MVP migrations forward-only; use a new corrective migration rather than destructive rollback. Avoid non-transactional DDL in this slice. Destructive schema operations must be limited to disposable test objects and reviewed separately.

### Database roles and reset safety

- **Migrator role:** DDL and controlled schema/seed work; credentials used only by scripts/CI.
- **Runtime application role:** least privilege; not owner/superuser; no direct arbitrary `CASE_EVENT` writes and no bypass of protected case commands.
- **Service role:** separate non-owner, non-superuser connection for approved synthetic ingestion/evaluation jobs. Grant only scoped ingestion/function access; deny operator/session administration, arbitrary case/event writes, and retained financial/history deletion. Record the provisioned system actor for approved job effects; service credentials cannot authenticate through human sign-in.
- **Test setup role:** builds a fresh isolated test database and permits negative privilege tests using the runtime role.
- Use separate app/service/migrator/test connection variables. Runtime and service connection credentials never reach client bundles. Negative permission tests exercise each role separately.
- A reset script may run only against an explicitly named test database with a clear `_test` suffix and an explicit opt-in flag. Refuse ambiguous names and fail if the connection appears to target production. No reset helper is used on a shared database.
- Synthetic seeds have stable identifiers and deterministic scenarios; reruns are safe and never import real customer/bank data.

## 3. Proposed developer commands

These are intended script names for issue #5 to implement; they are not available until the scaffold exists.

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm run test:unit
npm run test:db
npm run test:e2e
npm run build
npm run db:migrate
npm run db:seed
npm run db:migrate:test
npm run test:acceptance
```

Expected setup order: install the pinned runtime; copy `.env.example` to a local environment file; create a local PostgreSQL database and separate runtime/migrator roles; apply migrations; seed only synthetic data; then run checks. Exact environment-variable names and script wiring are finalized in issue #5 after toolchain review. No test is considered passed until an actual command and result are recorded.

## 4. Testing contract and ownership

| Test family | Required evidence | Lead | Cross-review |
|---|---|---|---|
| Authentication/session VS01–VS03 | Active/inactive/system sign-in, expiry/revocation, current role changes, safe redirects, masking | ShrikarDesai07 | KadakWNL |
| Transaction/risk/currency VS04–VS05 | Stable bounded filtering, zero-signal rows, sum/band calculation, INR/USD decimal and FK/amount rejection | KadakWNL | ShrikarDesai07 |
| Case state/history VS06, VS09–VS13 | Creation/assignment events, lifecycle guards, fixed resolution mapping, reopen reset/history retention, ownership denials | ShrikarDesai07 | KadakWNL |
| Idempotency/concurrency/privilege VS07, VS14–VS15 | Same-key replay, changed-payload 409, stale `expected_version` conflict, atomic version increment, simultaneous creates/updates, rollback and immutable events under direct SQL | ShrikarDesai07 leads case tests; KadakWNL leads finance tests | Both inspect VS14–VS15 results |
| Capability gates VS16 | Proposed operator/rule/redaction/cleanup mutation routes are absent or non-mutating; no false success | Both | Both |
| UI/accessibility | Keyboard-only lifecycle, focus/labels, empty/loading/error/401/403/404/409 handling, draft preservation | Each screen owner | Teammate |
| MongoDB workload | Validators/indexes, two heterogeneous synthetic telemetry shapes, bounded aggregation, SQL-reference authorization, partial-failure behavior | ShrikarDesai07 | KadakWNL |
| Final acceptance/report | Actual commands/results, defects, fixtures, machine setup, individual contribution evidence | Both | Cross-review |

Test layers:

- **Unit:** email normalization, input validation, score/band mapping, sort/filter allowlists, state-transition decisions.
- **Database integration:** fresh isolated PostgreSQL DB; apply all migrations; test successful operations and direct-SQL rejection under the runtime role; include stale-version `409 Conflict`, atomic version increments, rollback, and concurrency.
- **API integration:** test the actual server/database, not only mocks; check 400/401/403/404/409/422 and dependency-error behavior.
- **Browser:** Playwright exercises analyst/admin journeys, denial, reopen conflict, stale update, and preserved draft.
- **Mongo:** disposable database/collection; verify validator/index behavior, aggregate outputs, and database-unavailable behavior.
- Record runtime version, database major, fixture revision, exact command, exit result, and failures. Local and CI scripts use the same names and expected outcomes.

## 5. Acceptance matrix ownership

| Scenario | Lead | Required cross-review |
|---|---|---|
| VS01–VS03 authentication/session/current authority | ShrikarDesai07 | KadakWNL |
| VS04–VS05 transaction, scoring, money, and integrity | KadakWNL | ShrikarDesai07 |
| VS06–VS15 case commands, lifecycle, event immutability, authorization, idempotency, expected-version concurrency, and rollback | ShrikarDesai07 | KadakWNL; both inspect DB traces for VS14–VS15 |
| VS16 gated administrative mutation paths | Both | Both |
| Full-scope Mongo aggregation and academic evidence | ShrikarDesai07 | KadakWNL |
| Final report/setup and independent fresh-machine run | ShrikarDesai07 | KadakWNL runs documented steps; each demonstrates their own implementation |

This table allocates responsibility; it does not permit an unrun or failing test to be reported as passed. Issue #16 is a separate acceptance gate and cannot be satisfied with design prose alone.

## 6. Academic SQL/NoSQL scope

### Advanced SQL concepts

The MVP should demonstrate at least four concepts with executable evidence, not just name them:

1. Explicit PostgreSQL transactions and rollback for atomic case state/event/receipt updates, including stale-version conflicts.
2. An aggregate risk view (`v_transaction_risk`) using joins, `SUM`/`COUNT`, and correct preservation of no-signal rows.
3. Protected database functions for case commands with role checks, state guards, and atomic `expected_version` checks/increments.
4. An immutable-event trigger preventing `UPDATE`/`DELETE` of `CASE_EVENT` by the runtime role.
5. Indexes supported by actual explorer/queue/join queries and saved `EXPLAIN` output.
6. Description full-text search if time and the approved query contract permit it.

The final course requirement also expects meaningful DDL/DML evidence: `CREATE` in foundational migrations; `ALTER` for later foreign-key/constraint additions; `INSERT` for synthetic financial/risk/case data; `UPDATE` through valid case commands and approved data corrections; and `SELECT` with joins/aggregates/filters. `DROP` must target only a disposable object/schema in an isolated test database, never retained financial/case/event data.

### MongoDB scope proposal

For the minimum nonrelational concept, deliver one scoped `device_telemetry` collection after MVP acceptance:

- Two validated synthetic document shapes with a `schema_version` (for example, connection telemetry and device-change indicators).
- Required device identifier and `captured_at` timestamp; optional reference to a synthetic transaction.
- Indexes on device/time and transaction/time; no raw secrets or unnecessary customer PII.
- One bounded aggregation by device/time bucket and approved anomaly category, with exact expected results in tests.
- Resolve/authorize the related SQL device/transaction before returning Mongo results. Mongo outage degrades the telemetry panel only; it does not break SQL transaction/case data.
- Telemetry remains contextual evidence; it does not automatically create risk signals or establish that a transaction is safe.
- No analyst-note dual writes, outbox recovery, vector embeddings, redaction processing, or cleanup/delete API in this issue's scope.

This is a proposal for issue #17's owner/reviewer to accept, not an implemented collection or proof that the academic requirement is already met.

## 7. Safe DDL/DML decision gate

**Meaningful `DELETE` remains an explicit academic acceptance question.** Never delete financial transactions, risk evidence, investigation cases, or immutable events as a demonstration.

- **Safe `DROP`:** only a disposable table/schema created in an isolated test database, with a clear setup/cleanup script.
- **`ALTER`:** demonstrated through reviewed forward-only migrations adding deferred foreign keys/constraints, not manual edits to a shared database.
- **`INSERT`/`UPDATE`/`SELECT`:** demonstrated through deterministic synthetic seeds, guarded case commands, and real bounded queries.
- **`DELETE`:** a seed-reset operation alone may not satisfy the course if it expects a meaningful application DML `DELETE`. Before marking issue #4 Done, confirm the instructor/project owner's interpretation. If runtime `DELETE` is required, open/re-scope a separate task for an approved nonfinancial synthetic-retention workload with preview, authorization, durable audit, retry, and proof that financial/case/event rows are untouched. Do not silently add a cleanup/delete endpoint to the MVP or implement it ahead of review.

Until this interpretation is confirmed, record it as an unresolved completion blocker rather than claiming compliance.

## 8. Branch and pull-request rules

- No direct pushes or commits to `main`. All shared changes use issue-scoped branches and pull requests.
- Branch pattern: `docs/<issue>-<short-name>`, `feat/<issue>-<short-name>`, `fix/<issue>-<short-name>`, or `test/<issue>-<short-name>`.
- Keep PRs focused; link the issue in the PR body, but do not auto-close an issue until acceptance criteria and peer review have passed.
- Before requesting review: inspect `git diff`/status, remove secrets/generated output, run lint/typecheck/relevant tests, verify only agreed files changed, and document any command that could not run.
- Reviewer checks behavior/tests, authorization, SQL integrity, migration order, and docs. Resolve review comments before merge.
- Merge only after reviewer approval and required checks pass. Record merged PR/commit, actual test results, and remaining blockers in the issue. Do not self-approve.
- Do not merge a documentation proposal as an approved implementation contract until the named cross-review is recorded.

## 9. Cross-review checklist

- [ ] KadakWNL and ShrikarDesai07 approve migration ownership and sequence.
- [ ] Runner/checksum/transaction/forward-only conventions are accepted before issue #5 wires scripts.
- [ ] Vitest, Playwright, database roles, and safe-reset guard are accepted before implementation.
- [ ] VS01–VS16 owner/reviewer allocation is accepted.
- [ ] The Mongo telemetry aggregation scope is accepted and remains gated behind MVP acceptance.
- [ ] Instructor/project owner resolves the academic `DELETE` interpretation; otherwise issue #4 remains open.
- [ ] Both contributors have identifiable database, application, and test evidence for the final report.
- [ ] Issue #4 is marked Done only after cross-review and the open academic gate is resolved.
