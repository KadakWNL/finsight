# Discovery workspace

The routes in `src/app/(workspace)` provide transaction discovery over the PostgreSQL-backed APIs. The sign-in page uses the shared credential/session handlers. Screens carry a synthetic-data label; [display preferences](#settings-and-display-preferences) control timestamp and amount presentation.

| Route | Access | Behavior |
|---|---|---|
| `/sign-in` | Public | Credential form; authenticated users return to a safe workspace destination |
| `/login` | Public | Compatibility redirect to sign-in |
| `/overview` | Analyst | Assigned active work and recent high/critical transactions |
| `/admin` | Admin | Active team work and recent high/critical transactions |
| `/transactions` | Active human | URL-backed filters, signed cursor paging and masked transaction rows |
| `/transactions/[id]` | Active human | Original/base amounts, masked context, stored signals and subject-bound analyst creation |
| `/cases`, `/cases/[id]` | Analyst, Admin | Scoped queue, detail, history and lifecycle dialogs; see [case UI](case-ui.md) |
| `/settings` | Active human | Appearance, time zone, display currency and read-only account details |
| `/access-denied` | Active human | Recovery link to the user's role home |

`src/server/page-auth.ts` checks current database identity on each page. Anonymous deep links retain their path and query through sign-in. `safeWorkspacePath` accepts only workspace routes; role-specific landing rejects an incompatible overview destination.

## Read and create boundaries

The explorer and detail use the [transaction API](transaction-api.md), with no client-side replacement fixtures. Filtering resets the cursor. A failed request keeps entered filters and labels retained results as previous results. Authentication and permission failures clear fetched results. Detail data is bound to its loaded URL before any creation control appears.

The themed desktop sidebar separates role context from page content and uses square active items. At 800px and below, a disclosure menu exposes the same destinations. [DESIGN.md](../DESIGN.md) records the visual tokens and layout. Merchant names lead transaction rows. Abbreviated identifiers carry explicit `TXN`, `ACC`, `DEV`, `MCH` or `CASE` labels; these are display hints, not unique lookup keys. Detail disclosures expose and copy the original full UUID. Links, related filters and exact searches retain the full database identifier.

`GET /api/v1/overview`, implemented by `src/server/overview.ts`, accepts no query parameters. It returns `{data, has_more, request_id}` with private `no-store` caching. Each row contains `case_id`, `case_ref`, `status`, `priority`, nullable `due_at`, subject `transaction_id`, exact decimal strings `amount` and `amount_base`, `currency_code`, `merchant_name` and nullable `owner_label`.

Analysts receive only their assigned cases. Admins receive all active cases and owner display labels, including unassigned cases. Active statuses are `open`, `in_review` and `escalated`. Results contain at most 25 rows, ordered by due date ascending with nulls last, explicit high/medium/low priority, then case ID. The endpoint reports 400 for query parameters, 401 for missing/invalid sessions and 503 for a failed dependency. Errors contain `{error:{code,message}, request_id}` without database details.

The recent-risk section combines bounded high and critical transaction reads, orders by occurrence and ID descending, and shows at most five rows. It fails independently from assigned work and displays no invented totals.

`src/app/actions/create-subject-case.ts` delegates to `src/server/subject-case.ts` and the existing guarded SQL command. The action accepts only transaction UUID, idempotency UUID, priority and a trimmed creation reason. It authenticates the request, verifies its origin, requires an analyst and derives the actor from the session. SQL owns subject uniqueness, assignment, receipts and events. No migration or separate case writer is introduced.

The dialog retains its draft after cancellation, failure or session expiry. An unchanged retry reuses the idempotency key. A duplicate-subject conflict can recheck the transaction's permitted or restricted case indicator without discarding the draft. Session recovery opens sign-in in a separate tab so the draft remains available for retry.

## Shared shell handoff

`src/components/workspace/app-shell.tsx` supplies navigation, operator identity, sign-out, mobile menu and the `main-content` skip target. Each protected page must call `requirePageUser` with its own safe return path. The shared layout alone does not authorize child pages, and persistent shell state does not authorize writes.

Navigation exposes Overview, Cases and Transactions. The Settings gear sits beside the left-aligned role block at the sidebar bottom; mobile navigation includes a labeled Settings link. Authorized case references link to the [case screens](case-ui.md). The shared header uses "Investigation workspace" across routes.

The button beside FinSight collapses the desktop sidebar to icons and expands it again. Collapsed links retain accessible names, a square active selection and labels on hover or keyboard focus. Settings remains reachable at the bottom. The mobile disclosure menu keeps full labels regardless of the saved desktop choice.

## Settings and display preferences

`src/app/(workspace)/settings/page.tsx` requires an active human session. Account name, email and role are read-only. Appearance controls share state with the header theme switch. `src/components/workspace/display-preferences.tsx` applies regional choices across the workspace; `src/lib/display-preferences.ts` validates stored values.

| Control | Default | Storage | Usage |
|---|---|---|---|
| Theme | Device appearance | `finsight-theme` | Choose System, Light or Dark. System removes the explicit override. |
| Time zone | UTC | `timeZone` in `finsight-display-preferences` | Choose a supported zone or use the device zone. Transaction, case and audit timestamps and their labels use it. |
| Display currency | Original transaction currency | `currency` in `finsight-display-preferences` | `original` leads with the recorded amount/currency; `INR` leads with the recorded base amount. Both remain visible. |
| Sidebar | Expanded | `finsight-sidebar-collapsed` | `true` selects desktop icons; `false` selects full labels. |

Choices apply immediately, survive reloads and synchronize between tabs on the same origin. They belong to the browser, rather than an account profile. If storage is unavailable, the current page can still apply a choice. Invalid regional values fall back to UTC and original currency.

Display preferences do not change stored instants, decimal values, FX rates, query filters or sorting. Date range inputs remain explicitly labeled UTC. Currency display uses each transaction's existing `amount_base`; it performs no live FX conversion and offers no unsupported conversion currencies. Audit state snapshots retain their recorded values.

## Verification

`tests/unit/workspace.test.ts` checks recovery-path restrictions and exact decimal formatting. `tests/unit/display-preferences.test.ts` checks invalid preferences, date rollover and daylight saving. The PostgreSQL-backed checks in `tests/api/transactions.test.ts` cover overview scoping, recorded base amounts and authenticated, idempotent subject creation.

`tests/e2e/auth.spec.ts` covers role landing, real search/paging/detail reads, empty and invalid-filter states, restricted case metadata, case creation, draft/session recovery, keyboard dialog behavior and mobile layout. It also checks sidebar persistence and tooltips, Settings return paths, theme synchronization, regional persistence, amount presentation and cross-tab updates. Fault-injected responses are confined to failure-state checks. Normal reads and writes use the disposable PostgreSQL database.

Run the commands in [development setup](development-setup.md#verification-commands). Playwright saves desktop/mobile screenshots under ignored `test-results`; inspect those captures before changing the shared shell or responsive layout. These checks do not establish full WCAG or VS01-VS16 academic acceptance.
