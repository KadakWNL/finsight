# Historical ER design notes

> Historical draft, retained for provenance. The current [ER mapping](er-diagram.md) and reviewed workflow contracts supersede these notes. They describe design intentions, not an applied schema. Legal/retention assertions below are historical author statements and have not been validated by this reconciliation.

## Change log

### Corrected from the hand-drawn draft

| # | Was | Now | Why |
|---|---|---|---|
| 1 | `USER 1:1 CUSTOMER` | `0..1 — 0..1` | A 1:1 means analysts and admins cannot exist — they have no customer record |
| 2 | `CARD` orphaned, `TRANSACTION 1:1 CARD` | `ACCOUNT 1—N PAYMENT_METHOD 1—N TRANSACTION` | A card belongs to an account; many transactions use one card. Cardinality was backwards |
| 3 | `CUSTOMER 1:1 ADDRESS` | `1—N` | 1:1 makes shared-address collusion undetectable |
| 4 | `payment_methods` absent | `PAYMENT_METHOD` | Listed in Objective #1; missing from the diagram entirely |
| 5 | No analyst assignment | `assigned_to_user_id` | Objective #7 requires assignment to analysts |
| 6 | `RISK_EVENT` with free-text `reason` | `RISK_SIGNAL` fact table, `UNIQUE(transaction_id, rule_id)` | One row per rule that fired; reason derives from the rule, and no rule can double-count |
| 7 | No case history | `CASE_EVENT` | Trigger-written audit trail |
| 8 | `risk_level` on three entities | `risk_tier` on merchant only; transaction risk in a view | Three unrelated "levels" with no stated relationship |
| 9 | Plain `card_number` | `token` + `last4` | Storing a PAN is a security and PCI concern |
| 10 | Mixed notation | Crow's foot throughout, PK/FK/UK/CK labelled | Each constraint visible rather than implied |

### Added after schema review

| # | Addition | Reason |
|---|---|---|
| 11 | `SEMANTIC_DOCUMENT` + pgvector | **Objective #4 and PDF #8 were entirely absent from the schema.** Two nullable source columns with a `CHECK` rather than a polymorphic `(doc_type, source_id)` pair, because a polymorphic column cannot carry a foreign key |
| 12 | `tsvector` + GIN on `transaction.description` | The one item from PDF #7's list of eight not yet covered |
| 13 | Unique partial index on open cases | Prevents duplicate concurrent investigations while keeping re-opening legal |
| 14 | `latitude`/`longitude` on `address` and `merchant` | Distance-from-home and geo-velocity were not computable. The gap was upstream of merchant, not on it |
| 15 | `exchange_rate`, `amount_base` on `transaction` | Without these, summing across accounts in different currencies produces nonsense |
| 16 | `PERSONAL_DATA_REDACTION` | The correct answer to erasure requests in a financial system. See below |
| 17 | Append-only enforcement | `trg_case_event_immutable` trigger **and** `REVOKE UPDATE, DELETE` — either alone is insufficient |
| 18 | `role='system'` on `app_user` | Lets auto-escalation events record an actor without a nullable FK plus a discriminator column |
| 19 | `updated_at` on all mutable tables | Standard, and it makes change control auditable |

### Rejected

**Soft-delete (`deleted_at`) on `transaction`.** Financial transaction records are not deletable.
Anti-money-laundering regimes mandate multi-year retention and explicitly carve out right-to-erasure.
Marking an immutable fact as deleted also breaks the principle the rest of the design relies on.
The correct pattern is `PERSONAL_DATA_REDACTION`: null out `full_name`, `email`, `phone` and address
fields while preserving the financial record. `transaction` itself is never modified.
