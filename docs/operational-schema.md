# Operational schema

[`020_operational_schema.sql`](../migrations/020_operational_schema.sql) adds operator identities, cases, typed lifecycle events, sessions and successful command receipts after the financial baseline. It also adds the restrictive `customer.user_id` foreign key. The reviewed design is recorded in [PR #22](https://github.com/KadakWNL/finsight/pull/22); the [canonical ER dictionary](er-diagram.mmd) owns the entity inventory.

## Data dictionary

All identifiers are caller-supplied UUIDs except the generated bigint `case_event.event_id`. Timestamps use `timestamptz`. All foreign keys use `ON DELETE RESTRICT`.

| Table | Required columns | Nullable columns | Constraints and defaults |
|---|---|---|---|
| `app_user` | `user_id`, `email`, `display_name`, `role`, `is_active`, `created_at` | `password_hash`, `last_login_at` | Canonical lowercase trimmed unique email; analyst/admin/system roles; active defaults true; creation defaults to server time. Humans require a nonblank encoded hash; system identities must have no password. Hash algorithm verification belongs to provisioning/authentication. |
| `investigation_case` | `case_id`, `case_ref`, `transaction_id`, `status`, `priority`, `opened_at`, `updated_at`, `version` | `assigned_to_user_id`, `resolution_code`, `resolution_notes`, `due_at`, `closed_at` | Unique trimmed reference; one open/in_review/escalated case per transaction; positive bigint version defaults 1; status defaults open; timestamps default to server time. |
| `case_event` | `event_id`, `case_id`, `actor_user_id`, `event_type`, `to_state`, `metadata`, `operation_id`, `event_ordinal`, `occurred_at` | `from_state`, `reason` | Positive ordinal; unique operation/ordinal; metadata defaults `{}`; event time defaults to server time; JSONB shapes and rationale follow the checks below. |
| `app_session` | `session_id`, `user_id`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at` | `revoked_at`, `revocation_reason` | Opaque record ID only; finite ordered times, idle expiry at most 30 minutes after last seen, absolute expiry at most 8 hours after creation; creation defaults to server time. |
| `case_command_receipt` | `operation_id`, `actor_user_id`, `idempotency_key`, `command_type`, `request_hash`, `case_id`, `response_status`, `completed_at` | None | Unique actor/key; lowercase 64-character hex digest; successful 200/201 status; completion defaults to server time. |

Case outcomes enforce the [resolution mapping](product-workflows.md#resolution-and-reopening-contract): closed means confirmed suspicious; dismissed means false positive or insufficient evidence. Terminal cases require trimmed notes of 1-5000 characters and a completion timestamp. Nonterminal cases require all three outcome fields to be null. Active-assignee checks, permission checks and version increments require the later protected writer; a foreign key alone does not enforce them.

Receipt commands are `create`, `start_review`, `escalate`, `return_to_review`, `resolve`, `dismiss` and `reopen`. They store digests and result references, never raw request bodies. Retry payload comparison and atomic case/event/receipt commits belong to the later command functions.

Revocation reasons are nullable, or `sign_out`, `user_disabled` or `security` when `revoked_at` is set. The user index supports per-user session lookup; the earliest expiry/revocation expression index supports the [bounded cleanup ordering](session-cleanup-contract.md#eligibility-and-bounded-preview). Session validation and refresh remain authentication work. No session-cleanup function is installed.

## Event validation boundary

`valid_case_snapshot` validates JSON objects, known keys, enums, UUID strings and ISO timestamps with explicit offsets. `valid_case_event` applies event-specific keys, matching diff keys, allowed lifecycle shapes and reason bounds. SQL null, JSON null, arrays, unknown keys and mismatched types are handled explicitly. Both helpers return booleans for table checks and have no PUBLIC execution grant.

The enabled event types are `created`, `assigned` and `status_change`. Creation requires an unassigned open snapshot, subject/reference/priority/time and a rationale of 1-2000 characters. Assignment snapshots contain only the assignee key. Start-review has no rationale; escalation, return and reopen require one. Terminal snapshots contain status/code/completion time and require a rationale of 1-5000 characters. Reopen snapshots also clear due time. All enabled events require empty metadata.

Deferred priority, note and automation events are rejected. The later protected writer must derive actor/time, bind an operation to one case, allocate contiguous ordinals, compare snapshots with actual state, copy terminal notes into the event reason and enforce command atomicity. These cross-row guarantees are not provided by the row-shape checks.

No runtime grants are installed. PUBLIC receives no table, sequence or helper privileges. Owner-level fixture writes remain possible; immutable history, trusted command execution and runtime/service permissions belong to migration 050.

## Isolated verification

Use a disposable PostgreSQL 17 database owned by a non-superuser migration login. Native PostgreSQL works; Docker is optional for local development. Set `TEST_DATABASE_URL`, `ALLOW_TEST_DATABASE=true` and the matching libpq connection variables. Run from the repository root:

```powershell
npm run db:migrate:test
npm run db:migrate:test
psql -X -v ON_ERROR_STOP=1 -f tests/sql/operational_schema.sql
```

The repeat migration verifies ledger/checksum compatibility. The SQL suite inserts synthetic active/inactive analyst, admin and system fixtures; verifies case uniqueness/outcomes, event shapes, session bounds, receipt uniqueness and restrictive relationships; then rolls everything back. It does not verify sign-in or lifecycle command permissions. The baseline-only suite runs separately against migration 010 because it intentionally asserts the absence of the operator foreign key.

The [operational schema workflow](../.github/workflows/operational-schema.yml) runs these checks with PostgreSQL 17. Local verification used Node 24.15.0 and native PostgreSQL 17.11 with a non-superuser owner. Both migration passes and the operational SQL suite passed. The scaffold migration-runner rollback/checksum test also passed against a separate fresh database.
