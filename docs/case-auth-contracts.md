# Authentication, Session, and Case-Command Contract

- **Status:** Proposed for cross-review — not approved and not implemented.
- **Related work:** [Issue #3](https://github.com/KadakWNL/finsight/issues/3)
- **Decision owner:** ShrikarDesai07 · **Cross-review:** KadakWNL
- **Prepared:** 2026-10-13

This document turns the existing workflow drafts into one implementation contract. The proposal must be reviewed by both teammates before migrations or handlers depend on it. A written recommendation is not approval by itself.

## 1. Authentication decisions

| Area | Proposed decision |
|---|---|
| Sign-in | Auth.js Credentials provider authenticates against `APP_USER`. No public registration, invitations, password-reset delivery, customer login, or service login. |
| Eligible human roles | Active `APP_USER` rows with role `analyst` or `admin` only. A `system` identity cannot sign in. |
| Password hashing | Argon2id with at least OWASP's baseline of 19 MiB memory, 2 iterations, and parallelism 1. Benchmark in the agreed environment and tune upward if practical. Use a maintained implementation that generates a unique salt and stores the encoded parameters/hash. |
| Email identity | Trim and canonicalize consistently (lowercase for this demo); enforce canonical uniqueness in PostgreSQL. Use the same normalization in provisioning and sign-in. |
| Failure response | Invalid email, wrong password, inactive user, and system role return the same public sign-in message. Never reveal whether an account exists. |
| Sign-in throttling | Add a server-side rate limit with a stable generic response; do not rely on client-side delays alone. Never log passwords or store them in rate-limit records. |
| Authority source | PostgreSQL `APP_USER` is authoritative for active state and current role. Never authorize from a client-supplied role/user ID or a role claim copied into a long-lived token. |

References: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) and [Auth.js Credentials provider](https://authjs.dev/getting-started/authentication/credentials).

## 2. Session design

**Proposed architecture:** Auth.js uses its encrypted JWT session-cookie strategy because the Credentials provider does not itself persist user records. The application additionally persists session state in a proposed `APP_SESSION` table, so logout, idle expiry, and user deactivation can be enforced server-side. `APP_SESSION` is a proposed addition to the baseline ER and belongs in migration `020` only after review.

| Policy | Proposed value/behavior |
|---|---|
| Idle timeout | 30 minutes without an authorized request. |
| Absolute timeout | 8 hours after sign-in, even if active. |
| Cookie | `HttpOnly`; `SameSite=Lax`; `Secure` in production; `Path=/`; no `Domain` attribute. Use a `__Host-` prefix where HTTPS deployment conditions permit it. |
| Session claims | Minimal subject/user ID and an opaque session record ID (`sid`). Do not trust role, password, PII, or database credentials from the token. |
| Every protected request | Verify the Auth.js session, load `APP_SESSION` by `sid`, reject revoked/expired records, load `APP_USER`, then check `is_active` and current role. Also authorize the requested resource/action. |
| Idle refresh | For a valid request, update `last_seen_at` and `idle_expires_at` server-side, capped at `absolute_expires_at`. An expired session must never be revived by a late request. |
| Sign-out | Revoke the server-side `APP_SESSION` row and clear the Auth.js cookie. Clearing only the cookie is insufficient. |
| Deactivation/demotion | Current `APP_USER` state is checked on each protected request; the next request applies the changed authority. |
| Unsafe requests | Enforce same-origin/Origin or equivalent framework CSRF protections. SameSite is defense in depth, not the only control. |
| Absolute expiry | Set the Auth.js JWT/cookie maximum age to 8 hours; the database idle rule remains stricter. |

Session security reference: [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

### Proposed `APP_SESSION` fields

- `session_id` UUID primary key; this opaque ID is not a raw cookie/JWT token.
- `user_id` UUID foreign key to `APP_USER`, with restrictive deletion behavior.
- Server-generated `created_at`, `last_seen_at`, `idle_expires_at`, and `absolute_expires_at` timestamps.
- Nullable `revoked_at`, plus an optional allowlisted revocation reason.
- Checks: `absolute_expires_at > created_at`; `idle_expires_at <= absolute_expires_at`; `revoked_at` is null or no earlier than creation.
- Indexes for user lookup and active-session lookup/cleanup. Expiry is enforced on each request; cleanup is not required for correctness.
- Do not persist a session secret, raw JWT, browser cookie, password, or connection string in this table.

Exact column and index DDL belongs in migration `020`. Do not store a single session timestamp on `APP_USER` as a substitute for tracking independent sessions.

## 3. Protected bootstrap and demo identities

1. No public route may create the first admin.
2. A controlled CLI/bootstrap command accepts credentials only through environment input or a secure prompt. Secrets must not appear in source control, command history, screenshots, logs, or committed environment files.
3. The command uses a transaction and database/advisory lock, creates the first admin only when no admin exists, hashes the password before insertion, and refuses to demote, promote, reactivate, or reset an existing account on rerun.
4. Provisioning is idempotent: rerunning a successful command does not duplicate actors or silently change credentials/roles. A conflicting pre-existing email or existing-admin condition causes an explicit safe stop.
5. Provision the system actor separately; it cannot pass the human sign-in role allowlist. Analyst A/B/admin test users use synthetic credentials and are seeded only into an isolated development/test database.
6. Runtime application credentials cannot create arbitrary admins or change `APP_USER` roles. Public registration and password-reset flows remain out of scope.

## 4. Authorization contract

| Resource/action | Analyst | Admin | System/service |
|---|---|---|---|
| Read transaction/entity facts | Dataset-wide masked projections | Same baseline projection | Explicitly scoped processing only |
| Read case detail/events | Own assigned case only | All cases for oversight | Explicitly scoped job only |
| Read unassigned queue row | Minimal summary (case ref, subject, priority, status, due) only | Full allowed summary | Job scope only |
| Create investigation case | Any visible transaction; assigned to self by server | Admin-specific creation/assignment deferred from first slice | Automated case creation deferred |
| Start review | Own assigned open case | Open case with an active analyst assignee | No interactive transition |
| Escalate | Own `in_review` case; reason required | `in_review` case; reason required | Automatic due-time escalation deferred |
| Resolve/dismiss | Own `in_review` case | `in_review` or `escalated` case | Not permitted |
| Return escalated case to review | No | Yes, with reason | No |
| Reopen terminal case | No | Yes, with reason and active-case conflict check | No |
| Change operator/rule configuration or process redaction | No | Not enabled in first slice; separate capability gates required | Only a separately approved scoped operation |

Recheck authority on the server for every direct URL/API request. A private case requested by an unauthorized analyst returns a concealed 404. A known administrative action requested by a non-admin returns 403 without side effects. Hiding a UI control is not authorization.

## 5. Case lifecycle and outcome contract

Terminal status is derived from the resolution code; the client cannot send an independent status that conflicts with the code.

| Command | Who may invoke it | Preconditions | Result |
|---|---|---|---|
| Create | Active analyst | Visible transaction; no competing nonterminal case; valid priority and trimmed reason | New open case owned by the signed-in analyst |
| Start review | Assigned analyst or admin | Case is open and assigned to an active analyst | `in_review` |
| Escalate | Assigned analyst or admin | Case is `in_review`; trimmed reason required | `escalated` |
| Return to review | Admin | Case is `escalated` with an active analyst assignee; trimmed reason required | `in_review` |
| Resolve | Assigned analyst in `in_review`; admin in `in_review` or `escalated` | `resolution_notes` required; code is `confirmed_suspicious` | `closed` |
| Dismiss | Same authority as outcome policy | `resolution_notes` required; code is `false_positive` or `insufficient_evidence` | `dismissed` |
| Reopen | Admin | Case is `closed`/`dismissed`; no competing nonterminal case for the transaction; reason required | Same case reopens as `open` |

Outcome mapping:

- `confirmed_suspicious` → `closed`
- `false_positive` → `dismissed`
- `insufficient_evidence` → `dismissed` (inconclusive; not equivalent to confirmed safe)

Creation, escalation, return-to-review, and reopening require a trimmed operational reason of 1–2,000 characters. A terminal outcome requires trimmed `resolution_notes` of 1–5,000 characters. The terminal event's dedicated `reason` is copied from the validated `resolution_notes`. These limits are proposed and should be confirmed by the UI/API owners before implementation.

Reopen preserves `case_id`, case reference, original `opened_at`, and the historical terminal event. It clears the current `resolution_code`, `resolution_notes`, `closed_at`, and `due_at`. Keep the assignee only if they are still an active analyst; otherwise clear assignment and append an `assigned` event for the reset. If another nonterminal case exists for the transaction, return a conflict and make no change.

**Proposed concurrency design:** Add `version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0)` to the case table. This is a proposed schema and behavior pending teammate cross-review, not an implemented database column. Creation initializes version 1 without an expected prior version. Case responses return the current `version`. Every command that modifies an existing case, including assignment and priority changes when enabled, must require `expected_version`, compare it with the database value under the case row lock, and increment the stored `version` atomically. `updated_at` remains an informational timestamp and is not the concurrency-control token. A stale `expected_version` returns HTTP `409 Conflict` without changing the case, creating events, or recording a successful command receipt.

## 6. Event, idempotency, and concurrency contract

### `CASE_EVENT` shape

The reconciled ER source and data dictionary model this workflow contract, including session and receipt entities. Peer review must accept the mapping before migration `020`/`050`. These are design additions, not claims about an applied database:

- `reason`: dedicated operational rationale; never embedded in `from_state`/`to_state`.
- `metadata`: nonnull typed JSONB, default empty object, for explicitly approved event-specific supporting data. MVP lifecycle events use `{}`; arbitrary metadata writes are rejected.
- `operation_id`: non-null UUID grouping the effects of one accepted command and supporting replay diagnosis.

The actor is derived from the authenticated server session or scoped service identity. The client cannot submit `actor_user_id`, arbitrary `event_type`, arbitrary state snapshots, or event timestamps.

State snapshots contain only allowlisted field changes (for example status, priority, assigned user, resolution code, completion time, or due time). They do not contain rationale, credentials, raw note bodies, or generic request payloads.

| Event | Required behavior |
|---|---|
| `created` | First event for the case; `reason` contains the creation rationale; `from_state` is null and `to_state` contains initial case fields with an unassigned owner. The subsequent `assigned` event records initial self-assignment. |
| `assigned` | Emitted when case ownership is set; only assignment fields appear in state diffs. Creation and initial self-assignment occur in one transaction and share an `operation_id`. |
| `status_change` | Permitted lifecycle transition; state diffs list only changed case fields. Rationale is in `reason`. |
| `note_added` | Not writable in the first slice. Future confirmed Mongo notes require typed metadata and durable cross-store recovery before this event is enabled. |
| `priority_changed` | Deferred until the event type/writer and priority policy are approved. |

The detailed [event-shape contract](product-workflows.md#case-event-contract) owns allowed keys, types, rationale rules and snapshots. A command may emit more than one event (creation emits `created` then `assigned`). Add a proposed non-null `event_ordinal` with a positive-integer check that starts at 1 within each operation and enforce `UNIQUE(operation_id, event_ordinal)`. The protected writer binds each operation to one case and assigns contiguous ordinals in canonical order: creation is `created` then `assigned`; reopening is `status_change` then optional `assigned`. This identifies each logical event precisely, prevents duplicate event records during replay, and still permits a legitimate command to emit multiple events, including multiple events of the same type if a later approved workflow requires that. The protected database writer is the only runtime path allowed to mutate case state and emit events.

Command idempotency and event identity are separate guarantees: the command receipt ensures that the same accepted command does not execute twice, while `(operation_id, event_ordinal)` ensures that duplicate records for one logical event are rejected. The proposed runtime security boundary must ensure that the application runtime role cannot arbitrarily insert, update, or delete `CASE_EVENT` records and cannot bypass the approved database functions to modify case state. Protected functions should use `SECURITY DEFINER` where appropriate, rather than requiring it automatically for every function. Any `SECURITY DEFINER` function must use a fixed safe `search_path`, schema-qualified references where appropriate, restricted `EXECUTE` grants, and no unnecessary `PUBLIC` execution privileges. The migrator/owner role and least-privilege application runtime role remain separate. These are proposed requirements for later migration and implementation work, not existing controls or tested behavior.

### Proposed `CASE_COMMAND_RECEIPT`

Store the minimum durable facts needed for safe retries: `actor_user_id`, client idempotency key, server `operation_id`, command type, canonical request hash, result `case_id`, response status, and completion timestamp. Enforce uniqueness on `(actor_user_id, idempotency_key)`. Do not store passwords, session tokens, or unrestricted request-body copies.

- Same actor + same key + same canonical payload: return the prior permitted result without duplicating state/events.
- Same actor + same key + different payload: return 409 conflict.
- Recheck current access before disclosing a prior result; a receipt cannot bypass current case permissions.
- Case mutation, `CASE_EVENT` rows, and successful receipt commit atomically in one PostgreSQL transaction.
- A failed/rolled-back command must not leave partial state, events, or a success receipt.
- Use the row lock plus the `expected_version` supplied by the client. A stale version returns HTTP `409 Conflict` and makes no mutation, creates no events, and records no successful receipt. A successful lifecycle command increments the stored case `version` atomically. `updated_at` remains informational.
- Keep the partial unique invariant: at most one nonterminal case per transaction. Database uniqueness/guards, not only request-time checks, resolve creation/reopen races.

## 7. API command boundary

Use one semantic operation per request; do not accept mass assignment. These examples describe the intended contract, not implemented routes.

Create request (requires an `Idempotency-Key` UUID header):

```json
{
  "transaction_id": "synthetic-uuid",
  "priority": "high",
  "reason": "Synthetic example rationale"
}
```

The authenticated user is the owner; no client-supplied owner, actor, status, operation ID, timestamp, or raw event is accepted.

Case responses return the current `version`. Lifecycle requests also require an idempotency key and an `expected_version` value returned by the server:

```json
{ "action": "start_review", "expected_version": 3 }
```

```json
{ "action": "escalate", "expected_version": 4, "reason": "Needs second-level review" }
```

```json
{ "action": "resolve", "expected_version": 5, "resolution_code": "confirmed_suspicious", "resolution_notes": "Synthetic evidence supports escalation" }
```

Reopen accepts no overrides for owner, due date, or resolution fields. Invalid input/state returns 400/422 as applicable, permission failure returns 403 (or concealed 404 for private cases), and stale/concurrent/idempotency conflicts return 409.

## 8. Required verification evidence

- Invalid password, inactive user, and system identity have indistinguishable public sign-in failures.
- Sign-out revokes the server-side session; replayed cookies fail after revocation or idle/absolute expiry.
- Deactivation/demotion affects the next protected request without waiting for token expiry.
- Cookie, session token, password hash, database URL, and bootstrap credentials never appear in browser responses/logs.
- Analyst A cannot read/mutate analyst B's case/events; unassigned summaries never reveal private history.
- Case creation emits `created` then `assigned` atomically; same-key retry emits no duplicates; payload mismatch returns 409.
- Lifecycle responses expose the current case version; a stale `expected_version` returns 409 with no case, event, or successful-receipt changes, while a successful mutation increments the version atomically.
- Invalid transition/code/status combinations leave case/event/receipt unchanged.
- All three outcomes map to the fixed statuses; terminal event `reason` mirrors validated `resolution_notes`.
- Reopen preserves historical terminal evidence and rejects a competing active case.
- Direct runtime-role attempts to insert/update/delete `CASE_EVENT` fail; direct attempts to bypass approved case functions fail; approved protected functions still work. Negative database permission tests must prove these failures.
- Concurrency/fault-injection tests prove rollback of state/event/receipt together.

## 9. Cross-review checklist

- [ ] KadakWNL approves or requests changes to Auth.js/JWT plus persisted `APP_SESSION`.
- [ ] Both owners accept the 30-minute idle and 8-hour absolute timeouts, or record explicit replacements.
- [ ] Both owners accept Argon2id and the proposed password/bootstrap policy.
- [ ] `CASE_EVENT` required columns, event types, typed diffs, reason, and operation identity align with the ER source.
- [ ] Proposed case `version` column, `expected_version` API contract, and atomic increment behavior are accepted by both owners.
- [ ] Resolution and reopen mapping is accepted by both owners.
- [ ] Event identity `(operation_id, event_ordinal)` and command-receipt idempotency are accepted as separate guarantees.
- [ ] Protected-function privileges, `SECURITY DEFINER` safeguards where appropriate, and negative permission tests are approved before implementation.
- [ ] Migration 020 additions (`APP_SESSION`, case `version`, and command receipt) are approved before implementation.
- [ ] Issue #3 is marked Done only after cross-review is recorded and acceptance evidence exists.
