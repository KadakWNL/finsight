# UI/UX specification

FinSight uses searchable tables, explainable evidence panels, and case workspaces. The interface helps an operator choose work and record decisions. All screens are designed proposals; no frontend is implemented. [Information architecture](information-architecture.md) owns routes and page inventory; [product workflows](product-workflows.md) owns action permissions.

Wireframes below use field placeholders rather than production figures. There are no fabricated financial metrics. Future demo fixtures must carry a persistent “Synthetic demo data” label.

## Visual design system

Use a restrained light theme, white surfaces, neutral borders, and navy navigation. Risk colour communicates severity; text and symbols carry the same meaning. No gradients, glass surfaces, decorative charts, or animation-driven task flow are needed.

| Token group | Proposed values | Use |
|---|---|---|
| Surfaces | Canvas `#F8FAFC`, panel `#FFFFFF`, muted `#F1F5F9`, border `#CBD5E1` | Separate work regions without card overload |
| Text | Primary `#0F172A`, secondary `#475569`, link/action `#1D4ED8` | Body, metadata, actionable destinations |
| Risk | Low text `#166534` on `#F0FDF4`; medium `#92400E` on `#FFFBEB`; high `#9A3412` on `#FFF7ED`; critical `#991B1B` on `#FEF2F2` | Compact badge with label and icon; test rendered contrast before shipping |
| Status | Neutral open, blue review, amber escalated, green closed, gray dismissed | Separate status badge from risk and priority |
| Typography | System sans; body 14-16px; table 14px; section 18px; page 24px; metadata minimum 12px | Consistent hierarchy; tabular numerals for money/time; monospace only IDs |
| Spacing | 4px base; 8/12/16/24/32px scale | Compact rows with clear section separation |
| Shape | 6px control and 8px panel radius; subtle dialog shadow only | Low visual noise |
| Focus/targets | 2px visible focus ring with offset; targets at least 44px; compact text inside adequate hit area | Keyboard/pointer use |
| Icons | Consistent 16/20px line icons with labels | Search, filter, sort, history, external context, warning |

Design target: WCAG 2.2 AA, including 4.5:1 normal text contrast and 3:1 relevant large text/control boundaries. These are acceptance targets, not measured compliance. Colour alone never identifies risk, priority, disabled state, or errors.

Currency is always explicit. Render decimals using the selected locale without floating-point rounding. Display original `amount` with `currency_code`; cross-currency aggregates use `amount_base` and the label “INR (base)”, per the [reporting currency contract](architecture-gaps.md#reporting-currency-contract). Debit/credit has a label and optional sign for display, while source amount stays positive.

Store instants as documented `timestamptz`; display a clear application timezone label, proposed Asia/Calcutta for the academic demo, with UTC available in details. Date filters show inclusive start and exclusive end semantics. Avoid relative timestamps as the only history value. Mask account numbers to an approved suffix, mask customer email/phone, and label unavailable/redacted values explicitly.

## Component hierarchy and responsive layout

```text
Application shell
  Skip link / role navigation / account menu
  Breadcrumbs / page title / scoped actions
  Page status region (synthetic label, errors, freshness)
  Filter bar or object summary
  Table / investigation workspace / form
  Pagination and local feedback

Investigation workspace
  Case header (reference, status, priority, owner, due)
  Main evidence column (subject, signals, confirmed notes)
  Context column (relationships, permitted state actions)
  Event history tab/panel
```

Desktop uses a 224px navigation rail and a content area with 24px gutters. Detail pages use roughly two-thirds main content and one-third context. At compact widths, navigation becomes a drawer and panels stack in task order. At phone widths, tables retain core columns with horizontal scrolling and an accessible “Columns” control; rows do not hide mandatory risk/status information.

Tables use semantic headers, sticky header where useful, explicit row links, aligned numeric cells, and `aria-sort`. Sort controls are keyboard operable and announce order changes. A row click can supplement its primary link; selection and nested links must remain independently operable. Do not introduce bulk case mutations in the first release.

Shared components: risk badge, priority badge, status badge, masked identifier, owner selector, filter chips, date range, decimal amount range, searchable entity selector, signal explanation row, timeline entry, empty state, retry panel, conflict review, and confirmation dialog. Table column presets are per screen rather than one universal entity table.

## Interaction placement

| Action | Placement | Reason |
|---|---|---|
| Search/filter/sort/reset | Inline toolbar; advanced filters in popover/drawer | Repeated query refinement keeps the table visible |
| Inspect transaction/entity/case | Dedicated detail page | Evidence and history need deep links and space |
| Start review | Header button with immediate server result | Routine single transition with no extra input |
| Set priority | Inline labeled select with save feedback | Small bounded value change; audit prerequisite still applies |
| Assign/reassign | Owner picker and confirmation when replacing an owner | Dispatch action needs target validation and context |
| Create case | Dialog from transaction detail | Small subject-bound form; preserve transaction context |
| Add note | Inline composer on case page | Frequent investigation task; keep evidence alongside draft |
| Escalate/resolve/dismiss/reopen | Focus-managed dialog with reason/outcome fields | State-changing action needs deliberate justification |
| User edit | Detail sheet; create account in focused form | Few fields, with assignment/last-admin warnings from backend |
| Rule create/edit | Proposed dedicated subflow | Dimension semantics and before/after review need room |
| Redaction process / telemetry cleanup | Proposed preview, then explicit confirmation workflow | Multi-store/irreversible effect needs exact scope and recoverable progress |

Dialogs name the subject, explain the consequence, validate inline, and return focus after closing. Use explicit action labels such as “Escalate case”, not “Yes”. Cancel does not discard note drafts. Confirmation is reserved for consequence-bearing actions; routine filtering and navigation have none.

There is no generic undo for financial facts, history, role changes, or redaction. Recovery uses admin reassignment/reactivation, audited reopening, or idempotent retry where appropriate. Undo must not delete an event or restore erased personal data.

## Screen specifications

These wireframes describe target screens. The [first slice](requirements-traceability.md#first-vertical-slice-and-acceptance-tests) delivers a smaller usable subset, with the same visual system and permission boundaries.

| Surface | First-slice controls | Later controls withheld |
|---|---|---|
| Analyst navigation/overview | Overview, Transactions, Cases; assigned work | Entity navigation, notes, future operational summaries |
| Transaction explorer/detail | Exact ID/date/status/risk filters, pagination, facts/signals, analyst self-owned case creation | Semantic switch, undelivered entity destinations/advanced filters, admin creation/owner form |
| Queue | Owned/minimal-unassigned analyst views and admin oversight; permitted detail links | Dispatch/reassignment picker and post-create priority edits |
| Case detail | Status/owner/priority display, start review, resolve/dismiss/escalate, history; admin return/reopen | Note composer, assignment/priority/due editors; show availability text without an active save action |
| Admin overview/navigation | Case escalation/oversight list, Overview and Cases | Users, rules, governance mutation forms, redaction processing, cleanup/export/dependency controls |

General admin mutations, rule editing, and redaction are unavailable until the [capability gates](architecture-gaps.md#capability-gates) pass. UI availability comes from server capability/permission results; hiding a form is not the enforcement. Rule or user catalog reads may arrive before their edit controls.

### S02: Analyst overview

The analyst chooses the next assigned review or finds recorded high-risk activity. Primary action is “Open case”; secondary action is “Explore transactions”. Real authorized queue counts, if shown, link to their exact query and reflect the same filters.

```text
[Navigation]  Overview                    [Operator / analyst]
              Synthetic demo data · Display timezone
              My work     [priority] [due: all / overdue]
              Case ref | Priority | Status | Due | Subject | Open
              [assigned work ordered by due, then priority]
              Recorded high/critical signals [date window]
              Time | Transaction | Merchant | Amount/currency | Risk | View
              [Explore transactions]
```

`INVESTIGATION_CASE` supplies the first list; `TRANSACTION` plus `v_transaction_risk` supplies the second. Due ordering places null due dates last; priority uses explicit high/medium/low order. No balances, total fraud loss, or confidence percentages appear as headline KPIs.

Loading shows list skeletons. Empty work invites discovery; no signals invites widening the date range. Each section can fail and retry independently. Successful selection opens S06 or S04. Another analyst's case details are never displayed here.

### S03: Transaction explorer

The operator locates transactions using reproducible query controls. Primary action opens a transaction. Secondary actions reset filters, choose columns, or switch to authorized semantic mode when implemented.

```text
Transactions                       [Keyword | Semantic (gated)]
[Description / exact transaction ID] [Search]
[Date] [Risk] [Status] [Account] [Merchant] [Amount + currency]
[Applied filter chips] [Reset]                       [Columns]
Time ↓ | Transaction ID | Account | Merchant | Amount | Direction
       | Status | Risk band + score | Signals | Case indicator
[rows with explicit transaction and entity links]
[Previous] [Next] [Page size: 25 / 50 / 100]
```

Default sort is `occurred_at DESC, transaction_id DESC`. Supported alternate orders are amount, risk score, or status with stable ID tie-breakers; the API allowlists them. Amount filtering requires a selected currency or explicit base-amount mode. Risk values derive from stored signals; they are not editable columns.

Filters reset the cursor and persist safe query state. Search results identify keyword rank or semantic distance as retrieval relevance, never fraud probability. Semantic note hits appear in a separate result grouping linking to permitted cases. First-release keyword mode is available without vector prerequisites.

The filter-empty state offers reset, while dataset-empty explains no transactions exist. API failure keeps filters and prior results labeled stale. Success shows bounded rows and next-page availability; no false exact total is required. Export is absent until its permission/audit contract is approved.

### S04: Transaction detail and risk explanation

The operator decides whether a transaction merits investigation. Primary action is “Create case” or a permitted existing-case link. Secondary actions compare related activity and inspect rule context.

```text
Transactions > Transaction ID                  [Create/Open case]
Amount + currency / direction      Risk band · Score · Signal count
Occurred at + timezone             Status / type
Main                                      Context
  Transaction facts                         Masked account >
  Description                               Customer >
  Transaction-time location                 Merchant >
  Instrument type / last4                   Device >
  Recorded signals                          Existing case indicator
  Rule | Observed | Contribution | Time
  Expand: evidence; current config label
  Score equation: sum of recorded contributions
Related activity [same account / merchant / device] [date]
  Time | Transaction | Amount/currency | Status | Risk
```

Facts use actual transaction fields including `exchange_rate`, `amount_base`, merchant-time country/city, and nullable `method_id`. Current merchant location is labeled current to avoid rewriting historical context. No raw `PAYMENT_METHOD.token` or full device payload appears by default.

An expanded signal displays `RISK_RULE.rule_code`, `rule_name`, `dimension`, and `RISK_SIGNAL.evidence`/values. Missing historical rule parameters are labeled unavailable. Disabled current rules do not erase past signals. Zero signals shows “No recorded signals” with the completeness caveat.

Create-case dialog has subject ID, priority, and required creation reason (1-2,000 trimmed characters), stored in `CASE_EVENT.reason`. Its subject is immutable. Admin creation/owner selection is a later case-expansion scope; the first slice offers analyst self-owned creation only. A duplicate race returns the permitted existing case or a restricted indicator. Missing related panels warn locally; subject not found is a full-page state. Case ownership restrictions affect the case link, not the transaction evidence.

### S05: Investigation queue

Analysts select owned work; admins dispatch and review escalations. Opening a permitted case is primary. Admin assignment is secondary and clearly distinguished from investigator work.

```text
Cases                  [Mine] [Unassigned summaries] (analyst)
                       [All] [Unassigned] [Escalated] (admin)
[Case reference] [Status] [Priority] [Due] [Owner: admin only]
Case ref | Priority | Status | Owner | Due | Subject | Updated
[Open case]                [Assign/reassign: admin only]
[Previous] [Next]
```

Owner is `APP_USER.display_name` from `assigned_to_user_id`, with inactive identity labeled for admin attention. Analyst unassigned summaries omit private owner/notes/resolution details and do not link to private case detail. Another owner's cases are excluded from analyst queue totals.

Default sorting uses nonterminal work, overdue first, due time, priority, then stable case ID. Optional updated-time order includes `updated_at,case_id`. There are no bulk resolve or bulk delete actions. A successful assignment updates the owner and event history. A race keeps the selection and presents the current owner for review.

Empty states distinguish no assigned work from no filtered matches. Null due time is “No due time”, not overdue. List failure has retry; access failure navigates to permitted overview.

### S06: Investigation case detail

The analyst gathers evidence and records a defensible outcome. Primary action reflects state: start review, add note, or resolve. Escalation and admin controls remain labeled secondary actions.

```text
Cases > Case ref       Status | Priority | Owner | Due
                       [Start review] [Escalate] [Resolve / Dismiss]
Main evidence                              Case controls
  Subject transaction >                      Priority select
  Risk explanation summary                   Owner (admin picker)
  Related account / merchant / device >       Opened / updated / closed
  [Notes] [Event history]                     Resolution summary
  Confirmed notes: author, exact time, body   [Reopen: admin terminal]
  Note composer: body + referenced IDs
  [Save note] [pending/confirmed/failed state]
History: Time | Actor | Event | Field changes | Reason | Evidence reference
```

Resolution controls follow the fixed [outcome mapping](product-workflows.md#resolution-and-reopening-contract). “Resolve case” offers `confirmed_suspicious` and shows resulting status `closed`. “Dismiss case” offers `false_positive` or `insufficient_evidence` and shows `dismissed`; the latter is labeled inconclusive. Status is derived and read-only, never an independent outcome selector.

All outcomes require trimmed `resolution_notes` of 1-5,000 characters. The server mirrors that rationale to the terminal event's `reason`. Escalation, return-to-review, and reopen dialogs require rationale of 1-2,000 characters, stored in the same dedicated event field. State JSON shows structured field changes only; note references appear separately from later `metadata` support.

The reopen dialog states that it retains the case identity/original opened time and clears the current resolution, completion time, and due time. It displays the retained active analyst or a pending unassigned reset; it offers no owner/due override. Prior terminal outcome/rationale remains in history. A competing active case blocks reopening with a recoverable conflict message and no change.

Closed/dismissed pages keep history readable and offer no note edit or routine state controls. Reason inputs instruct operators to use operational justification without direct customer identifiers or copied note bodies. Existing accidental PII in immutable rationale requires the later governance policy rather than a delete-history control.

Note references must name existing authorized data; unsupported uploads are absent. History renders allowlisted state diffs, dedicated reason, and typed evidence reference as separate regions, following the [case-event contract](product-workflows.md#case-event-contract). Operation identity can be available in authorized diagnostic details, without mixing it into case field changes. Priority changes require the event extension and scope tests before the control is active.

On conflict, show current changed fields beside the operator's draft and offer reload/review, not blind force-save. Pending Mongo finalization stays visible until confirmed; retries reuse the operation. Event and note loading failures are independent. Empty notes invite the permitted composer; an empty history on an existing case signals missing implementation/data, not a fabricated creation event.

### S08: Entity detail and related activity

Entity detail helps compare transactions sharing a real relationship. Primary action opens a related transaction; secondary actions move to connected entities or refine the date window.

```text
Entities > Type > Entity ID             [Related transactions]
Identity / masked attributes / status
[Summary] [Related activity] [Telemetry: device only, gated]
Type-specific details
  Accounts/customer relationships OR merchant profile OR device metadata
Related activity [Date] [Risk] [Status]
Time | Transaction ID | Merchant/Account | Amount/currency | Risk | Case
[Previous] [Next]
```

| Type | Real representative fields | Relationships / aggregate |
|---|---|---|
| Customer | `customer_id`, masked `full_name`/email/phone, country, status, `kyc_verified_on` | Accounts, primary/general addresses with masked PII; proposed implementation of `v_customer_spending_summary` |
| Account | Masked `account_number`, type, currency, balance, status, `opened_at` | Customer, payment method type/last4/status, transactions; base-amount aggregates clearly labeled |
| Merchant | Name, `category_code`, current country/city, `risk_tier`, `is_watchlisted` | Transactions and documented `v_merchant_risk_profile` purpose; no stored merchant embedding assumed |
| Device | ID, abbreviated hash, `os_family`, first-seen country/time | Transactions; proposed Mongo telemetry panel if its contract exists |

S07 entity explorer uses type-specific columns matching this table and searches within a selected type. No generic “risk score” is invented for customers/accounts/devices. Merchant tier is separate from observed signal rate. Spending totals state date window, posted-only eligibility, and base currency; reversed/pending amounts are not silently counted as posted spend.

Unavailable attributes show “Not recorded” or “Redacted” only when that provenance is known. No related transactions is a valid empty state. A failed telemetry panel does not block SQL activity. All case indicators honor resource policy.

### S09: Admin overview

The admin selects dispatch and governance work. Primary action is assigning unowned work; secondary actions review escalations or requests.

```text
Admin overview                          [Operator / admin]
Work needing attention
  Unassigned: Case ref | Priority | Due | Subject | Assign
  Escalated: Case ref | Owner | Updated | Open
Governance
  Pending redactions: Request ID | Customer ID | Requested | Review
  Operator access: inactive/assignment exceptions > Users
Dependencies (proposed read-only checks)
  PostgreSQL | MongoDB | vector extension    checked time / unavailable
```

Sections query actual cases, users, and requests. Counts must link to scoped lists. No ingestion throughput, model accuracy, or uptime metric appears without recorded data. Dependency checks disclose coarse availability, never credentials, connection strings, or stack traces.

Loading/error states are per section. “No pending redactions” differs from “Request service unavailable”. Successful dispatch returns to the updated queue. There is no operator impersonation or admin bypass control.

### S10: User and role management

The admin maintains human operator access. Read functionality is supported by `APP_USER`; mutations are proposed and require general audit plus assignment safeguards.

```text
Users                   [Create operator: proposed, gated]
[Email/name search] [Role] [Active]
Display name | Email | Role | Active | Last login | Active cases | Edit
Edit sheet
  Display name / email
  Role: analyst or admin
  Active status
  Assigned work impact > queue
  [Review change] [Save with audit] [Cancel]
```

Create requires email, display name, human role, and protected password provisioning. Password hashes never display; password values are never included in change diffs. Email uniqueness/canonicalization requires a defined backend/database policy.

System identity is visibly protected and read-only or omitted from the human list. The last active admin cannot be disabled/demoted. An assigned analyst cannot be disabled/demoted until active work is reassigned/unassigned. Prevent these races in the backend, not through a warning alone.

Success confirms the changed operator and active session policy. Uniqueness errors attach to email; conflict preserves the form. Empty search offers reset; audit-unavailable state blocks mutation with a prerequisite explanation. Deletion is absent.

### S11: Risk-rule management

The first-release admin catalog explains active detection rules. Primary action inspects a rule; secondary action opens transactions with recorded firings. Creation/editing/activation are proposed follow-on workflows.

```text
Risk rules                  [Read-only until revision/audit gate]
[Code/name] [Dimension] [Active]
Code | Name | Dimension | Weight | Threshold | Active | Version
Rule detail
  Current configuration / parameter semantics
  Recorded firings [date] > filtered transaction results
  Historical firing configuration: unavailable until revision support
Proposed edit workflow
  Supported dimension → parameter form → validation → diff → confirmation
```

Catalog fields come from `RISK_RULE`. “Affected transactions” means records joined through `RISK_SIGNAL.rule_id`, not hypothetical future firings. Counts specify date window. Preview/replay requires missing evaluation-run support and is excluded from the first release.

Proposed forms constrain `dimension` to the documented values and require positive version progression, finite nonnegative weight, and dimension-specific threshold units/ranges. Generic SQL expressions or executable rule code are never accepted. Disabling preserves prior signals.

Empty catalog shows no configured rules. Read failure has retry. Proposed edit failure preserves fields; revision conflict requires review. Until prerequisites exist, the interface states the read-only boundary without pretending a change was saved.

### S12: Audit and governance

The admin inspects case history and redaction requests. General administrative audit and processing forms are explicit proposals with storage/recovery prerequisites.

```text
Audit and governance
[Case events] [Redaction requests] [Admin audit: proposed]
Case events: [Date] [Actor] [Case] [Type]
Time | Case ref | Actor | Type | Change summary | Inspect
Redactions: [Status] [Customer ID]
Request ID | Customer ID | Scope | Status | Requested | Processor | Completed
[Proposed request]  Detail: preview approved fields and store coverage
  [Reject with reason] [Confirm processing] [Retry failed step]
Admin audit: proposed actor/action/target/time/result, no sensitive values
```

Case events come from immutable `CASE_EVENT`, joined to case and actor. Redaction fields come from `PERSONAL_DATA_REDACTION`; step progress/rejection reason require the proposed audit/operation contract. Raw `scope` text is displayed safely and never interpreted as executable SQL.

The redaction preview distinguishes financial facts retained from PII fields processed. It shows all affected stores and warns of irreversible personal-data removal. Completion success appears only after required cross-store steps confirm. A terminal request has no rollback button.

No events/no requests are valid empty states. An absent general audit implementation is labeled as such. Event load errors have retry; a cross-store failure keeps request pending and allows authorized recovery. Financial deletion is absent. Telemetry cleanup, if approved, can be a maintenance subflow with eligible count/scope preview and audited confirmation rather than a new primary page.

### Supporting authentication and feedback screens

S01 sign-in uses labeled email/password fields, reveal-password control with accessible state, submit button, and generic error region. No registration link is shown. Successful authentication navigates to the role landing page; loading disables duplicate submission without trapping focus.

S13 access denied shows a concise permission message and permitted overview/sign-out actions. A private case returns a not-found screen with no note/owner details. Not-found and service errors preserve global navigation. Every error references a correlation ID when useful, without raw database errors.

## Accessibility and state acceptance

Keyboard users can reach navigation, filters, sort headers, row links, tabs, dialogs, and all case actions in a logical order. Dialogs trap focus, support Escape where safe, and return focus. Destructive or irreversible actions require an explicit confirm button, not Enter on an unrelated field.

Loading announces pending work without replacing already visible data with zero totals. Errors use an alert region; success and filter-result changes use a polite live region. Form errors are associated with fields and summarized at the top. Reduced-motion preferences suppress transitions.

Verification must include keyboard-only case resolution, screen-reader table/filter semantics, rendered contrast, compact-width table access, 200% zoom, expired-session recovery, and conflict draft preservation. [Requirements traceability](requirements-traceability.md) defines the corresponding implementation acceptance gates.
