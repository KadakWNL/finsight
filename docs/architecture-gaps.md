# Architecture assessment and decisions

FinSight has database design artifacts and no executable application. This document records evidence, implementation gaps, and recommended decisions for review before coding.

## Evidence and inspection boundary

The local checkout points to `https://github.com/KadakWNL/finsight`. Inspection used `rg --files`, `git ls-files`, and `git ls-tree -r --name-only HEAD` at `dd8c1743a8d4bfd27b00dcd0918f65e7294781c6`. Remote branches, deployments, and live databases were not inspected.

| Source inspected | Finding | Authority |
|---|---|---|
| [README](../README.md), Status, Stack, Design, Documentation | Next.js application, migrations, seed generator, and setup are not started. Stack choices are intentions. | Product scope and intended stack |
| [ER documentation](er-diagram.md), all sections | Fields, checks, sample SQL, indexes, triggers, privileges, retrieval, redaction intent | Relational design and database behavior intentions |
| [Mermaid source](er-diagram.mmd), complete file | Authoritative entity/field inventory | Primary structural source |
| [PlantUML source](er-diagram.puml), complete file | Explicitly stale; contains different roles/cardinalities and omits newer fields | Historical draft; unsuitable for implementation |
| All four SVGs, full JPG, three split JPG artifacts | SVG text agrees with the corresponding Mermaid sections; rendered figures are design artifacts | Derived figures; textual sources resolve ambiguity |
| [Academic brief](<DBMS Level 3 Project Requirements.pdf>), all five pages | Read locally using `pdftotext -layout` and confirmed five text-bearing pages with `pypdf` | Course requirements |
| `.gitignore` and complete file inventory | No source, package manifest, SQL files, API definitions, tests, fixtures, MongoDB validators, or dependency/configuration implementation | Observed checkout state |

The academic PDF is an existing untracked local file. Its contents were inspected, but are not copied into these documents. `.gitignore` excludes `project_requirements.pdf`, which does not match this attachment's filename. Decide redistribution permission before any later commit; this design task makes no commit.

No attached archive was available. The supplied instruction references `RTK.md`; searches of the workspace, its ancestors, and local `.codex`/`.agents` directories did not locate it. Its instructions could not be inspected. Additional private attachments or services are outside this assessment.

Status language throughout the design documents:

- **Documented:** exists in the ER/README design, without executable enforcement.
- **Required:** necessary for the scoped workflow or course requirement; unimplemented.
- **Proposed:** a recommended addition or policy, awaiting approval.
- **Unresolved:** evidence does not settle the choice; a recommendation and owner appear below.

No designed workflow is already implemented. The five documents specify a proposed application contract.

## Existing design inventory

| Area | Documented names and purpose | Executable state |
|---|---|---|
| Identity and banking | `APP_USER`, `CUSTOMER`, `ADDRESS`, `ACCOUNT`, `PAYMENT_METHOD`, `PERSONAL_DATA_REDACTION` | Design only |
| Transactions and detection | `TRANSACTION`, `MERCHANT`, `DEVICE_FINGERPRINT`, `RISK_RULE`, `RISK_SIGNAL` | Design only |
| Investigation | `INVESTIGATION_CASE`, `CASE_EVENT` | Design only |
| Retrieval and evaluation | `SEMANTIC_DOCUMENT`, `FRAUD_SCENARIO`, `TRANSACTION_LABEL` | Design only |
| Views | Sample definition of `v_transaction_risk`; names/purposes for `v_customer_spending_summary`, `v_merchant_risk_profile`, `mv_account_velocity`, `mv_daily_spend` | No applied views; other definitions missing |
| Integrity objects | Named indexes, triggers, SQL role examples, conceptual row-locked balance update | Sample definitions and descriptions only |
| MongoDB | Device telemetry, raw request metadata, analyst notes | Collection names, validators, indexes, and write protocol absent |
| Authentication | Auth.js, bcrypt/argon2 in README; `APP_USER.password_hash`, `role`, `is_active` | No sign-in, sessions, authorization, recovery, or service credentials |

Uppercase names identify ER entities. Lowercase names identify intended SQL objects in the ER documentation; actual naming must be fixed in migrations. `APP_USER` is an operator identity. `CUSTOMER` is a person represented in synthetic financial data; the optional `CUSTOMER.user_id` relationship does not justify a customer portal.

## Schema and enforcement gaps

| Gap | Consequence | Recommended decision and implementation gate |
|---|---|---|
| Method/transaction cardinality needs applied enforcement | Corrected source alone cannot enforce the relationship | Reconciled source uses zero-or-one method / many transactions; peer-review figures and implement the composite FK before DDL acceptance. |
| Mandatory case subject needs applied enforcement | A diagram cannot prevent a subject-free case | Reconciled source uses mandatory subject / historical cases; require `transaction_id NOT NULL` in reviewed DDL. |
| Assignee comment says analyst, but FK cannot enforce role or activity | Admin/system/inactive assignee possible | Validate under lock and database function/trigger. Coordinate role/deactivation changes with assignments. |
| Status checks define vocabulary, not transitions | Invalid close/reopen possible | Implement the state machine in [workflows](product-workflows.md#case-state-contract) with a database guard and backend policy. |
| Reconciled `CASE_EVENT` fields lack executable shape enforcement | State JSON can become an unvalidated metadata bucket | The finalized [event contract](product-workflows.md#case-event-contract) adds dedicated `reason`, `metadata`, and `operation_id`, plus `priority_changed`. General admin audit remains a separate gated structure. |
| `RISK_RULE.version` lacks revisions; `RISK_SIGNAL` lacks rule version/snapshot | Edited thresholds rewrite apparent historical explanations | Freeze rules for the first release. Before editing, propose immutable revision storage and signal-to-revision linkage or a complete firing snapshot. No structure is implemented yet. |
| Unique `(transaction_id, rule_id)` prevents repeated scoring by version | New runs conflict or replace evidence | First release scores once. Define run/version semantics before replay; preserve historical signals. |
| `SEMANTIC_DOCUMENT` XOR only counts populated source columns | Mongo source may still be missing | Verify Mongo source existence and authorization; reconcile references. XOR does not prevent cross-database orphans. |
| `doc_type='merchant_profile'` has no merchant source FK | Merchant embeddings lack truthful attribution | Exclude merchant profiles from first-release retrieval; propose a real merchant source and revised exclusivity constraint only if needed. |
| Unique `(doc_type, content_hash)` collapses identical text from different sources | Missing source association and possible authorization leak | Recommend source-aware uniqueness before embeddings. Hash exact canonical text and include model/version in re-embedding policy. |
| Mongo note lacks a defined case relationship | Case authorization and search provenance cannot be enforced | Approve the note contract and authorization join described below before implementing notes. |
| SQL note embeddings have no relational case provenance | Authorized vector prefilter cannot join a note directly to its case | Propose a validated case-source mapping or explicit case provenance in the embedding design. Until then, resolve permitted confirmed Mongo sources before returning bounded vector results; never treat raw global nearest neighbors as authorized results. |
| No evaluation/run status | No signals cannot prove a transaction was evaluated and safe | Display “No recorded signals”; evaluation completeness requires proposed run metadata. |
| `v_transaction_risk` omits transactions without signals | Explorer can lose rows with an inner join | Use a left join, `COALESCE` score/count to zero; distinguish the derived low band from a safety verdict. |
| `updated_at` claims conflict with fields | Generic touch trigger targets absent columns on `ADDRESS`/`RISK_RULE` | Enumerate mutable tables; add approved timestamps or exclude those tables. Never assume the fields exist. |
| `amount_base` lacks generated/check implementation; numeric precision and base currency absent | Wrong totals and rounding | Adopt the INR/decimal contract below with positive rates and generated rounded base amount; no live FX dependency. |
| `method_id` does not enforce its account matches `TRANSACTION.account_id` | Cross-account instrument attachment | Required composite FK `(method_id, account_id)` to `PAYMENT_METHOD(method_id, account_id)` with a matching unique key; null method remains allowed. |
| `ADDRESS.is_primary` has no uniqueness and coordinate bounds absent | Multiple primary homes and invalid distances | Proposed partial unique primary-address index; paired nullable coordinates with bounds. Missing location means unavailable evidence. |
| Transaction types require merchant and device even for ATM/refund/transfer | Seeds may invent counterparties | Confirm whether meaningful synthetic merchants/devices cover all scoped types; otherwise propose justified nullability/type constraints. No transfer counterparty relationship exists. |
| Resolution vocabulary and terminal invariants lack enforcement | Inconsistent outcomes and overdue behavior | Enforce the finalized [resolution/reopen mapping](product-workflows.md#resolution-and-reopening-contract). Due-time policy remains deferred; any recorded `due_at` must be at or after `opened_at`. |
| Deletion/FK actions and transaction immutability not executable | Cascading deletion or UPDATE could remove history | Restrictive FKs, no operator transaction mutations, immutable events/signals, controlled ingestion. Use privilege and guard tests. |
| Redaction scope is text; rejection reason absent | Unsafe dynamic column updates or unexplained rejection | Backend uses an allowlist, never executes `scope` as SQL. Proposed audit payload records reason and request identity without PII. |
| `trg_redact_customer_pii` runs only when the request completes | Conflicts with SQL-first redaction while cross-store work remains pending | Redesign the approved redaction function/trigger protocol before processing. SQL PII changes happen during pending work; the completion guard verifies all steps and must not repeat or initiate the erase. |
| Rule dimensions and thresholds lack units, formulas, and evaluation windows | A rule catalog alone cannot implement a risk engine | Define deterministic formulas, per-dimension units, missing-input behavior, and window/freshness policy. Preserve raw contributions and documented bands; do not imply probabilities or cap scores without a new decision. |
| `updated_at` alone is not guaranteed to advance for every mutation | A reused timestamp could miss a concurrent change | Use the proposed positive integer case `version` and `expected_version` contract in [case commands](case-auth-contracts.md). Increment atomically under the row lock for every accepted existing-case mutation; timestamps remain informational. |

These are prerequisites or explicit scope limits. They do not authorize schema edits during this design review.

## Reporting currency contract

The revised design selects **INR** as the single reporting/base currency for the synthetic academic application. This is a product decision suited to the team's demonstration context, not a fact inferred from current financial records. Original currency remains explicit on every transaction.

| Field or operation | Finalized design rule |
|---|---|
| `TRANSACTION.amount` | `numeric(20,2)`, positive finite decimal, in `currency_code`; the demo supports INR and USD, both with two fractional digits |
| `TRANSACTION.exchange_rate` | `numeric(20,8)`, positive finite INR per one original-currency unit, captured at the transaction time; INR transactions require exactly 1 |
| `TRANSACTION.amount_base` | Stored generated `numeric(20,2)` from `round(amount * exchange_rate, 2)`; overflow fails, never silently truncates |
| `ACCOUNT.balance` | `numeric(20,2)` in the account's own `currency_code`, never an INR total for a USD account; nonnegative and row-lock guarded |
| Cross-currency totals | Sum rounded per-row `amount_base`, label “INR (base)”; do not sum original amounts from mixed currencies |
| Filters and APIs | Original amount range requires INR or USD; base range explicitly means INR; decimal strings cross the API boundary |
| Rate source | Deterministic synthetic rates in seed fixtures; no live-rate provider, lookup table, or fetch is introduced |

Reject unsupported currency codes and excess input precision before coercion into the fixed-scale database field; monetary/rate constraints still protect direct writes. Currency expansion and real rate provenance are later scope decisions. The first slice uses seeded card payments on same-currency accounts, with no conversion of account balances or transfer execution. Historical rate/base amounts are financial facts and cannot be edited by operators.

## ER relationship contract

The table below defines the relationship contract represented by the reconciled [ER source](er-diagram.mmd), split sources and rendered figures. The [relational mapping](er-diagram.md) records current field inventory and approval gates. No DDL is applied; peer review must accept these refinements before foundational implementation. Stale PlantUML remains excluded.

| Relationship | Intended cardinality / target Mermaid notation | Nullability and enforcement |
|---|---|---|
| `PAYMENT_METHOD` to `TRANSACTION` | A method supports zero or many transactions; each transaction uses zero or one method. `PAYMENT_METHOD o\|--o{ TRANSACTION` | Nullable `TRANSACTION.method_id`; composite FK enforces the selected method belongs to `TRANSACTION.account_id` |
| `TRANSACTION` to `INVESTIGATION_CASE` | A transaction has zero or many historical cases; each case has exactly one transaction. `TRANSACTION \|\|--o{ INVESTIGATION_CASE` | `transaction_id NOT NULL`; restrictive FK; documented partial unique index limits nonterminal cases to one per transaction |
| `TRANSACTION` to `SEMANTIC_DOCUMENT` | A transaction has zero or many derived document rows; a document has zero or one transaction source. `TRANSACTION o\|--o{ SEMANTIC_DOCUMENT` | Source XOR and type checks: transaction summaries require a transaction; case-note embeddings require a Mongo source. Exact source-aware uniqueness is a semantic milestone decision |
| `APP_USER` to `INVESTIGATION_CASE` | A user has zero or many assignments; a case has zero or one owner. Existing `APP_USER o\|--o{ INVESTIGATION_CASE` retained | Nullable assignee FK plus active-analyst guard; role changes coordinated with assignment locks |
| `APP_USER` to `CUSTOMER` | Optional one-to-one retained | Nullable unique `CUSTOMER.user_id`; no customer login workflow |
| `ACCOUNT` to transaction/payment method; customer to account/address | Existing one-parent/many-children relationships retained | Mandatory parent FKs with restrictive deletion; no financial cascades |
| Merchant/device to transaction; case to event | Existing mandatory parent relationships retained for scoped card-payment fixtures | Required merchant/device on scoped transactions; every event requires one case and one actor |

The first slice demonstrates two transactions sharing one payment method and historical cases sharing one transaction, while rejecting method-account mismatch and duplicate nonterminal cases. Other transaction types remain documented vocabulary, without invented transfer counterparties. Their business semantics require separate design before they are seeded or exposed as executable operations.

The semantic cardinality correction is resolved at the relationship level. It does not require an embedding model, vector extension, or `SEMANTIC_DOCUMENT` migration in the foundational slice. Vector storage, model/dimensions, source provenance, and dedup constraints are implemented together at semantic retrieval.

## Database responsibilities and cross-store protocol

PostgreSQL owns financial facts, relationships, risk evidence, case state, authorization identities, and event history. Its joins and atomic updates support explainable investigation. pgvector remains inside PostgreSQL so retrieval can apply relational access filters.

MongoDB is retained from the documented stack for heterogeneous telemetry and structured, evolving note content. Plain free text alone would also fit PostgreSQL. The team should demonstrate differing telemetry shapes and document aggregation to justify the operational cost.

The following collection contracts are **proposed**, not repository schemas:

| Proposed collection | Minimum metadata and content | Proposed validator/indexes |
|---|---|---|
| `analyst_notes` | `_id`, `case_id` (SQL UUID string), `author_user_id`, `body`, structured observations/evidence references, `created_at`, `idempotency_key`, content hash | Required types and length limits; unique `(case_id, author_user_id, idempotency_key)`; `(case_id, created_at, _id)` |
| `device_telemetry` | `_id`, `device_id`, optional `transaction_id`, `captured_at`, schema version, heterogeneous telemetry payload, retention eligibility | Required ID/time/version; `(device_id, captured_at)`; index retention eligibility for explicit cleanup |

Notes enter after the first vertical slice and are append-only. Attachments, note editing, file uploads, and attachment retention are outside scope. Evidence uses references to existing transaction/signal/entity IDs plus narrative. Validate referenced records and reject executable HTML.

Recommended note write protocol: authorize and lock the case in PostgreSQL; create a proposed durable operation intent; commit the intent, then idempotently write MongoDB. Finalization locks and reauthorizes the case before emitting one protected `note_added` event. Its `metadata` contains the Mongo ID/hash and its dedicated `operation_id` links the operation; state fields stay null. The operation's actor is server-derived. A retry worker handles failures, including closure/reassignment during the write, without granting new rights. The durable operation/outbox design is missing schema work, not an existing object.

If Mongo succeeds but event finalization fails, show “Note awaiting confirmation”, retry the same operation, and exclude it from confirmed history/search. If Mongo fails, show pending/failed save and retain the draft. If final authorization fails, quarantine the unconfirmed note for reconciliation. Embeddings are derived only from confirmed notes and never determine whether the note is saved. A direct dual write without recovery is insufficient.

The indexer validates content hash/model/dimensions and records source provenance. Retrieval checks case visibility before snippets, totals, or ranking are returned. Admin oversight permits note reads, while analyst searches return assigned-case notes. A retry/backfill scanner checks missing sources, stale embeddings, and unconfirmed operations. Device telemetry failure degrades its panel without suppressing PostgreSQL case history.

Redaction must cover approved PII in `CUSTOMER`/`ADDRESS`, Mongo notes/telemetry, and `SEMANTIC_DOCUMENT.content`/embeddings where copied. SQL completion alone cannot promise erasure across stores. Proposed durable steps track progress; completion requires confirmed downstream removal/rebuild. Failed steps remain pending and are retried. Restrict affected content from search during processing. Financial rows and case events remain intact, with audit payloads excluding PII. This is a synthetic project policy, not a legal compliance claim.

Recommend including `CUSTOMER.date_of_birth` and precise address coordinates in the approved PII scope. The ER's examples do not settle their treatment. Event state diffs exclude narrative fields; event `reason` stores operational rationale, including terminal resolution rationale, under a no-direct-PII authoring policy. Redaction must address accidental PII in those immutable reasons before its capability gate opens. Ground-truth labels/scenarios are service/evaluation inputs, excluded from investigator responses so demonstration answers do not leak into reviews.

## Capability gates

These are server-enforced enablement prerequisites, not optional warnings. An unavailable capability has no callable mutation handler; direct requests fail without writes. Read-only rule/user/governance screens can be delivered independently where useful.

| Capability | Earliest delivery scope | Required gate before enabling mutations |
|---|---|---|
| Analyst-owned case creation/review; admin escalation handling/reopening | First vertical slice | Guarded SQL function, finalized reason/state/event shapes, resolution mapping, actor/resource checks, operation receipts, immutable events, rollback/concurrency tests |
| Admin case dispatch/reassignment | Case expansion | Existing `assigned` history, active-analyst validation and role-change locking, current resource checks, conflict/idempotency tests; this is case history, not general admin audit |
| Operator create/edit/activate/deactivate/role change | Governance milestone | Durable general admin audit committed with the mutation, last-admin and assignment guards, session authority invalidation, denial/race tests |
| Risk-rule create/edit/activate/version | Rule-governance milestone | Immutable revisions/firing provenance, parameter semantics/ranges, version conflict protection, prospective scoring policy, durable general audit, historical-explanation tests |
| Redaction request submission/rejection/processing | Cross-store governance milestone | Approved field scope, protected financial FKs, redesigned redaction trigger/function, audit/rejection reason, durable per-store progress/retry, source quarantine, immutable-rationale PII policy, failure-injection tests |
| Mongo notes | Investigation expansion | Defined collection/validator/indexes, durable intent, reauthorization at confirmation, typed `note_added.metadata`, idempotent event path, partial-failure tests |
| Semantic retrieval | Retrieval milestone | Model selected and benchmarked, compatible dimension migration, source-aware uniqueness/provenance, confirmed-source authorization, stale/missing source handling |
| Telemetry cleanup/export/automated escalation | Later explicit scope | Previously documented retention/export/policy constraints, durable audit and failure/retry evidence; no shortcut from admin role |
| Expired-session cleanup | Academic completion after MVP acceptance | [Session cleanup contract](session-cleanup-contract.md), session/auth foundation, migration 060, bounded admin preview, atomic DELETE/audit, idempotency and retention tests |

An admin resolving or reopening a case is within the approved guarded case lifecycle and uses `CASE_EVENT`. Operator account edits, rule configuration, and redaction are separate admin mutations requiring general audit/integrity work. The first slice cannot enable those features just because an admin session exists.

## Proposed decision register

The user approved the role model, analyst-first navigation, guarded lifecycle, financial integrity, and staged implementation in principle. The revised contracts below resolve the requested clarifications for review; they are not evidence of implementation or permission to start coding in this turn.

| Decision | Recommendation | Cost or unresolved detail |
|---|---|---|
| Case visibility | Analyst sees owned case details/notes and minimal unassigned queue summaries; admin oversees all cases | Less peer collaboration; global transaction access still reveals subject facts |
| Transaction/entity access | Both human roles can investigate synthetic organization-wide facts with masked direct identifiers | A real deployment would need organizational scope, PII access policy, and access auditing |
| Assignment | Admin dispatches/reassigns; analyst case creation assigns self atomically | No self-claim of preexisting unassigned cases in first release |
| Escalation authority | Owning analyst escalates; admin resolves escalated cases or returns them to review | Admin remains an overseer, never an analyst assignee |
| Case events | Dedicated reason, metadata, and operation identity; state JSON contains case-field changes only | Exact schema and writer contract in [product workflows](product-workflows.md#case-event-contract); unimplemented |
| Terminal outcomes | Fixed code-to-state mapping in [product workflows](product-workflows.md#resolution-and-reopening-contract) | Database/backend must enforce the same mapping; inconclusive dismissal remains distinct from false positive |
| Reopening | Admin reopens same case, checks competing active case, clears outcome/due fields, preserves original terminal event | Full retain/reset contract in workflows; no new case or erased history |
| Rule changes | Read-only first release; editing gated on revisions, audit, and validation | Admin editing screen is specified as a proposed follow-on |
| Session design | [Case/auth contract](case-auth-contracts.md): Auth.js plus `APP_SESSION`, current authority, 30-minute idle and 8-hour absolute expiry | ER models the reviewed design; session implementation and runtime evidence remain absent |
| Operational monitoring | Defer a standalone health page | Read-only dependency checks can be an admin overview section; no job history is represented today |
| Export | Defer bulk financial/PII export | Needs explicit field scope, limits, access policy, and general audit first |
| Meaningful DELETE | Admin previews and removes retention-eligible synthetic Mongo telemetry | Preserves transactions; requires retention policy and durable audit before cleanup |
| Base currency | INR with deterministic synthetic rates and fixed decimal contract | Explicit product choice; no live FX provider or new rates table |
| ER corrections | Optional-method/many-transactions, mandatory-case-subject, and multi-document relationships above | Source/split/render reconciliation awaits peer review before DDL; no applied schema |
| Embedding model | Select at semantic retrieval; validate against documented 384-dimensional intent | Foundational migrations and first slice contain no vector dependency; revise vector dimension there if the selected model requires it |
| Case creation threshold | Manual investigation is allowed for any transaction; display signals, not a fraud assertion | Automated case creation and due-time rules require a separate approved policy |

## Academic fit and implementation order

The PDF accepts SQL plus NoSQL or SQL plus vector. It requires at least four advanced SQL concepts and one NoSQL/vector concept, Next.js, backend authentication, two roles, database validation, and work beyond CRUD. These requirements are not satisfied by diagrams alone.

Use the coverage and acceptance evidence in [requirements traceability](requirements-traceability.md#academic-coverage). The inspected brief places its documentation checklist in item 13. Item 14 covers Git/GitHub. The README indexes these planning documents; the original ER history remains intact.

1. Complete design review of the event/outcome/currency/cardinality contracts. Reconcile corresponding ER sources before DDL, then define the first slice's relational schema/data dictionary and deterministic fixtures. Model selection is not a prerequisite.
2. Build SQL integrity, least-privilege connections, guarded case functions, event immutability, and idempotent command receipts. Defer vector tables/indexes and cross-store outbox structures to their workloads.
3. Deliver the [first vertical slice](requirements-traceability.md#first-vertical-slice-and-acceptance-tests): authentication and authority checks, transaction/risk reads, owned-case lifecycle, admin escalation/reopening, and task screens. Its acceptance tests must pass before expanding functionality.
4. Expand case dispatch/priority and Mongo notes/telemetry with validators, durable recovery, and document aggregation. General admin audit and operator mutations are a separately gated governance scope.
5. At retrieval, select the embedding model, validate dimensions, then migrate vector/source metadata and demonstrate authorized similarity search. Add full-text depth and synthetic evaluation where useful. Rule editing, cleanup, and cross-store redaction each wait for their capability gates.
6. Verify accessibility, error recovery, performance, setup documentation, screenshots, and the full academic demonstration. The first slice alone does not meet the second-paradigm/complete-project requirement. Each member contributes identifiable database and application commits/evidence.

Suggested responsibility split: member A owns financial DDL, ingestion/balance locking, risk queries, and transaction/entity screens. Member B owns case/audit DDL, Mongo contracts/recovery, authentication, and case/admin screens. Both review authorization, implement database tests, integrate retrieval, and demonstrate their SQL and application contributions. This is a proposal; the team has not assigned named owners.

## Design review result

The design maps the ten requested screen concepts to evidence or named proposals. Workflows, permission boundaries, state guards, query responsibilities, and acceptance criteria have a single owner in the linked documents. No frontend, migration, dependency, or configuration changes are part of this deliverable.

The requested clarifications are reflected in these revised design contracts. Implementation remains paused for review; capability gates continue to apply after design approval.

Design sign-off record:

- 2026-10-12 User: approved in principle the existing roles, analyst-first architecture, guarded lifecycle, integrity protections, and staged order; requested event/outcome/currency/slice/gating clarifications before coding. Revised clarifications have no subsequent sign-off recorded.
