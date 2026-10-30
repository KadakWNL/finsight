# FinSight — Ordered Timed Demonstration Script

**Target Duration:** 14–16 minutes  
**Presenter:** FinSight Project Team (Shrikar Desai & Shreyas P Kulkarni)  
**Audience:** Academic Evaluators and Peer Reviewers  
**Environment Prerequisites:** Application running locally on `http://localhost:3014` with seeded demo data per [Development Setup](../development-setup.md#2-workflow-a--application-demonstration-setup).

---

## Demonstration Overview Schedule

| Stage | Focus Area | Duration | Page / Artifact / Command |
| :---: | :--- | :---: | :--- |
| **1** | Project Overview, Problem & Architecture | 1.5 min | Architecture diagram & A4 print masters |
| **2** | Application Startup & Clean State Verification | 1.0 min | `GET /api/health` & `/sign-in` |
| **3** | Analyst Authentication & Transaction Discovery | 1.0 min | `/sign-in` $\to$ `/overview` $\to$ `/transactions` |
| **4** | Explainable Risk Scoring & Contributing Signals | 1.5 min | `/transactions/30000000-0000-0000-0000-000000000101` |
| **5** | Scoped MongoDB Telemetry & Cross-DB Integration | 1.0 min | Telemetry Panel on Transaction Detail |
| **6** | Case Creation & Single-Active-Case Constraint | 1.0 min | Transaction Detail $\to$ Create Case Modal |
| **7** | Guarded Lifecycle Transitions & Concurrency | 1.5 min | `/cases/[id]` $\to$ Lifecycle action modals |
| **8** | Immutable Case Audit History & Trigger Protection | 1.0 min | Case Detail Timeline & Trigger Definition |
| **9** | Role-Based Access Control & Genuine Denial | 1.0 min | Analyst navigating to `/admin` $\to$ `/access-denied` |
| **10** | Admin Authentication & Audited Session Cleanup | 1.5 min | Sign in as Admin $\to$ `/admin` Session Cleanup |
| **11** | Advanced SQL Concepts & Query Plan Evidence | 1.5 min | `docs/academic/2026-10-30-query-plans.json` & SQL results |
| **12** | MongoDB Schema Validation & Bounded Aggregation | 1.0 min | `scripts/telemetry-schema.mjs` & mongo test evidence |
| **13** | Team Implementation Contributions & Provenance | 1.0 min | `docs/academic/contributions.json` |
| **14** | Verification Results, Known Limitations & Q&A | 1.0 min | `docs/academic/submission-report.md` |

---

## Stage-by-Stage Script

### Stage 1: Project Overview, Problem & Architecture (1.5 min)
- **Artifacts to Open:**
  - Architecture diagram in `docs/academic/submission-report.md#4-system-architecture-and-technology-stack`
  - Print masters: `output/pdf/FinSight-ER-A4-Revised.pdf` and `output/pdf/FinSight-Schema-A4-Revised.pdf`
- **Actions:**
  1. Show the single A4 Chen ER and Relational Schema print masters.
  2. Point out team names (**Shrikar Desai** and **Shreyas P Kulkarni**) on the title headers.
  3. Explain the problem: financial investigation requires deterministic explainability, immutable audit trails, and segregation of relational accounting from high-velocity device telemetry.
- **Presenter Explains:**
  - PostgreSQL 17 handles the core ACID relational schema: 17 application tables, 20 foreign keys, financial facts, deterministic risk rules, user sessions, and cases.
  - MongoDB 7 handles heterogeneous device telemetry with strict schema validation.
  - The single-page A4 print masters strictly preserve all 161 attributes without shared cross-page bus lines.
- **Reference:** `migrations/010_financial_baseline.sql` through `060_session_cleanup.sql`.

---

### Stage 2: Application Startup & Clean State Verification (1.0 min)
- **Page to Open:** `http://localhost:3014/api/health` and `http://localhost:3014/`
- **Actions:**
  1. Navigate to `/api/health` in browser.
  2. Show JSON response: `{"status":"ok","timestamp":"..."}`.
  3. Navigate to `http://localhost:3014/` to show the public landing page.
- **Presenter Explains:**
  - The public landing page and health endpoint run statelessly without requiring database authentication.
  - Security principle: Public endpoints never leak internal connection strings, database engine versions, or query details.
- **Reference:** `src/app/api/health/route.ts`.

---

### Stage 3: Analyst Authentication & Transaction Discovery (1.0 min)
- **Page to Open:** `http://localhost:3014/sign-in`
- **Actions:**
  1. Enter Analyst demo email: `analyst_a@finsight.local`.
  2. Enter locally configured analyst password.
  3. Click **Sign in**. The app navigates to `/overview` then click **Transactions** in sidebar.
  4. Demonstrate filters: Filter by Risk Band **High**, Entity type **Card**, and Direction **Debit**.
  5. Show pagination with stable cursor navigation at the bottom of the table.
- **Presenter Explains:**
  - Authentication uses salted Argon2id password hashing and server-persisted PostgreSQL sessions (`public.app_session`).
  - Pagination uses tamper-resistant, signed base64 cursors based on `(occurred_at, transaction_id)` tuples instead of fragile offset queries.
  - All customer account numbers are masked (`**** 4321`) in compliance with data privacy standards.
- **Reference:** `src/server/auth.ts`, `src/app/api/v1/transactions/route.ts`.

---

### Stage 4: Explainable Risk Scoring & Contributing Signals (1.5 min)
- **Page to Open:** Click on transaction `30000000-0000-0000-0000-000000000101` in the table (or navigate directly to `/transactions/30000000-0000-0000-0000-000000000101`).
- **Actions:**
  1. Point out the top summary card: Risk Total **65 points · 2 signals** (High risk badge).
  2. Point out dual-currency presentation: **USD 125.00** original amount and exact converted **INR base amount** using the recorded ECB historical exchange rate.
  3. Expand the **Risk evidence** section:
     - Show Signal 1: `RULE_HIGH_AMOUNT` (+25 points) — Observed: `USD 125.00` vs threshold `USD 100.00`.
     - Show Signal 2: `RULE_CROSS_BORDER` (+20 points) — Account home `IN` vs Merchant country `US`.
  4. Show the transparent equation: `Recorded signal contributions total 65 points · high risk`.
- **Presenter Explains:**
  - This is an explainable risk engine, not an uninterpretable machine learning score.
  - The score is computed deterministically in PostgreSQL via view `v_transaction_risk`. Every point is auditable against rule versions and parameters.
- **Reference:** `migrations/040_deterministic_risk.sql`, `src/components/workspace/transaction-detail.tsx`.

---

### Stage 5: Scoped MongoDB Telemetry & Cross-DB Integration (1.0 min)
- **Page to Open:** Scroll down to the **Device telemetry** card on the same Transaction Detail page.
- **Actions:**
  1. Highlight the **Device telemetry** panel.
  2. Show aggregated facts:
     - **Observations:** Total observations in the 100-sample time window.
     - **Window:** Time span of captured signals.
     - **Connection types:** e.g. `wifi`, `cellular`.
     - **Average latency:** Latency in milliseconds.
     - **VPN status:** Number of VPN-flagged sessions detected.
     - **OS patch levels:** Browser and operating system versions.
  3. Expand the **Recent observations** dropdown to show sample polymorphic telemetry events.
- **Presenter Explains:**
  - MongoDB stores high-velocity telemetry documents with polymorphic shapes (`connection_telemetry` and `client_environment`).
  - PostgreSQL references MongoDB data via application-level UUID validation; no hard foreign keys exist between engines.
  - If MongoDB is disconnected, PostgreSQL financial data remains fully operational and the UI gracefully degrades to `Telemetry unavailable`.
- **Reference:** `docs/mongo-telemetry.md`, `src/server/telemetry.ts`.

---

### Stage 6: Case Creation & Single-Active-Case Constraint (1.0 min)
- **Page to Open:** Transaction Detail page (for a transaction without an active case, e.g. `30000000-0000-0000-0000-000000000100`).
- **Actions:**
  1. In the **Investigation** card, click **Create case**.
  2. In the modal, select Priority **High**, enter Reason: `"Suspicious velocity pattern detected"`.
  3. Click **Save case**.
  4. Show confirmation notice: `"Case created and assigned to you."`
  5. Show that the **Create case** button disappears and is replaced by link to the new active case.
- **Presenter Explains:**
  - Partial unique index `idx_case_single_active` on `(transaction_id) WHERE status IN ('open', 'in_review', 'escalated')` guarantees at the database level that no transaction can ever have two simultaneous active investigations.
  - Case creation executes atomically in PostgreSQL and initializes version to `1`.
- **Reference:** `migrations/020_operational_schema.sql`, `src/app/actions/create-subject-case.ts`.

---

### Stage 7: Guarded Lifecycle Transitions & Concurrency (1.5 min)
- **Page to Open:** Navigate to `/cases` in the sidebar, then open the newly created case.
- **Actions:**
  1. Point out current state: **Status: OPEN**, **Version: 1**.
  2. Click **Start review**. The dialog confirms transition. Status updates to **IN REVIEW** and version increments to **2**.
  3. Click **Escalate**. Select Severity **Critical**, enter Reason: `"International transfer exceeds AML review threshold"`.
  4. Confirm escalation. Case status transitions to **ESCALATED** and version increments to **3**.
- **Presenter Explains:**
  - All status updates are processed by the stored procedure `execute_case_command`. Direct SQL `UPDATE public.investigation_case SET status = ...` is blocked to application callers.
  - Optimistic concurrency control: The stored procedure checks `IF current_version != p_expected_version THEN RAISE EXCEPTION 'Version conflict';`. If two analysts act on the same case concurrently, the second analyst receives a 409 Conflict.
- **Reference:** `migrations/050_case_guards.sql`, `src/server/case-commands.ts`.

---

### Stage 8: Immutable Case Audit History & Trigger Protection (1.0 min)
- **Page to Open:** Scroll to **Investigation history** on the Case Detail page.
- **Actions:**
  1. Show the chronological event timeline displaying:
     - `case_created` (Version 1, analyst attribution, timestamp).
     - `review_started` (Version 2, analyst attribution, timestamp).
     - `case_escalated` (Version 3, justification, severity level).
  2. Show database trigger protection in `migrations/050_case_guards.sql`:
     ```sql
     CREATE TRIGGER trg_reject_case_event_mutation
     BEFORE UPDATE ON public.case_event
     FOR EACH ROW EXECUTE FUNCTION reject_case_event_mutation();
     ```
- **Presenter Explains:**
  - FinSight uses an event-sourcing audit model.
  - The database trigger `reject_case_event_mutation` raises SQLSTATE `55000` if anyone attempts an `UPDATE` on `case_event`.
  - The application runtime role has no `DELETE` grant on `case_event`, returning SQLSTATE `42501`.
- **Reference:** `tests/db/case-guards.test.ts`, `tests/sql/case_guards.sql`.

---

### Stage 9: Role-Based Access Control & Genuine Denial (1.0 min)
- **Page to Open:** In the address bar, type `http://localhost:3014/admin` while still logged in as Analyst.
- **Actions:**
  1. Press Enter to navigate to `/admin`.
  2. Observe immediate redirection to `http://localhost:3014/access-denied`.
  3. Show the restricted page UI:
     - Heading: **Access is restricted**
     - Text: *"Your current role does not have access to that page."*
     - Button: **Return to your overview**
- **Presenter Explains:**
  - Role-based access control is enforced at both the Next.js page middleware layer (`requirePageUser`) and the backend API layer.
  - Analysts cannot access administrative panels or invoke administrative APIs (returns 403 Forbidden).
- **Reference:** `src/app/(workspace)/access-denied/page.tsx`, `src/server/page-auth.ts`.

---

### Stage 10: Admin Authentication & Audited Session Cleanup (1.5 min)
- **Page to Open:** Sign out and navigate to `http://localhost:3014/sign-in`.
- **Actions:**
  1. Enter Admin email: `admin@finsight.local`.
  2. Enter locally configured admin password and click **Sign in**.
  3. App navigates to `/admin`.
  4. Scroll to the **Session cleanup (Admin maintenance)** card.
  5. Point out the policy description: *"7-Day Session Cleanup Policy: Sessions older than 7 days that are idle or expired are eligible for deletion."*
  6. Click **Preview eligible sessions**.
  7. Show preview results:
     - Cutoff timestamp captured.
     - Number of eligible candidate sessions (bounded to $\le 100$).
     - Candidate session IDs retained in audit snapshot.
  8. Click **Confirm deletion**.
  9. Show confirmation banner indicating exact count of deleted sessions and persisted audit record ID.
- **Presenter Explains:**
  - This fulfills the course requirement for a meaningful, audited application SQL `DELETE` workload (Issue #23).
  - Deletions are bounded, transactional, and audited in `public.app_session_cleanup`.
  - Zero financial records, transactions, accounts, or case events can ever be deleted.
- **Reference:** `migrations/060_session_cleanup.sql`, `src/components/workspace/session-cleanup.tsx`.

---

### Stage 11: Advanced SQL Concepts & Query Plan Evidence (1.5 min)
- **Artifacts to Open:**
  - `docs/academic/2026-10-30-sql-results.json`
  - `docs/academic/2026-10-30-query-plans.json`
- **Actions:**
  1. Show query plan JSON for `transaction_account_activity` and `transaction_description_search`.
  2. Point out actual PostgreSQL planner output:
     - B-tree index scan on `idx_transaction_account_timestamp`.
     - Bitmap Index Scan using GIN index on `to_tsvector('english', description)`.
  3. Show the grouped financial aggregation query from `2026-10-30-sql-results.json`:
     ```sql
     SELECT m.name, count(*), sum(t.amount_base), max(vr.risk_score)
     FROM transaction t
     JOIN merchant m ON m.merchant_id = t.merchant_id
     JOIN v_transaction_risk vr ON vr.transaction_id = t.transaction_id
     GROUP BY m.merchant_id, m.name
     HAVING count(*) >= 2
     ORDER BY max(vr.risk_score) DESC;
     ```
- **Presenter Explains:**
  - The query plans are real `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` executions captured on PostgreSQL 17, demonstrating that indexes are selected and utilized by the query planner.
  - FinSight uses hand-written, parameterized SQL without an ORM to maintain exact query efficiency and security.
- **Reference:** `scripts/academic-sql.mjs`, `docs/academic/2026-10-30-query-plans.json`.

---

### Stage 12: MongoDB Schema Validation & Bounded Aggregation (1.0 min)
- **Artifacts to Open:**
  - `scripts/telemetry-schema.mjs`
  - `docs/academic/2026-10-30-report.json` (lines 715–798)
- **Actions:**
  1. Show `$jsonSchema` validator configuration enforcing conditional properties for `connection_telemetry` and `client_environment`.
  2. Show test output confirming invalid payload insertion is rejected by MongoDB with error code **121**.
  3. Show the multi-facet aggregation pipeline results grouping 12 observations across connection and environment categories.
- **Presenter Explains:**
  - MongoDB serves as a validated second paradigm, demonstrating document schema validation, compound indexes (`device_id, captured_at`), and analytical aggregation pipelines.
- **Reference:** `scripts/telemetry-schema.mjs`, `tests/api/telemetry.test.ts`.

---

### Stage 13: Team Implementation Contributions & Provenance (1.0 min)
- **Artifact to Open:** `docs/academic/contributions.json` and `docs/academic/submission-report.md#16-individual-contributions-of-both-teammates`
- **Actions:**
  1. Display the contributions table.
  2. Highlight **Shrikar Desai's** implementation:
     - Case guards & stored functions (`#31`), Authentication & sessions (`#32`), Case APIs (`#34`), Case UI queue/dialogs (`#37`), MongoDB telemetry (`#40`), Audited session cleanup (`#41`).
  3. Highlight **Shreyas P Kulkarni's** implementation:
     - Financial baseline & integrity (`#27`), Financial guards & retention (`#29`), Deterministic risk SQL & seed (`#30`), Discovery workspace (`#35`), MVP acceptance harness (`#39`), Academic verification (`#42`), Print masters (`#43`).
- **Presenter Explains:**
  - All contributions are backed by immutable Git merge commits, PR reviews, and file existence checks verified during automated testing.
- **Reference:** `docs/academic/contributions.json`.

---

### Stage 14: Verification Results, Known Limitations & Wrap-Up (1.0 min)
- **Artifact to Open:** `docs/academic/submission-report.md#14-verification-methodology-and-actual-measured-results`
- **Actions:**
  1. Show the verification summary:
     - 16/16 Acceptance scenarios passed.
     - 98 Unit tests passed.
     - 88 API tests passed.
     - 24 Database tests passed.
     - 17 Browser tests passed.
     - 5 Query plans verified.
     - 7/7 Migration checksums matched.
  2. State known limitations: Synthetic data only, vector search and dynamic rule authoring deferred.
  3. Address the Issue #18 status discrepancy: Explain that while all automated tests passed and PR #42 code review was completed, the human gates reflect the upcoming live course defense.
  4. Conclude and invite questions.
- **Presenter Explains:**
  - FinSight delivers a complete, reproducible, and verifiable Level 3 DBMS project fulfilling all requirements of the experiential learning curriculum.
- **Reference:** `docs/academic/submission-report.md`.
