# FinSight: timed demonstration

Project title: **FinSight**
Team members: **Shrikar Desai** and **Shreyas P Kulkarni**

Allow approximately 18 minutes for the walkthrough and the remainder of the 30-minute slot for individual questions. Both members must run the project on their own systems. Follow the [setup guide](../development-setup.md), including canonical `db:seed`, telemetry seeding and the synthetic expired-session preparation. Use a fresh local demo database for a predictable first run. Keep the A4 [print masters](../printable/README.md) ready.

## 1. Introduce the project (2 minutes)

Show both diagrams with the exact title and member names. Explain that PostgreSQL stores financial facts, risk signals, cases, sessions and audit records; MongoDB stores device telemetry. Use the [submission report](submission-report.md) and schema catalog for the implemented entities. Explain that all demonstration data is synthetic and the rules do not establish real fraud.

## 2. Start and sign in (1 minute)

Open `http://localhost:3014/api/health`: the response is `{"status":"ok","scope":"process"}`. This checks the process, not database readiness. Open `/sign-in` and sign in as `analyst_a@finsight.local` with the locally provisioned password.

## 3. Discover transactions (1 minute)

Open `/transactions`. Show the risk-band and status filters, amount controls, sort options and cursor paging. Clear filters before opening the canonical example directly. With only eight canonical fixtures, the table may fit on one page; import the optional larger dataset before presenting multi-page navigation. Explain that masked account context and signed cursors are implemented by the [transaction API](../transaction-api.md).

## 4. Explain the risk evidence (2 minutes)

Open `/transactions/30000000-0000-0000-0000-000000000106`.

- Original amount: USD 125.00; synthetic fixture exchange rate: 80 INR per USD; base amount: INR 10,000.00.
- `AMOUNT_BASE_GTE`: observed INR 10,000 meets threshold 10,000, contributing 40 points.
- `MERCHANT_TIER_GTE`: high merchant tier has code 2, meeting threshold 2, contributing 25 points.
- Total: 65, two signals, high band.

These are the two rules in `scripts/financial-seed.mjs`. The fixed rate is a regression fixture; the optional larger dataset uses historical ECB rates. Open transaction ending `101` for contrast: USD 10.00, score zero, no signals. The scoring function records signals; `v_transaction_risk` aggregates them.

## 5. Show MongoDB integration (1 minute)

On the same detail page, show device telemetry observations and summaries. Canonical transactions share device `30000000-0000-0000-0000-000000000040`, used by `telemetry:seed`. The server first resolves the SQL transaction/device and limits telemetry to observations no later than the transaction time, so visible counts depend on the selected transaction. Explain the two shapes, `connection_telemetry` and `client_environment`, and the offline fallback. Use [Mongo telemetry](../mongo-telemetry.md) for the exact fields and pipeline.

## 6. Create and progress a case (3 minutes)

On transaction ending `106`, click **Create case**, select High priority, enter a synthetic investigation reason and click **Save case**. Open the new case from its active-case link or `/cases`. If a prior rehearsal already created an active case, use that case and explain its existing state; do not promise a fresh version counter.

For a new case, show version 1, use **Start review**, and verify `in_review` with the next version. Use **Escalate**, provide the required escalation rationale and confirm. There is no severity selector. Show the typed event history and actor attribution. Actual event types include `created`, `assigned` and `status_change`.

Explain `execute_case_command`, expected-version conflicts and idempotency. The partial unique index `case_one_active_transaction` prevents two active cases for one transaction. In `migrations/050_case_guards.sql`, show `case_event_immutable_row` (AFTER UPDATE) and `case_event_immutable_stmt` (BEFORE DELETE OR TRUNCATE). Both use `reject_case_event_mutation`. Use the retained SQL transcript to show mutation denials; do not attempt destructive financial operations in the live demo database.

## 7. Show access denial (1 minute)

While signed in as analyst, navigate to `/admin`. Show the access-denied page. Explain page authorization and API authorization. Sign out, sign in as `admin@finsight.local`, then navigate to `/admin` explicitly.

## 8. Demonstrate audited SQL DELETE (2 minutes)

The setup guide prepares one synthetic session unusable for over seven days. Click **Preview eligible sessions**. Show count, captured cutoff and preview expiry. Confirm the preview within ten minutes and show the exact deleted count. On a fresh prepared database, expect one deletion. With zero candidates the confirmation button is intentionally absent: prepare the synthetic expired row before the demonstration, then preview again.

Explain `preview_app_session_cleanup` and `confirm_app_session_cleanup`: at most 100 candidates, eligibility rechecked, atomic DELETE and audit completion, idempotent replay. Session IDs are retained in `app_session_cleanup`, not displayed in the UI. The [retained SQL transcript](2026-10-30-sql-results.json) shows rollback restoration, one committed deletion, surviving active/recent sessions and unchanged protected row counts. No separate instructor DELETE approval is required by the [owner decision](delete-scope-decision.md).

## 9. Present SQL and Mongo evidence (3 minutes)

Open [SQL results](2026-10-30-sql-results.json) and [query plans](2026-10-30-query-plans.json). Explain disposable DDL, joins/subqueries, grouping, aggregates, view, guarded functions, triggers, rollback and full-text indexing. Use the actual `joins-group-having-order` query:

```sql
SELECT m.merchant_name, count(*)::integer AS transaction_count,
       sum(t.amount_base)::text AS total_inr,
       max(v.risk_score)::text AS maximum_risk
FROM public.transaction t JOIN public.merchant m USING (merchant_id)
JOIN public.v_transaction_risk v USING (transaction_id)
WHERE t.transaction_id IN (
  SELECT transaction_id FROM public.v_transaction_risk WHERE signal_count > 0
)
GROUP BY m.merchant_id, m.merchant_name
HAVING count(*) >= 2
ORDER BY max(v.risk_score) DESC, m.merchant_name;
```

The pinned transcript's two merchant groups come from its isolated eight-fixture database; optional imported data changes results in the live database. Show the five actual indexed plans, including `transaction_account_activity` and `transaction_description_search`, without claiming production performance. Open the Mongo check in [the report](2026-10-30-report.json): six observations of each shape and invalid-document rejection code 121.

## 10. Explain contributions and limits (2 minutes)

Show [contributions.json](contributions.json), its PRs, merge commits and source paths. Each member explains their own database and application work. Show the [measured results](2026-10-30-verification.md), identifying them as a pinned execution rather than coverage percentages. Explain that PR #42's later approval and the DELETE scope decision supersede the raw report's historical pending gates. Do not rewrite the raw report or treat those flags as the upcoming course defense.

State deferred features: vector retrieval, Mongo notes/recovery, rule editing and redaction. Leave time for individual questions. Submit the soft copy and GitHub link only after the demonstration, as required by the announcement.
