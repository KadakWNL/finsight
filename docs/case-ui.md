# Investigation queue, lifecycle dialogs and event history

The investigation workspace components in `src/components/workspace` and routes in `src/app/(workspace)/cases` implement the case user interface, connecting the shared discovery workspace to the PostgreSQL 17-backed case command service and API endpoints.

| Route | Access | Behavior |
|---|---|---|
| `/cases` | Analyst, Admin | Authorized investigation queue with role-scoped tabs, status/priority filters, and pagination |
| `/cases/[id]` | Analyst (assigned only), Admin | Full case detail, subject transaction link, lifecycle state transition dialogs, and chronological audit event history |

`src/server/page-auth.ts` verifies the session user and active status before rendering each page. Unauthenticated requests redirect to `/sign-in` with safe return parameters.

---

## 1. Investigation Queue (`/cases`)

The queue is backed by `GET /api/v1/cases`, using `scope`, `status`, `priority`, `page_size`, and `offset`. Ownership scope and status are applied before pagination. The escalated tab fixes the status to `escalated`. Queue view buttons use a segmented selector with a visible selection and accessible pressed state.

### Role-Scoped Visibility & Projections
- **Analyst:**
  - Default tab (**Assigned to me**): Displays cases assigned to the authenticated analyst (`assigned_to_user_id === user.userId`).
  - **Unassigned summaries** tab: Shows unassigned cases using the server's minimal projection (`case_ref`, `transaction_id`, `priority`, `status`, `due_at`). In accordance with security contracts, `case_id` is omitted for unassigned cases to prevent unauthorized inspection prior to administrative assignment.
  - **All permitted** tab: Combines assigned cases with unassigned summaries. Cases owned by peer analysts are never revealed.
- **Admin:**
  - Default tab (**All cases**): Full visibility into every case in the system with owner labels and direct links.
  - **Unassigned** tab: Fast filter for unassigned cases needing operator assignment.
  - **Escalated** tab: Highlights cases requiring administrative oversight or return-to-review decisions.

### Queue Controls & Feedback
- Filtering by lifecycle status (`open`, `in_review`, `escalated`, `closed`, `dismissed`) and priority (`high`, `medium`, `low`).
- Page size selector (`25`, `50`, `100`) and offset pagination.
- Clear distinction between "No cases found" (empty queue) and "No cases match these filters" with filter reset options.
- Deep-linked subject transactions navigate directly to `/transactions/[id]` preserving safe `returnTo` paths.

---

## 2. Case Detail & Concealed 404 (`/cases/[id]`)

Case detail is backed by `GET /api/v1/cases/:id`, returning `{data: CaseDetail, request_id}`.

### Concealed 404 Enforcement
If an analyst requests a case assigned to another analyst (or a non-existent UUID), the API returns a concealed HTTP 404:
- The page renders the standard `ErrorState` titled **"Case not found"**.
- No indication is given whether the case exists, who owns it, or why access is unavailable, without disclosing private case existence.

### Facts & Metadata Display
- Prominent case reference header with copyable UUID disclosure (`RecordIdentifier kind="case"`).
- Status badge with color-coded operational states (`open`, `in_review`, `escalated`, `closed`, `dismissed`).
- Priority badge (`high`, `medium`, `low`).
- Subject transaction UUID deep-link with return path retention.
- Ownership indicators ("Assigned to you" for analysts; user ID or "Unassigned" for admins).
- Immutable opened timestamp, optional due timestamp, updated timestamp, and terminal resolution details.

---

## 3. Chronological Audit Event History

Case events are fetched from `GET /api/v1/cases/:id/events`, reading from the append-only `public.case_event` table. Previous events and Next events controls page through history in groups of 50. Timestamp labels follow the [workspace display preferences](discovery-ui.md#settings-and-display-preferences); recorded state snapshots retain their source values.

Events are presented chronologically with three strictly separated sections:
1. **Field Changes:**
   - Structured before $\rightarrow$ after diffs (`from_state` $\rightarrow$ `to_state`).
   - Clearly highlights attribute changes (e.g., `status: open → in_review`, `closed_at: null → <timestamp>`) without exposing private internal records.
2. **Operational Reason:**
   - Dedicated reason box rendering the user-provided rationale or resolution notes.
   - For automatic/empty notes (such as initial review start), explicitly indicates that no note was required.
3. **Evidence Reference:**
   - Direct link to the subject transaction UUID.
   - Per-operation event ordinal and operation identifier (`operation_id`).

---

## 4. Lifecycle Dialogs & Concurrency Handling

All state mutations are dispatched via `POST /api/v1/cases/:id/commands` backed by the SQL command processor and advisory transaction locks.

### Implemented Transitions
1. **Start Review (`start_review`):**
   - Permitted: Assigned Analyst or Admin when status is `open`.
   - Transitions status to `in_review`. No operational reason required.
2. **Escalate (`escalate`):**
   - Permitted: Assigned Analyst or Admin when status is `in_review`.
   - Transitions status to `escalated`. Requires operational rationale (1-2,000 characters).
3. **Return to Review (`return_to_review`):**
   - Permitted: Admin only when status is `escalated`.
   - Transitions status back to `in_review`. Requires administrative rationale (1-2,000 characters).
4. **Resolve (`resolve`):**
   - Permitted: Assigned Analyst or Admin when status is `in_review`; Admin when `escalated`.
   - Derives terminal status `closed` with resolution code `confirmed_suspicious` and required resolution notes (1-5,000 characters).
5. **Dismiss (`dismiss`):**
   - Permitted: Assigned Analyst or Admin when status is `in_review`; Admin when `escalated`.
   - Derives terminal status `dismissed` with resolution code `false_positive` or `insufficient_evidence` and required resolution notes (1-5,000 characters).
6. **Reopen (`reopen`):**
   - Permitted: Admin only when status is `closed` or `dismissed`.
   - Transitions status to `open`. Requires operational reason (1-2,000 characters).
   - In accordance with the technical contract, reopening cleans `resolution_code`, `resolution_notes`, `closed_at`, and `due_at`; preserves the original `case_id`, `case_ref`, `opened_at`, and `priority`; and resets an inactive assignee to `NULL`.

### Optimistic Concurrency Protocol (HTTP 409)
- Every command payload transmits `expected_version` and a client-generated UUID `idempotency_key`.
- If the case is modified concurrently by another process, the server returns HTTP 409 `version_conflict`.
- The dialog displays a conflict warning and automatically reloads the case version. When the action remains available, the entered draft is preserved for review and resubmission.
- A network failure clears the submitting state, displays a connection error, and preserves the draft and idempotency key for retry.

### Idempotency & Replay
- Submitting an identical command with the same idempotency key replays the previous command receipt with HTTP 200 without appending duplicate events or advancing version.

---

## 5. Accessibility & Responsive Design

- Dialogs conform to WAI-ARIA modal patterns with `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`.
- Dismissal uses native radio inputs with clickable label rows, aligned controls, selected borders and keyboard focus indicators.
- Opening a dialog moves focus to the primary input or action button.
- Pressing `Escape` cancels and closes the dialog.
- Closing or cancelling a dialog restores focus to its triggering button while that action remains available.
- The sidebar and mobile disclosure menu provide high-contrast, accessible links to `/cases` with briefcase icon indicators.
- Responsive breakpoints down to 390px prevent horizontal scrollbar clipping.
