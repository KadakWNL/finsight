# Admin cleanup of expired sessions

The project owner approved expired-session cleanup as the application SQL `DELETE` workload. This is an academic-completion feature after MVP acceptance, with no implemented table, endpoint or UI yet. Instructor acceptance and actual execution evidence remain part of final academic verification.

This contract owns the cleanup policy. The [authentication contract](case-auth-contracts.md#2-session-design) owns session validation and the proposed `APP_SESSION` fields. Cleanup requires that foundation, current-role authorization and isolated database tests before implementation.

## Eligibility and bounded preview

An active admin may remove sessions that have been unusable for more than seven days. Define `unusable_at` as the earliest of `idle_expires_at`, `absolute_expires_at` and a nonnull `revoked_at`. Eligibility requires `unusable_at < cutoff`, where the server captures `cutoff = preview_time - interval '7 days'`. Equality is ineligible. Null revocation does not affect the two required expiry timestamps.

The server previews at most 100 eligible rows, ordered by `unusable_at, session_id`. Return the count, cutoff and opaque operation reference, with no cookie, JWT, password, email or session identifiers exposed. The administrator confirms that specific preview; never run an unrestricted table wipe. A preview expires after ten minutes and cannot expand its candidate set on confirmation.

Propose a dedicated `APP_SESSION_CLEANUP` record containing a server operation UUID, authenticated admin ID, preview time, cutoff, expiry, bounded candidate session IDs, confirmation idempotency key, canonical request hash, completion time and deleted count. Enforce unique `(admin_id, idempotency_key)` for confirmed operations. Only the protected cleanup writer can mutate it; completion facts remain retained. It is separate from case history and general operator-account mutations.

## Atomic deletion and permissions

Confirmation uses an idempotency key and checks the current admin and operation ownership. Within one PostgreSQL transaction, lock the operation and candidate sessions in a stable order, recheck eligibility against the captured cutoff, delete only the still-eligible previewed rows with `DELETE ... RETURNING`, and commit the deleted count/completion record together. Missing candidates may reduce the actual count. A failed delete or audit write rolls back the entire operation.

Same-key retries return the committed permitted result; a changed request conflicts. A new key for an already completed operation also returns its result without another deletion or completion record. Preview records are never successful deletion evidence. Session validation/refresh must reject expired sessions under coordinated locking, so a concurrent refresh cannot revive an eligible candidate.

The runtime role receives narrowly granted cleanup-function execution, with current admin checks in the trusted writer. It has no direct session-table DELETE privilege. Service and analyst callers are denied. Restrictive foreign keys must reject or exclude referenced candidates; cascading deletion is prohibited. Cleanup never deletes users, financial records, risk signals, cases, events, command receipts or cleanup audit records.

The protected function follows the existing safe `SECURITY DEFINER` and search-path requirements where needed. Proposed APIs are `POST /api/v1/session-cleanups/preview` and `POST /api/v1/session-cleanups/{operation_id}/confirm`. UI belongs in the admin maintenance area and remains gated until this feature passes its tests.

## Delivery and verification

Reserve migration `060_session_cleanup.sql`, owned by ShrikarDesai07 and reviewed by KadakWNL, after migrations 010-050. The same owner implements the bounded API, admin preview/confirmation UI and database/API tests. The estimate is provisional: three relative points including review, not a guaranteed duration. Added scope competes with the October 23 deadline and needs same-day escalation if it spills over.

| Test | Expected evidence |
|---|---|
| Active session; earliest expiry/revocation less than seven days old; exact cutoff | No deletion |
| Idle expiry, absolute expiry or revocation more than seven days old | Eligible synthetic rows deleted; exact SQL returned count recorded |
| More than 100 eligible rows | Preview and deletion limited to the same 100 candidates |
| Preview older than ten minutes; newly eligible row after preview | Expired preview rejected; newly eligible row excluded |
| Analyst/service/disabled/demoted admin; forged operation ownership | Denial with no deletion or completed audit |
| Replayed confirmation; changed request; concurrent confirmation | One deletion/completion result; changed request conflicts |
| Concurrent session refresh/sign-out | Expired sessions never revived; active/recent sessions retained |
| Failure after DELETE before audit completion; restrictive FK failure | Full rollback; no partial deletion or false success |
| Protected-table counts before/after | User, financial, risk, case, event and receipt records unchanged |

Retain real SQL results, API denial/idempotency results and browser evidence for academic verification. The preview and successful cleanup demonstrate a meaningful application DELETE; naming this feature or writing its contract does not complete that requirement. Mongo telemetry reads/aggregation remain the separate NoSQL workload. Telemetry deletion, general admin mutations, rule editing and redaction remain deferred.

## Implemented Objects and Verification Evidence (Issue #23)

### Delivered Schema and Migration
- **Migration:** `migrations/060_session_cleanup.sql` (forward-only numbering following `055_auth_session_validation.sql`).
- **Audit Table:** `public.app_session_cleanup`
  - Columns: `operation_id` (UUID PK), `admin_user_id` (UUID FK to `app_user`), `preview_at` (timestamptz), `cutoff_at` (timestamptz), `expires_at` (timestamptz), `candidate_session_ids` (UUID array), `candidate_count` (integer), `status` (text: `'preview'` or `'completed'`), `idempotency_key` (UUID nullable), `request_hash` (text nullable), `completed_at` (timestamptz nullable), `deleted_count` (integer nullable).
  - Integrity Constraints:
    - Status lifecycle constraints: `status = 'preview'` requires null completion fields; `status = 'completed'` requires all completion fields non-null with `deleted_count <= candidate_count`.
    - Unique `(admin_user_id, idempotency_key)` index for committed operations.
    - Strict immutability triggers (`reject_cleanup_audit_mutation`) blocking direct application INSERT/UPDATE/DELETE.
- **Database Functions & Procedures:**
  - `preview_app_session_cleanup(p_admin_user_id uuid)`:
    - Verifies caller is an active administrator.
    - Evaluates 7-day unusable cutoff: `LEAST(idle_expires_at, absolute_expires_at, revoked_at) < clock_timestamp() - interval '7 days'`.
    - Captures deterministic preview of up to 100 candidate session IDs ordered by `LEAST(...) ASC, session_id ASC`.
    - Records preview audit row with 10-minute expiry (`clock_timestamp() + interval '10 minutes'`).
    - Returns bounded candidate summary without exposing session secrets or sensitive identifiers.
  - `confirm_app_session_cleanup(p_operation_id uuid, p_admin_user_id uuid, p_idempotency_key uuid, p_request_hash text)`:
    - Atomically locks the preview operation record and validates admin ownership and active status.
    - Validates 10-minute preview window (`clock_timestamp() <= expires_at`).
    - Handles idempotency replay: returns committed result if `(admin_user_id, idempotency_key)` matches; raises 409 conflict if payload hash differs.
    - Locks candidate sessions in ascending order (`session_id ASC`), rechecks eligibility under lock against the original captured `cutoff_at`.
    - Executes atomic `DELETE FROM public.app_session ... RETURNING session_id` and records the exact deleted count.
    - Updates audit record to status `'completed'` within the same transaction.
  - `grant_cleanup_privileges(regrole)`:
    - Procedure granting `EXECUTE` privileges on `preview_app_session_cleanup` and `confirm_app_session_cleanup` to the specified runtime role.
    - Direct `DELETE` on `public.app_session` is explicitly REVOKED and withheld from the runtime role.

### API Routes & Components
- `POST /api/v1/session-cleanups/preview`: Authenticated, active-admin-only Route Handler with CSRF protection, returning bounded preview metadata.
- `POST /api/v1/session-cleanups/[id]/confirm`: Authenticated confirmation Route Handler with cryptographic idempotency key support and strict payload validation (rejects client-supplied candidate IDs or cutoff overrides).
- `SessionCleanupPanel` (`src/components/workspace/session-cleanup.tsx`): Administrative maintenance panel mounted in `/admin` with real-time preview, countdown warnings, confirmation action, idempotent replays, and zero credential exposure.

### Verification Results
All 25 contract conditions verified across database, API, and end-to-end test suites:
- `npm run test:db`: 20/20 tests passed (`tests/db/session-cleanup.test.ts`, `tests/db/case-guards.test.ts`, `tests/db/migrations.test.ts`).
- `npm run test:api`: 88/88 tests passed across 10 suites (`tests/api/session-cleanup.test.ts` 15 tests passed).
- `npm run test:e2e`: 16/16 passed (`tests/e2e/session-cleanup.spec.ts` passed; deferred acceptance role test skipped as expected).
- `npm run typecheck` & `npm run lint`: 0 errors.
- `npm run build`: Production Next.js build clean with dynamically rendered cleanup API routes.
