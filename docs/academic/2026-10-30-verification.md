# Academic verification execution, 2026-10-30

All automated academic checks passed in [CI run 41030351130](https://github.com/KadakWNL/finsight/actions/runs/41030351130). Instructor acceptance of the SQL DELETE workload and Shrikar's independent case-function demonstration/financial-evidence review remain pending. This record does not close #18 or claim final course completion.

The command was `npm run test:academic`. It ran from 09:02:00.512 to 09:02:55.404 UTC on October 30, 2026, using Node.js 24.22.1, PostgreSQL 17 and MongoDB 7.0.45 on Linux. The owner was a non-superuser; the application used the separate nonowner `finsight_runtime` login with no owner membership. Fresh PostgreSQL and run-specific Mongo fixtures were used.

The tested branch implementation is [2382c49](https://github.com/KadakWNL/finsight/commit/2382c49e58cd43803a71dc51ab0b6d62fcf08195). GitHub checked out its merge with base `f5fdf76`; the tested merge revision is `281c538e2c614529988153aad27eb35ed0ea2003`, recorded in the [machine-readable report](2026-10-30-report.json). All 148 retained source-file hashes were checked against the committed Git objects in the PR. The evidence-only follow-up adds this record and the unchanged downloaded artifacts.

## Actual results

| Check | Observed result |
|---|---|
| Complete VS01-VS16 gate | All 16 scenarios passed |
| Unit tests | 98 passed |
| API / database / production-browser tests | 88 / 24 / 17 passed; required academic tests executed without skips or browser retries |
| Disposable DDL | Temporary table CREATE, ALTER, INSERT and DROP passed; absence checked after DROP |
| Relational query | JOIN, subquery, GROUP BY, HAVING, aggregates and ORDER BY returned two verified merchant groups |
| Risk view | Eight canonical transactions; combined-rule score 65 |
| Guarded case INSERT/UPDATE | Owned case entered `in_review`, version 2, with three retained typed events |
| Immutable event / runtime mutation | Owner UPDATE rejected with SQLSTATE 55000; runtime DELETE rejected with 42501 |
| Rolled-back cleanup | Tentative deletion undone; all three session fixtures restored and audit remained `previewed` |
| Committed cleanup | Exactly one expired session deleted and audited; retry returned that same result |
| Retention | Two active/recent sessions survived; user, financial, risk, case, event and receipt row counts unchanged |
| Indexed queries | Five actual planner-selected index plans passed, including description FTS |
| Mongo aggregation | Six `connection_telemetry` and six `client_environment` observations; empty payload rejected with Mongo code 121 |
| Contribution provenance | Both members have at least two database implementation issues plus application/test changes; pinned merge ancestry and file existence verified |

The [SQL transcript](2026-10-30-sql-results.json) retains exact commands and actual result rows without bound parameters. The [plan artifact](2026-10-30-query-plans.json) contains actual `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` results over synthetic plan fixtures, not production performance claims. The machine-readable report retains Mongo pipeline/results, required test names, source/migration hashes, contribution ledger and human gates.

## Defects and missing items

No blocking technical defect remained in this run. The [runbook and requirement matrix](../academic-verification.md) explain reproduction and scope. The [contribution ledger](contributions.json) records merged source provenance; it does not prove attendance, exclusive authorship or academic originality.

The project owner approved expired-session cleanup as the SQL DELETE scope and considers it sufficient. Instructor acceptance has not been confirmed. Shrikar must independently demonstrate the case functions/privileges and review the financial query evidence, recording the tested revision, commands/results and any findings in the PR. Final timed presentation, independent clean-machine setup, screenshots/report and submission remain separate work under #19. Deferred notes/recovery, vectors, rule editing and redaction are not counted as implemented features.
