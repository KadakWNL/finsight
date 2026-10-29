# Requirements traceability

This document defines proposed requirements, backend contracts, database operations, and acceptance evidence. None of the APIs or enforcement described here exists yet. [Architecture assessment](architecture-gaps.md) owns repository evidence; [product workflows](product-workflows.md) owns authorization and transitions; [screen inventory](information-architecture.md#page-inventory) defines screen IDs.

## Functional requirements

| ID | Requirement and status | Workflow / screens | Backend contract | Acceptance criterion |
|---|---|---|---|---|
| F01 | Required credential authentication and role enforcement | Authentication / S01,S13 | Auth.js integration, current `APP_USER` lookup | Valid active human signs in; inactive/system account fails generically; direct unauthorized API requests fail |
| F02 | Required session expiry/sign-out | Authentication / all protected screens | Session invalidation/current-role checks | Sign-out prevents reuse; expiry prevents writes; deactivation/demotion applies on next request |
| F03 | Required transaction discovery | Monitoring / S02,S03 | Transaction list with validated filters/cursors | Date/risk/status/account/merchant/amount/search compose correctly; bounded stable pages; no-signal transactions retained |
| F04 | Required risk explanation | Monitoring / S04 | Detail join and signal aggregation | Score equals sum of contributions; bands match documented thresholds; no-signal caveat and current-rule labels present |
| F05 | Required entity context | Monitoring / S07,S08 | Typed entity detail/activity joins | Customer-account links and shared merchant/device activity use actual IDs; PII/token fields respect projection |
| F06 | Required case creation and dispatch | Investigation / S04,S05,S06,S09 | Atomic case create/update | Concurrent creation yields one active case and permitted existing-case result; only admin can reassign |
| F07 | Required investigation lifecycle | Investigation / S06 | Guarded case state mutation | Allowed transitions succeed; code derives exact terminal state; reopening uses fixed resets; invalid operations change neither case nor event |
| F08 | Required traceable case history | Investigation / S06,S12 | Protected function emits typed events; immutability trigger blocks history mutation | Dedicated `reason`/`metadata`/`operation_id`; truthful state diffs, server actor, unique command events; application cannot update/delete/insert arbitrary events |
| F09 | Required Mongo note workflow, documented workload | Investigation / S06 | Proposed operation intent, note write, event finalization | Idempotent retry produces one confirmed note/event; Mongo failure preserves draft and eventual recovery |
| F10 | Required rule catalog; editing proposed and gated | Rules / S04,S11 | Rule reads; future revision mutation | Existing signals remain readable when current rule is disabled; edits unavailable until immutable provenance/audit is tested |
| F11 | Required operator management for oversight; mutation audit proposed | Governance / S10 | User read/create/update | Only admin changes human roles; last admin and active analyst assignment safeguards survive concurrent requests |
| F12 | Documented redaction entity; completion proposed and gated | Governance / S12 | Request read/create/update plus durable steps | Allowlisted PII removed across approved stores before completion; transaction/case facts retained; failure stays pending |
| F13 | Required full-text search; vector retrieval documented but gated | Discovery / S03,S06 | SQL FTS; authorized semantic search | Keyword matching uses stored description vector; semantic notes reveal only owned/admin-visible confirmed content |
| F14 | Required synthetic risk/evaluation demonstration | Service / S04; evaluator report | Idempotent scoring; joins to labels | Known scenario seeds produce explainable signals; precision/recall use explicit eligibility/threshold and remain separate from investigator verdicts |
| F15 | Proposed controlled telemetry DELETE for course DML | Governance maintenance / S12 subflow | Eligibility preview and audited deletion operation | Only approved expired synthetic telemetry is removed; retries are safe; no financial DELETE endpoint exists |
| F16 | Proposed read-only dependency checks | Admin / S09 | Coarse service status | Failed check shows unavailable and checked time; exposes no credentials; no fabricated job metrics |
| F17 | Deferred bulk export and auto-escalation | No first-release controls | No endpoint until policy/audit ready | First release exposes neither unrestricted export nor automatic resolution |

## Workflow-to-data matrix

Entities and fields below are names from [ER source](er-diagram.mmd), unless explicitly marked proposed. SQL examples in [ER documentation](er-diagram.md#sql-objects-outside-the-er) are design evidence, not migrations.

| Workflow/action | User role | Data/entities involved | Read/write operations | Validation and constraints | Authorization | Audit/event requirements |
|---|---|---|---|---|---|---|
| Sign in/out | Analyst/admin | `APP_USER.user_id,email,password_hash,role,is_active,last_login_at` | Credential read; last-login update; session issue/revoke | Approved password hashing; email normalization; bounded attempts | Active human only; role read server-side | Proposed auth audit, no passwords; `last_login_at` is not full history |
| List/filter transactions | Analyst/admin | `TRANSACTION`, `ACCOUNT`, `MERCHANT`, `v_transaction_risk`, permitted `INVESTIGATION_CASE` indicator | SELECT with left risk join, filters, ORDER BY, LIMIT | UUID/enums/date/decimal checks; parameterized search; original amount requires currency | Masked dataset-wide facts; case projection by actor | Read auditing proposed for sensitive access; no case event |
| Explain risk | Analyst/admin | `TRANSACTION.transaction_id`, `RISK_SIGNAL.transaction_id,rule_id,observed_value,score_contribution,evidence,triggered_at`, `RISK_RULE` | SELECT, GROUP BY/SUM/COUNT and rule join | Unique signal pair; historical version gap labeled | Same transaction visibility; no client-computed score authority | No write; immutable evidence, no fake historical config |
| Related customer/account facts | Analyst/admin | `ACCOUNT.customer_id`, `CUSTOMER`, `ADDRESS`, `PAYMENT_METHOD.account_id` | SELECT relational joins and spending summary | FK integrity; mask PII; method token excluded | Dataset-wide masked facts | General sensitive-read audit proposed |
| Related merchant/device activity | Analyst/admin | `TRANSACTION.merchant_id,device_id`, `MERCHANT`, `DEVICE_FINGERPRINT`; proposed telemetry collection | SELECT by shared ID/time; optional Mongo lookup | Typed IDs; bounded range; no missing-data inference | SQL subject visible; telemetry allowlisted fields | Read only; service errors recorded operationally |
| Case list | Analyst/admin | `INVESTIGATION_CASE`, `APP_USER.display_name`, subject transaction/risk | SELECT with ownership predicate and permitted summaries | Active/terminal vocab; pagination | Analyst own or minimal unassigned; admin all | No mutation; exclude unauthorized counts |
| Create case | Analyst/admin | `INVESTIGATION_CASE.case_id,case_ref,transaction_id,assigned_to_user_id,status,priority,opened_at,updated_at`; `CASE_EVENT` with required additions | INSERT initially unassigned case, then self/selected assignment, and events in one SQL transaction | Existing subject; active analyst target; unique case ref and active subject; command receipt | Analyst self-owner; admin selected active analyst/null (later scope) | `created.reason` records rationale; optional `assigned` follows; same `operation_id`, no metadata in state |
| Assign/reassign | Admin | `INVESTIGATION_CASE.assigned_to_user_id,version,updated_at`; `APP_USER.role,is_active` | Locked UPDATE with `expected_version` | Nonterminal; target active analyst; consistent role-change locks | Admin only | `assigned`, before/after; no event on conflict |
| Change priority | Owning analyst/admin | `INVESTIGATION_CASE.priority,version,updated_at` | Locked UPDATE | low/medium/high; nonterminal; `expected_version` | Owner or admin | Proposed `priority_changed` enum extension required |
| Start/escalate/return review | Owner/admin, admin return only | `INVESTIGATION_CASE.status,version,updated_at`; `CASE_EVENT.from_state,to_state`, required `reason` | Locked UPDATE + protected event | State graph; active assignee for review; dedicated rationale for escalation/return | Actor-specific transition policy | `status_change.reason`, status-only diffs; service automation deferred |
| Resolve/dismiss | Owning analyst in review; admin in review/escalated | `status,resolution_code,resolution_notes,closed_at,updated_at` | Atomic locked UPDATE | Fixed code/state mapping; trimmed notes; server terminal time | Owner only from in_review; admin permitted states | `status_change` has structured code/status/time diff; `reason` mirrors validated notes; single function writer |
| Reopen | Admin | Case terminal/due/assignee fields and active-case index | Locked UPDATE; optional owner reset | Terminal source; dedicated reason; no competing active case; `expected_version` | Admin; current assignee revalidated | `status_change.reason`; previous terminal event preserved; `assigned` if inactive owner reset |
| Add confirmed note | Owner/admin within note policy | `CASE_EVENT` with required additions; proposed `analyst_notes` and durable operation record | SQL intent; Mongo idempotent insert; protected SQL final event | Body limits; reference validation; operation uniqueness; confirmation state | Reauthorize case at intent and finalization | One `note_added.metadata` with Mongo ID/hash; null state/reason; dedicated `operation_id`; no raw note body |
| Search similar content | Analyst/admin | `SEMANTIC_DOCUMENT.document_id,transaction_id,mongo_note_id,doc_type,content,embedding,embedding_model,embedded_at` | Filtered vector SELECT; source/visibility verification | vector(384), model compatibility, XOR, source-aware dedup proposal | Authorize source before returning snippet/rank/count | Derived retrieval; no event; missing source excluded/reconciled |
| Inspect rules/firings | Analyst context/admin catalog | `RISK_RULE`, `RISK_SIGNAL` | SELECT plus counts/grouping | Current vs historical labels; allowed dimensions | Analyst firing context; admin full catalog | Read only |
| Edit rule | Admin, proposed | `RISK_RULE.weight,threshold_value,is_active,version`; proposed revision/snapshot/audit structures | Future validated version transaction | Units/ranges by dimension; immutable history; version conflict | Admin; feature gated | Proposed general audit; no misuse of `CASE_EVENT` |
| Manage human operators | Admin, proposed mutation prerequisites | `APP_USER`; active `INVESTIGATION_CASE` assignments | SELECT/INSERT/locked UPDATE | Email uniqueness; role check; last-admin protection; no system edits | Admin; never accepts client actor ID | Proposed general audit with safe before/after fields |
| Inspect case events | Owner/admin | Baseline `CASE_EVENT` fields plus required `reason,metadata,operation_id` | SELECT joined case/actor | Typed diffs/rationale/provenance; stable ordering; safe field projection | Owned case or admin | Append-only history; arbitrary app INSERT and all UPDATE/DELETE forbidden |
| Submit/reject redaction | Admin, proposed | `PERSONAL_DATA_REDACTION.request_id,customer_id,processed_by_user_id,scope,status,requested_at,completed_at` | INSERT pending; guarded status UPDATE | Existing customer, allowlisted scope; pending-only rejection | Admin; processor derived from session | Proposed audit/rejection reason; no invented existing reason column |
| Process redaction | Admin initiates, service recovers | Request; `CUSTOMER.full_name,email,phone`; `ADDRESS` approved PII; copied Mongo/semantic content | SQL PII UPDATE plus durable downstream cleanup/rebuild | Completion after all approved steps; restrictive FK/immutable financial facts | Admin approved intent; service exact step scope | Processor/completed time + proposed step/audit records without PII |
| Ingest/evaluate | Service | `TRANSACTION`, `ACCOUNT.balance`, rules/signals, labels/scenarios | Validated INSERT; row-locked balance UPDATE; signal INSERT | Amount/rate positive; no duplicate signal; insufficient balance rejected; method-account match | Scoped service, no human transaction writes | System case actor if future case automation; proposed ingestion provenance |
| Cleanup telemetry | Admin initiates, service executes, proposed | Proposed `device_telemetry` eligibility fields and audit/operation | Preview SELECT/aggregation; scoped DELETE | Exact eligibility scope; retained evidence excluded; retry/result reconciliation | Admin-only preview/confirm; scoped service | Durable audit intent and confirmed deleted IDs/count; no financial delete |

## Proposed API and service responsibilities

Use Next.js Route Handlers or equivalent server functions with one shared authorization/validation service. Server-rendered pages call the same service contract. API version prefix `/api/v1` is proposed; authentication endpoints depend on the approved Auth.js setup.

| Contract | Read/write purpose | Screens | Required checks |
|---|---|---|---|
| Auth sign-in/sign-out/session integration | Credential lifecycle | S01/all | Rate limit, origin/CSRF protection, active human, safe redirect, session expiry |
| `GET /api/v1/overview` | Role-scoped work sections | S02,S09 | Role-specific projections and authorized counts |
| `GET /api/v1/transactions` | Query/filter/page | S03 | Valid filters, sort allowlist, bounded cursor, masked projection |
| `GET /api/v1/transactions/{id}` | Facts, recorded signals, case indicator | S04 | Existing subject, visibility, safe current/historical rule labels |
| `GET /api/v1/entities/{type}` and `/{type}/{id}` | Typed list/detail | S07,S08 | Type/ID allowlist; mask projection |
| `GET /api/v1/entities/{type}/{id}/transactions` | Related activity | S08 | Existing entity, parameterized join path, bounded pagination |
| `GET /api/v1/cases` and `/{id}` | Queue and detail | S05,S06 | Own/full admin predicates; unassigned summary DTO; private ID concealment |
| `POST /api/v1/cases` | Create subject case | S04 | Idempotency key; analyst server-owned assignment; active-case uniqueness |
| `PATCH /api/v1/cases/{id}` | One allowed assignment/priority/state operation | S05,S06 | `expected_version`, operation-specific field allowlist, state/role guard, SQL transaction |
| `GET /api/v1/cases/{id}/events` | Immutable history | S06 | Case authorization; event cursor and safe payload |
| `GET/POST /api/v1/cases/{id}/notes` | Confirmed notes / durable save intent | S06 | Case authorization; confirmed-only reads; append-only/idempotent write |
| `GET /api/v1/operations/{id}` | Actor-permitted note/redaction/cleanup progress, proposed storage | S06,S12 | Creator/admin scope plus current resource permission; no other actor intent or sensitive payload disclosure |
| `POST /api/v1/search` | Protected semantic query, or sensitive keyword query transport | S03 | Query length/model checks; source permission; bounded results; no sensitive URL logging |
| `GET /api/v1/rules` and `/{id}` | Admin catalog; analyst firing-context projection | S04,S11 | Role/context restrictions; no mutation endpoint in first release |
| `GET /api/v1/users`; proposed `POST`, `PATCH /{id}` | Operator administration | S10 | Admin, last-admin/assignment locks, immutable system identities, audit transaction |
| `GET /api/v1/governance/events` | Case event oversight | S12 | Admin; bounded queries; general admin audit separate when implemented |
| `GET/POST /api/v1/redactions`; proposed `PATCH /{id}` | Read/request/decision/processing intent | S12 | Admin, allowlisted fields, guarded status, cross-store recovery gate |
| Proposed `GET /api/v1/health` | Coarse read-only dependency checks | S09 | Admin, short timeout, safe result |
| Proposed telemetry cleanup preview + `POST /api/v1/telemetry-cleanups` | Audited scoped maintenance operation | S12 subflow | Admin, immutable eligibility snapshot/confirmation, durable audit prerequisite |

These endpoints are contracts to implement, not discovered APIs. Generating an OpenAPI definition and request/response examples belongs to backend implementation. There is no financial transaction DELETE route, unrestricted table editor, public registration, or client-supplied SQL.

`PATCH` handles one semantic case operation at a time. It must not allow mass assignment of `case_ref`, `transaction_id`, actor IDs, timestamps, or raw event JSON. State bodies use a semantic `action` and `reason` for escalation/return/reopen, or `resolution_code`/`resolution_notes` for an outcome, plus `expected_version`. The backend derives terminal status from the code and rejects a conflicting target. Reopen accepts no owner/due/resolution override. Changes in assignee or priority use separate requests/events.

Create bodies include `transaction_id`, `priority`, and required `reason`; an analyst cannot supply another owner. The guarded service maps API rationale to `CASE_EVENT.reason`, never to state JSON. Terminal rationale has one input (`resolution_notes`) and is copied to event reason by the server. Events are not a public POST resource.

Collection responses contain `data`, `page_size`, `next_cursor`, and `request_id`; exact totals are optional and scoped. Detail/mutation responses return permitted data plus case `version` and informational `updated_at` when relevant. An async note/processing request returns 202 with operation ID; confirmation returns/retrieves the committed record. A synchronous create returns 201.

Use keyset pagination for time-ordered explorer/history; each order includes a unique ID tie-breaker. Mutable risk/priority queues may shift between requests: explain that they represent live data. An opaque signed cursor binds filter/sort and authorized actor scope. A stable report snapshot is deferred; page navigation must not promise a frozen dataset.

## Validation, integrity, and concurrency

Validate UUIDs, role/state enums, date ranges, page size (default 25, maximum 100), sort keys, string lengths, and decimal inputs before database work. Proposed limits: note body 10,000 characters, reason 2,000, resolution notes 5,000, search query 500. Confirm these product limits before migration/API implementation.

Database constraints remain authoritative for direct SQL writes. Foundational DDL uses the finalized [INR/decimal contract](architecture-gaps.md#reporting-currency-contract) and [ER relationships](architecture-gaps.md#er-relationship-contract), PK/FK/unique/check constraints, signal uniqueness, active-case partial uniqueness, resolution mapping, event-shape checks, and nonnegative balance. Semantic source/dimension checks and vector indexes wait for the retrieval milestone; no embedding choice blocks foundational DDL.

Case mutation transaction: lock the case; read/lock current actor and assignee as required; compare `expected_version`; validate permission/state; update allowed fields; append typed events and command receipt; commit. Every accepted existing-case mutation increments the positive integer `version` atomically under the lock, including assignment and priority changes when enabled. Creation initializes `version` to 1. A stale version leaves case, events and successful receipt unchanged. The finalized single writer is the guarded SQL case mutation function, not an application INSERT plus a generic audit trigger. Redesign or omit documented `trg_case_audit` accordingly. Trusted actor/operation context is server-derived and cannot survive a pooled connection into an unrelated command.

A status guard and privileges must protect invariants when the database is called outside an HTTP handler. Database functions expose only approved mutation operations. Their event writer validates [event shapes and reasons](product-workflows.md#case-event-contract), and terminal checks enforce [resolution/reopen invariants](product-workflows.md#resolution-and-reopening-contract). App direct case DML/event INSERT is denied; function execution is granted narrowly. Event UPDATE/DELETE is blocked through privilege revocation plus the documented immutability trigger. DB superuser/migration credentials never run the app.

Coordinated locks for user role changes and assignments must have a deterministic order. Last-admin protection requires serialization of the relevant admin set or a dedicated advisory lock, not a vulnerable count-then-update. Handle deadlock/serialization errors with bounded retries for safe idempotent operations.

The documented balance strategy uses `SELECT ... FOR UPDATE` on `ACCOUNT`; validate available balance before a posted debit and insert/update atomically. The approved ingestion policy must specify which statuses affect balances and how reversals work. The operator UI cannot change balances or transaction statuses. Synthetic test seeds demonstrate an insufficient-funds race without real payments.

POST retries carry idempotency keys and a payload digest in proposed durable operation storage. Reuse with the same payload returns the prior result/progress; reuse with a different payload returns conflict. Keys are scoped to actor/action/resource. Disabled users cannot regain access through an old idempotency result.

## Query and index plan

The following is a proposed implementation/demo plan grounded in the ER's documented objects. Extra indexes require representative `EXPLAIN (ANALYZE, BUFFERS)` evidence rather than blanket addition.

| Query/operation | SQL features and real joins | Documented index / proposed supplement |
|---|---|---|
| Explorer | `TRANSACTION` left joins aggregated `v_transaction_risk`, joins account/merchant; ORDER BY/LIMIT | Documented `idx_transaction_account_time`, `idx_transaction_occurred_brin`; proposed `(occurred_at DESC,transaction_id DESC)` for cursor |
| Description search | Generated `search_vector`, parameterized `plainto_tsquery`, `ts_rank` | Documented GIN `idx_transaction_search`; rank query remains bounded |
| Risk explanation | `RISK_SIGNAL` joins `RISK_RULE`; GROUP BY transaction, SUM contribution, COUNT signals | Documented `uq_risk_signal_per_rule`; FK indexes where uncovered |
| Active-case lookup | `EXISTS` subquery on subject/status; permission-aware projection | Documented partial `uq_case_open_per_transaction` |
| Owned/due queue | Case joins assignee/subject; explicit priority sort; null due order | Proposed `(assigned_to_user_id,status,due_at,case_id)` after plan measurement |
| History | Case-event join, ORDER BY `occurred_at,event_id` | Proposed `(case_id,occurred_at,event_id)` |
| Merchant/device activity | Transactions filtered by merchant/device and time | Proposed `(merchant_id,occurred_at,transaction_id)` and `(device_id,occurred_at,transaction_id)` |
| Spending summary | Customer joins account/transaction; posted eligibility; SUM `amount_base`, AVG, COUNT, GROUP BY | Documented `v_customer_spending_summary` needs definition; account-time supports drill-down |
| Repeated flagged activity | Group by account/merchant; HAVING COUNT matching flagged transactions above approved threshold | Proposed query for investigation, no invented alert entity |
| Velocity | Account/time-window aggregation or window function; materialized view refresh | Documented `mv_account_velocity`; exact definition/window and refresh protocol missing |
| Daily totals | GROUP BY approved base currency/date; status/direction semantics explicit | Documented `mv_daily_spend`; use only when a task needs totals and freshness is shown |
| Semantic discovery | Cosine `<=>`; doc type/model filters; relational/Mongo source authorization | Documented HNSW `idx_semantic_document_embedding`; source-aware content uniqueness correction required |
| Evaluation | `TRANSACTION_LABEL` joins `FRAUD_SCENARIO` and derived risk; conditional aggregates | Ground truth is demonstration-only; no use as live investigation answer |

Foreign-key columns need coverage appropriate to joins/deletion checks; an existing leading composite index may already provide it. The ER's BRIN proposal assumes time-correlated physical storage; synthetic ingestion and plans must verify that assumption. Dynamic aggregate risk filtering can require full aggregation; optimize only after measuring, without adding a drifting risk column.

Useful proposed functions: guarded case mutation, validated rule scoring, and redaction scope application. Their names/bodies do not exist. Materialized-view refresh must be scheduled after scoring and expose refresh freshness. Exact model, 384-dimensional compatibility, canonicalization, and batch sizes are decisions at semantic retrieval, with vector/source DDL delivered there.

For MongoDB, demonstrate a bounded aggregation grouping telemetry by device/time and schema-specific anomaly category. Its field definitions belong to the approved telemetry contract. Prove validators/indexes using diverse synthetic documents; do not fabricate a collection implementation from its proposed name.

## Error handling and security requirements

| Result | HTTP/service outcome | Required behavior |
|---|---|---|
| Malformed input | 400 | Field errors; no SQL call with invalid sort/type |
| Semantically invalid form/state | 422 | Stable error code and allowed transition guidance |
| Missing/expired authentication | 401 | No writes; safe reauthentication |
| Forbidden admin/action | 403 | No restricted data fetch; permitted navigation |
| Absent/private case | 404 | Conceal private detail; no ownership leak |
| Concurrent token / uniqueness / idempotency mismatch | 409 | Current permitted resource/version; preserved draft |
| Rate limit | 429 | Retry guidance; generic authentication message |
| Dependency unavailable | 503 | Retryable bounded failure; no zero/healthy substitutes |
| Unexpected failure | 500 | Generic error, correlation ID, sanitized server log |
| Durable work accepted | 202 | Operation state, not a false success claim |

Errors use `code`, `message`, optional `field_errors`, `request_id`, and `retryable`. Diagnostic logs omit passwords, tokens, connection strings, raw note bodies, and customer PII. General security/admin audit is proposed persistence with server actor, action, target, time, safe before/after, reason/result, and operation/request ID. It is distinct from `CASE_EVENT` and cannot be assumed to exist. [Capability gates](architecture-gaps.md#capability-gates) prohibit operator/rule/redaction mutation handlers until their audit/integrity prerequisites pass. Admin case transitions use the guarded case event contract and can appear in the first slice.

Use parameterized hand-written SQL and allowlisted identifiers. Validate/escape display content, enforce same-origin protections for unsafe requests, bound payloads/queries, and use protected cookies. Credentials live in environment variables per academic item 10; no database secrets reach browser bundles. Access policies apply to notes, embeddings, cursors, aggregates, and error messages, not just visible buttons.

## Non-functional acceptance targets

Targets below are proposed demo gates, not measured performance or availability claims. Record hardware, dataset size, query plans, and results during implementation.

| ID | Requirement | Proposed verification |
|---|---|---|
| N01 | Data integrity | Direct SQL attempts reject invalid enum, negative amount/balance, mismatched method/account, duplicate active case/signal, orphan FK, and event modification |
| N02 | Authorization | API tests cover both human roles, system sign-in rejection, analyst A/B ownership, unassigned summaries, inactive user, and note-search leakage |
| N03 | Atomicity/concurrency | Two simultaneous case creates, conflicting case updates, reassignment/deactivation, last-admin changes, and account debits preserve invariants |
| N04 | Recovery | Inject failures before/after Mongo write and event confirmation; same operation converges to one confirmed note/event or an actionable quarantined outcome |
| N05 | Performance | On documented demo hardware with 100,000 synthetic transactions, target p95 bounded explorer/queue read under 1 second and detail under 1.5 seconds after warmup |
| N06 | Bounded work | Page maximum 100; request payload limits; search timeout; dependency checks time out; no unbounded browser data load |
| N07 | Accessibility | Keyboard-only investigation completes; visible focus; semantic table/forms/dialogs; rendered contrast; 200% zoom; status announcements |
| N08 | Responsiveness | At 360px, 768px, and 1280px widths, navigation/actions remain reachable; core columns accessible without page-wide clipping |
| N09 | Auditability | Every successful case/admin mutation has correct server actor and safe audit; failed operations cannot masquerade as success |
| N10 | Reproducibility | Fresh documented setup applies migrations/validators, seeds deterministic synthetic scenarios, and runs demonstrations without hard-coded secrets |
| N11 | Cross-store privacy | Redaction failure leaves request pending; copied content excluded during processing; completion proves approved store coverage |
| N12 | Observability | Correlation IDs link sanitized API errors and operations; dependency failures differentiated from empty data |

## First vertical slice and acceptance tests

The slice must deliver a working SQL-backed investigation journey with a repeatable demonstration and test evidence. This section defines tests to implement; no executable tests have been written or run in this design phase.

| Scope | Required slice behavior | Deliberate boundary |
|---|---|---|
| Foundations | INR decimal/rate contract, corrected method/case cardinalities, protected SQL connections, risk aggregation view, case guards, typed immutable events, persisted idempotent command receipts | No vector extension, embeddings, semantic source table, general admin audit, or cross-store outbox dependency |
| Authentication | Provisioned analyst A, analyst B, admin; inactive analyst and system fixtures; credential sign-in/sign-out, expiry and current active-role checks | No public registration, operator editing, reset/invite delivery, or admin session bypass |
| Transaction/risk reads | Bounded explorer with exact ID/date/status/risk filters; transaction detail, masked related facts, recorded signals and score/band | Signals/rules are deterministic seed inputs, not an implemented continuous risk engine; current rule config remains labeled current |
| Investigation | Analyst creates self-owned case with priority/reason, reviews, resolves/dismisses or escalates; admin returns escalation, resolves it, or reopens; owned/admin queue and history | No peer case details, self-claim, dispatch/reassignment UI, due-time editing, post-create priority editing, or Mongo note saving |
| UI | S01, S02 owned work, S03/S04, S05/S06, S09 case oversight, S13 | Unimplemented features have no actionable links/forms; narrative outcome inputs exist, but free-form evidence notes come later |
| Evidence | Backend integration tests, direct DB negative tests, concurrency tests, browser demonstration, documented setup/fixtures | Slice acceptance does not claim full academic compliance or second-paradigm delivery |

**Mock fixture contract:** deterministic UUIDs and synthetic labels identify each record. Seed at least three card-payment transactions, including two on one account/payment method. Include INR and USD transactions, zero-signal activity, and a transaction with stored contributions of 40 and 25 (score 65, high). For currency verification, a mock USD 10.00 transaction at a synthetic rate of 80.00000000 INR/USD yields INR 800.00; this is not a market rate. Fixtures also cover tied timestamps, a second analyst's case, an inactive-assignee terminal case, and historical terminal/nonterminal cases on one subject for reopen conflicts.

Seed reasons and evidence contain no real PII. Ground-truth `TRANSACTION_LABEL` is excluded from operator responses. Seeds are test/demo setup, not runtime transaction CRUD or automatic case creation. Version each fixture description with the acceptance evidence so both implementers can reproduce it.

| Test ID | Preconditions and action | Required observable result | Verification layer |
|---|---|---|---|
| VS01 | Sign in as active analyst A and admin, then follow a protected deep link | Correct role landing/allowed route; masked API data; password hash and tokens absent from responses | API integration and browser journey |
| VS02 | Try invalid password, inactive human, and system credentials; expire/sign out a valid session and replay its cookie | Generic sign-in failure for all invalid credentials; no new session; expired/revoked session gets 401 and writes nothing; caches clear | Auth integration with controllable clock/session fixture |
| VS03 | Change active role/is_active in isolated test setup during an existing session | Next protected request applies current authority; disabling denies reads/writes, demoting denies admin action | API integration; no admin mutation UI enabled |
| VS04 | Query no-signal and score-65 transactions; apply date/status/risk filters and page across tied timestamps | Correct authorized rows; zero score/count and “No recorded signals”; 40+25=65/high; stable ID tie-break; no “safe” claim | SQL result comparison, API, browser |
| VS05 | Read INR/USD fixture amounts/rates; attempt invalid amount/rate, method-account mismatch, and missing case subject through DB tests | Original USD 10.00 and base INR 800.00 preserved; INR rate exactly 1; invalid writes rejected; two transactions may share one method | Database integration and decimal-string API assertions |
| VS06 | Analyst A creates case with priority and creation reason | 201; case is owned by A and open; exactly `created` then `assigned` under one operation ID; reason only in `reason`, state JSON contains case fields | API + case/event/receipt queries |
| VS07 | Repeat same case command/key, then reuse key with a changed payload; concurrently create for one subject with two keys | Same-key retry returns prior permitted result without new events; changed payload conflicts; race leaves one active case with only committed events | API concurrency + DB counts |
| VS08 | Analyst B requests A's case/events and attempts its mutations; analyst A calls an admin-only action | Private detail/history yields 404; known forbidden action 403; no data/event/receipt mutation on denial; server ignores/rejects forged actor/owner | API authorization matrix |
| VS09 | Attempt open-to-terminal, escalation without reason, blank/oversize creation/reopen reason, unknown resolution code, or mismatched code/state | 422/400 as applicable; case/events unchanged; protected DB function/checks reject equivalent invalid writes | API validation + guarded-function/direct-DB tests |
| VS10 | Owning analyst starts review and escalates; analyst attempts escalated resolution; admin returns case to review with reason | Correct status-only diffs; escalation/return rationale in dedicated reason; analyst resolution denied; no generic metadata in snapshots | API journey + event-shape assertions |
| VS11 | For each resolution code, resolve from in_review as owner and from escalated as admin | Exact terminal mapping from workflows, code/notes/time populated; event reason equals validated notes; current state and event agree | Parameterized API/DB tests for all three codes |
| VS12 | Admin reopens an active-owner terminal case; owner starts review/resolves, admin reopens again; separately reopen inactive-owner fixture | Same identity/opened_at/priority; outcome/time/due cleared; active owner retained or inactive reset via assigned event; each prior terminal reason/code/time remains immutable | API + history chronology assertions |
| VS13 | Analyst attempts reopening; admin attempts reopen when another active case exists on subject | Analyst 403; competing case 409; prior terminal fields/history unchanged | API and partial unique-index tests |
| VS14 | Two tabs mutate same case using one `expected_version`; inject failure after update but before event/receipt completion | One concurrent command wins, the other conflicts; failure rolls back case/events/receipt together; draft retained | Concurrent integration + transaction fault injection + browser |
| VS15 | As app DB role, attempt direct event INSERT/UPDATE/DELETE and financial transaction mutation; as privileged isolated test role, exercise immutable-event trigger | App statements denied; trigger rejects event update/delete even with granted table privileges; safe function still emits allowed events | Database privilege/trigger tests |
| VS16 | Admin directly requests proposed operator edit, rule edit, redaction/cleanup mutation routes while capability gates are closed | 404 for unregistered route, 405 for unsupported method, or 403 for registered gated operation; no writes/pretend audit success; UI offers no action | API gate matrix and browser navigation check |

Exit gate: all VS tests pass against a freshly initialized isolated database; both human roles complete the browser journey; event-shape/immutability and concurrent rollback results are retained. Record actual test commands, environment, and results during implementation. Member A owns transaction/currency/risk assertions; member B owns auth/case/event tests; both review denial/concurrency coverage.

Embedding selection, Mongo notes/recovery, and general administrative mutations cannot delay or silently enlarge this slice. They enter the later implementation stages only when their [capability gates](architecture-gaps.md#capability-gates) pass.

## Full-scope acceptance scenarios

1. Sign in as analyst A; request analyst B's case and search for a distinctive phrase in B's note. Neither detail nor snippet/count leaks; shared transaction facts remain masked and available.
2. Filter transaction explorer by posted status, chosen currency amount range, account, and time. Compare each row against SQL; no-signal rows remain when risk filter permits them. Page through tied timestamps without duplicate stable rows.
3. Inspect a seeded transaction with multiple signals. Sum stored contributions; verify the documented bands (`critical >=80`, `high >=60`, `medium >=35`, otherwise low). Current configuration is never mislabeled as firing-time evidence.
4. Two authorized users create a case for one transaction concurrently. One active case exists; events belong to the committed case. The losing request receives a permitted existing-case response without exposing private details.
5. Two tabs submit changes with the same `expected_version`. One succeeds; the second returns conflict and keeps its draft. Direct invalid `open` to `closed` fails with no event.
6. Owning analyst moves `open` to `in_review`, adds a confirmed note, escalates with reason. Analyst resolution of `escalated` fails; admin resolves with code/notes. History records each actor and outcome.
7. Admin reopens a terminal case while another active case exists for the same transaction. The request fails; terminal data/history remain unchanged. Without a competing case, reopening clears current outcome/time/due fields and preserves the prior terminal event's structured outcome and dedicated rationale.
8. Mongo write succeeds and SQL confirmation fails. Retry the same note intent; exactly one note/event becomes confirmed. Unauthorized ownership changes cause quarantine rather than a new privileged write.
9. Admin disables an assigned analyst or demotes the last active admin concurrently with related operations. Backend preserves assignment/last-admin invariants and revokes current privileges immediately on the next request.
10. Redaction fails after SQL fields are nulled but before copied content cleanup. Request remains pending; affected snippets are suppressed; retry completes approved stores without deleting financial facts.
11. Admin previews retention-eligible synthetic telemetry, confirms exact scope, and deletes it through a durable audited operation. Retained evidence and transaction rows remain; duplicate confirmation does not create duplicate completion audit.
12. Full-text and vector searches are demonstrated with known synthetic source text. Missing Mongo source and incompatible embedding model are excluded/reported. Vector relevance is never presented as a financial risk score.

## Academic coverage

References below point to the inspected local [DBMS brief](<DBMS Level 3 Project Requirements.pdf>). Compliance remains unverified until implementation and demonstration evidence exist.

| Brief item / page | Planned evidence | Current gap |
|---|---|---|
| 1, title/problem; p1 | Synthetic suspicious-transaction intelligence with evidence-based investigation | Title exists; section uniqueness needs instructor confirmation |
| 2, two members; p1 | Both implement database and application work, cross-review, identifiable commits | Responsibility proposal in architecture gaps; team confirmation pending |
| 3, SQL + second paradigm; p1 | PostgreSQL relational integrity plus heterogeneous Mongo telemetry/notes; pgvector retrieval | No databases implemented; justified workloads and contracts documented |
| 4, relational and nonrelational models; p1-2 | Corrected ER/relational DDL and data dictionary; Mongo validator/index docs; embedding metadata/retrieval | Cardinality/source gaps; no executable schema or complete Mongo model |
| 5, DDL; p2 | CREATE tables/indexes/views; ALTER migration; reversible DROP of disposable staging/demo object | No migrations; DROP never used for retained financial data |
| 6, DML/queries; p2 | Case/note/signal INSERT, case/user/PII UPDATE, expired-session SQL DELETE, evidence SELECT; JOIN/GROUP BY/HAVING/ORDER BY/aggregates/subqueries | Delivered in migration `060_session_cleanup.sql` and verified across DB/API/E2E suites ([Session cleanup](session-cleanup-contract.md)); Issue #23 |
| 7, advanced features; p2-3 | SQL transactions, views, triggers, indexing, full-text search, guarded functions; Mongo aggregation and/or vector similarity | At least four SQL plus one NoSQL/vector must run and be demonstrated |
| 8, vector optional; p3 | At semantic retrieval, select/document model and dimension, source text, cosine retrieval, and authorized provenance | Model/source-aware dedup delivered at that milestone; foundational SQL and slice do not depend on them |
| 9, Next.js; p3 | Task screens with filters, tables, forms, readable explanations | No application scaffold |
| 10, integration/config; p3 | Shared backend services/Route Handlers; environment-managed credentials | No backend/configuration exists |
| 11, auth/two roles; p3 | Active human analyst/admin sign-in; backend role/resource enforcement | No authentication/authorization exists |
| 12, database validation; p4 | Direct DB constraint tests, state functions/guards, concurrency tests | Checks documented only; enforcement unimplemented |
| 13, soft-copy documentation; p4 | Objectives/scope/FRs here and workflows; ER; future schema/data dictionary, implementation/queries, architecture, screenshots, tests, conclusion | Five design documents do not replace implementation report and evidence |
| 14, Git/GitHub; p4 | Setup/execution README and individual contribution commits | Git repository exists; runnable setup/contribution evidence pending |
| 15, demo; p4-5 | Seeded investigation, DB rejection, concurrency, retrieval, recovery, UI, individual work | Tests/screenshots/live demonstration absent |
| 16, originality; p5 | Team-authored problem, schema rationale, code and demonstration | Requires implementation/contribution review; cannot certify from design alone |
| 17, beyond CRUD; p5 | Explainable risk, joins/aggregates, governed case state, concurrency, cross-store recovery and authorized retrieval | Proposed workflows exceed CRUD; runtime evidence missing |

The first slice demonstrates sign-in, seeded signal explanation, self-owned investigation, escalation, resolution/reopening, denial, concurrency, and event immutability. The full academic demonstration subsequently adds confirmed Mongo notes, document aggregation and/or authorized vector retrieval, cross-store retry, and nonfinancial deletion. Each team member presents their own database and application contribution.
