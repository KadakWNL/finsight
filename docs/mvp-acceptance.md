# MVP acceptance verification

`npm run test:acceptance` executes the VS01-VS16 technical gate using real PostgreSQL, route handlers and a production browser server. [The acceptance matrix](../scripts/acceptance-matrix.mjs) requires named evidence for every scenario. A missing, skipped, failed or retried browser check blocks the result.

The command produces technical evidence for review. It does not record teammate approval, close the issue, or establish full SQL-plus-NoSQL academic acceptance. The responsible workstreams follow the [acceptance plan](development-and-testing-contract.md#5-acceptance-matrix-ownership); those names are responsibility assignments, not claims that a teammate ran or approved this evidence.

The [2026-10-27 execution record](acceptance/2026-10-27-mvp.md) contains a pinned local result, SQL plans and the defect disposition.

## Isolated prerequisites

Use Node.js 24, PostgreSQL 17, the PostgreSQL `psql` client on PATH, and Playwright Chromium. Install dependencies with `npm ci` and the browser with `npx playwright install chromium`. Linux CI installs the browser's OS dependencies as well.

Provision a dedicated, empty local database whose name ends in `_test`. The harness refuses a populated public schema before making changes. It owns that schema for the run and recreates it between verification layers; never target the running demo. To repeat a run, provision another empty test database and update both connection URLs.

The database administrator must provision these roles before the command runs:

| Role | Required configuration | Usage |
|---|---|---|
| Test owner | Non-superuser login, owns the dedicated database | Migrations, synthetic setup, fault injection and schema teardown |
| `finsight_runtime` | Login; no superuser, role creation or database creation; no membership in the owner role | Application connection and direct privilege-denial checks |
| `finsight_auth_probe` | Non-superuser role | Existing authentication and SQL permission probes |

Grant the runtime and probe roles to the test owner so owner-side probes can use `SET ROLE`. Keep the reverse grant absent: the runtime login must not inherit the owner. Migration procedures grant the application only its approved runtime privileges. The [CI workflow](../.github/workflows/acceptance.yml) supplies a complete disposable example; its credentials belong only to that ephemeral service.

| Environment variable | Required value | Usage |
|---|---|---|
| `TEST_DATABASE_URL` | Test-owner connection to the fresh local `_test` database | Fixture and verification connection |
| `ACCEPTANCE_RUNTIME_DATABASE_URL` | `finsight_runtime` connection to the same host, port and database | Nonowner application connection |
| `ALLOW_TEST_DATABASE` | `true` | Explicit isolation opt-in |

Both connection URLs reject remote hosts and URL options. The normal `DATABASE_URL`, `MIGRATOR_DATABASE_URL` and configured application origin are overridden only in the harness's child processes. A random test authentication secret is generated for those processes. The developer's environment file is not rewritten.

Stop other application processes for the same checkout before running because the command builds its `.next` directory. Port 3100 must be free. A separate checkout can verify acceptance while another checkout serves the demo.

## Execution and evidence

```powershell
npm run test:acceptance
```

The runner verifies the fresh target and role separation, runs unit tests and a production build, then executes API and database integration tests. Foundational SQL checks run against migrations 010 and 020 respectively, before later immutable-write guards change their expected rejection order. Full migrations are then applied twice to verify repeatability before the current financial and case guard checks. Risk verification and financial contention/index checks run against separate clean schemas. Browser checks use the restricted runtime login, with synthetic fixture writes restricted to the owner connection.

Each invocation writes a unique directory under ignored `test-results/acceptance/`. `latest.json` points to its run directory. Successful runs include every artifact below; blocked runs retain the completed stages. The final application fixtures remain available in that isolated database for inspection.

| Artifact | Contents | Usage |
|---|---|---|
| `report.json` | VS results, required test matches, stage commands/exit codes, runtime/database versions, source hashes and migration checksums | Machine-readable evidence and reproduction |
| `report.md` | Scenario responsibility/result matrix | Human review |
| `query-plans.json` | Actual `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` output for five indexed queries | Query-plan evidence |
| `browser/**/video.webm` | Synthetic browser journeys with password inputs masked by the UI | Analyst/admin demonstration review |
| `browser/**/investigation-journey.png` | Final case with retained audit history | Recorded outcome evidence |
| `*-raw.json`, `*.log` | Local runner diagnostics | Debugging only; excluded from the published evidence artifact |

Reports omit connection URLs, passwords, cookies and request bodies. Acceptance browser tracing is disabled to avoid retaining authentication payloads. The CI upload allowlist includes only the sanitized reports, plans, synthetic videos and final journey image.

Exit code zero means all technical evidence required by VS01-VS16 passed. Nonzero means the technical gate remains blocking; `report.json` lists the failed stage and blocking scenarios. Every report keeps `reviewStatus` pending and `mvpComplete` false until the required human cross-review is recorded separately.

## Coverage map

| Scenario | Required evidence | Responsible workstream |
|---|---|---|
| VS01 | Active analyst/admin sign-in, protected deep links and recorded browser journey | ShrikarDesai07 |
| VS02 | Generic credential rejection, idle/absolute expiry, revocation and cookie replay denial | ShrikarDesai07 |
| VS03 | Current role/deactivation reads and denied mutations without side effects | ShrikarDesai07 |
| VS04 | SQL-backed risk, zero-signal rows, exact filters and stable tied-timestamp paging | KadakWNL |
| VS05 | USD 10.00 at recorded rate 80 gives INR 800.00; INR rate one, shared payment methods and rejected invalid financial writes | KadakWNL |
| VS06 | Atomic self-assignment with ordered creation/assignment events and dedicated rationale | ShrikarDesai07 |
| VS07 | Same-key replay, changed-payload conflict and competing creation | ShrikarDesai07 |
| VS08 | Concealed peer detail/history/mutations and known-action denial | ShrikarDesai07 |
| VS09 | Invalid state/outcome combinations and bounded reasons/notes with unchanged state/history/receipts | ShrikarDesai07 |
| VS10 | Owner review/escalation, denied analyst escalation outcome and administrative return | ShrikarDesai07 |
| VS11 | Every outcome code from owner review and escalated admin paths, including exact event rationale | ShrikarDesai07 |
| VS12 | Repeated reopening, retained identity/terminal records, reset due/outcome and inactive-owner handling | ShrikarDesai07 |
| VS13 | Analyst reopening denial and competing active-subject conflict | ShrikarDesai07 |
| VS14 | Concurrent expected versions, injected failures before event/receipt insertion and browser draft recovery | Both |
| VS15 | Real nonowner write denials, privileged immutable-event trigger rejection and permitted protected writer | Both |
| VS16 | Direct admin mutation requests rejected with no data changes; unavailable actions absent from navigation | Both |

The [supplementary API tests](../tests/api/acceptance-gaps.test.ts) complete the outcome, repeated-reopen, current-authority and fault-injection combinations. The [recorded browser tests](../tests/e2e/mvp-acceptance.spec.ts) exercise the analyst/admin investigation, explicit mutation gates and the actual runtime database role. Existing auth, transaction, case and database suites remain required; the matrix fails closed if a named test disappears.

The eight financial scenarios retain their deterministic identifiers and exact expected amounts. Recording actors and additional journey subjects use run-scoped UUIDs so a failed worker cannot contaminate another attempt. They copy the existing synthetic score-65 financial scenario and introduce no real identities or invented market rates.

## Advanced SQL evidence and remaining gates

The run demonstrates atomic transactions and rollback, the aggregate `v_transaction_risk` view, protected command/session functions, immutable-event triggers and indexed query plans. These establish executable SQL evidence for the MVP; they do not establish a second database paradigm.

ShrikarDesai07 must cross-check the case/auth acceptance evidence and the technical matrix before the MVP gate is marked complete. MongoDB telemetry, analyst notes, general administrative mutations, cleanup delivery and final academic verification remain separate work. No disabled capability is represented as an implemented feature merely because its denial test passes.
