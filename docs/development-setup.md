# Development and Environment Setup Guide

FinSight is built with **Next.js 16 (App Router)**, **TypeScript**, **PostgreSQL 17**, and **MongoDB 7**.

The application serves:
- Public landing page and process health check (`GET /api/health`).
- [Authentication and session management](authentication.md) with Argon2id passwords and encrypted cookies.
- [Transaction discovery workspace](discovery-ui.md) with risk scoring, filtering, and stable signed cursor paging.
- [Transaction detail](transaction-api.md) with explainable signal breakdowns, masked context, and [scoped MongoDB device telemetry](mongo-telemetry.md).
- [Guarded case investigation workspace](case-ui.md) with queue management, lifecycle transitions, optimistic concurrency, and immutable audit history.
- [Administrative session maintenance](session-cleanup-contract.md) with audited 7-day expired session deletion.

For hard-copy academic evaluation, use the verified [current ER and relational schema print masters](printable/README.md).

---

## 1. Prerequisites and System Requirements

Before setting up FinSight, ensure your local environment satisfies:

| Component | Required Version | Verification Command | Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v24.x` | `node -v` | Pinned by `.nvmrc` (`24`). Recommended: `v24.22.x` |
| **npm** | `10.x` or higher | `npm -v` | Use with committed lockfile (`npm ci`) |
| **PostgreSQL** | `17.x` | `psql --version` | Native local installation or Docker service on port 5432 |
| **MongoDB** | `7.x` or `8.x` | `mongosh --version` | Local standalone instance on port 27017 |
| **psql CLI** | 17.x | `Get-Command psql` | Must be available on system `PATH` |
| **Playwright** | Chromium | `npx playwright --version` | Installed via `npx playwright install chromium` |

> [!CAUTION]
> **Secret Hygiene:** Never put passwords, connection strings, session secrets, or tokens in documentation, tracked files, or Git commits. Use environment variables and `.env.local` (which is excluded by `.gitignore`).

---

## 2. Workflow A — Application Demonstration Setup

Follow this workflow to set up the complete interactive FinSight application with synthetic financial data and demo credentials.

### Step 1: Clone and Install Dependencies

```powershell
git clone https://github.com/KadakWNL/finsight.git
cd finsight
npm ci
Copy-Item .env.example .env.local
```

### Step 2: Configure Local PostgreSQL Roles and Demo Database

Using PostgreSQL superuser (`postgres`), create the dedicated non-superuser migration owner (`finsight_test`), the restricted nonowner runtime role (`finsight_runtime`), the probe role (`finsight_auth_probe`), and the dedicated demo database (`finsight_demo`):

```sql
-- Connect via psql as superuser:
-- psql -U postgres

CREATE ROLE finsight_auth_probe NOLOGIN;
CREATE ROLE finsight_runtime WITH LOGIN PASSWORD 'local-runtime-password';
CREATE ROLE finsight_test WITH LOGIN CREATEROLE PASSWORD 'local-owner-password';

-- Grant membership so owner can administer runtime grants:
GRANT finsight_runtime TO finsight_test;
GRANT finsight_auth_probe TO finsight_test;

-- Create dedicated demonstration database:
CREATE DATABASE finsight_demo OWNER finsight_test;
```

### Step 3: Configure `.env.local`

Edit `.env.local` with your local values. Do not commit this file:

```ini
# PostgreSQL Connections for Demonstration
MIGRATOR_DATABASE_URL=postgresql://finsight_test:local-owner-password@localhost:5432/finsight_demo
DATABASE_URL=postgresql://finsight_runtime:local-runtime-password@localhost:5432/finsight_demo
ALLOW_SYNTHETIC_SEED=true

# NextAuth / Auth.js Configuration
NEXTAUTH_URL=http://localhost:3014
AUTH_SECRET=<generate-random-secret-at-least-32-chars>

# MongoDB Device Telemetry
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=finsight_demo
```

Generate a secure random secret for `AUTH_SECRET`:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 4: Apply Schema Migrations

Apply all ordered migrations through `060_session_cleanup.sql`:

```powershell
npm run db:migrate
```

The migration runner reads `migrations/`, acquires an advisory lock, executes each unapplied migration in an individual transaction, and updates `public.schema_migrations`. Migrations include:
- `010_financial_baseline.sql`: Core users, accounts, payment methods, merchants, transactions.
- `020_operational_schema.sql`: Audit logs, cases, case events, evidence items, SARs.
- `030_financial_guards.sql`: Check constraints, currency rules, financial retention triggers.
- `040_deterministic_risk.sql`: Rules, rule executions, rule parameters, and view `v_transaction_risk`.
- `050_case_guards.sql`: Guarded stored function `execute_case_command`, versioning, and immutable event trigger.
- `055_auth_session_validation.sql`: Sessions (`app_session`), login rate limiting, and password hashing.
- `060_session_cleanup.sql`: Audited 7-day expired session cleanup functions and audit ledger.

### Step 5: Provision Demo Identities

Provision local demo analyst and administrator accounts with explicit local passwords:

```powershell
$env:DEMO_ANALYST_PASSWORD="YourLocalAnalystPassword123!"
$env:DEMO_ADMIN_PASSWORD="YourLocalAdminPassword123!"
npm run auth:provision -- --demo
```

Provisioned accounts:
- **Analyst:** `analyst_a@finsight.local`
- **Administrator:** `admin@finsight.local`

*(Alternatively, use `npm run auth:provision -- --bootstrap-admin` with `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` to create a custom administrative user).*

### Step 6: Initialize MongoDB Telemetry Collection

Initialize the collection with strict schema validation and compound indexes, then seed demonstration telemetry:

```powershell
npm run mongo:setup
npm run mongo:seed
```

### Step 7: Import Synthetic Demonstration Dataset & FX Reference

Fetch historical European Central Bank daily exchange rates and import the bounded synthetic dataset:

```powershell
npm run demo:fx -- --out=data/local/fx-2026-q1.json
npm run demo:import -- --snapshot=data/local/fx-2026-q1.json --manifest=data/local/demo-2026-q1.manifest.json
```

### Step 8: Start the Application

```powershell
npm run dev -- --port 3014
```

Open your browser to: **[http://localhost:3014/sign-in](http://localhost:3014/sign-in)**.

---

## 3. Workflow B — Academic Verification Setup

The academic verification suite (`npm run test:academic`) executes the complete MVP acceptance suite (VS01–VS16), verifies all SQL demonstrations, validates MongoDB heterogeneous schema validation and aggregation pipelines, and checks merge contribution provenance.

> [!WARNING]
> **Destructive Test Safety Boundary:** `npm run test:academic` requires a **fresh, empty** isolated database whose name strictly ends in `_test`. Once connected, the runner completely resets and controls the test schema. **Never** point `TEST_DATABASE_URL` at `finsight_demo`, a production database, or any database containing valuable records. Each academic test run requires a fresh or newly emptied test database.

### Step 1: Create a Fresh Isolated Test Database

In PostgreSQL, create a fresh empty test database:

```sql
-- As superuser:
DROP DATABASE IF EXISTS finsight_academic_test;
CREATE DATABASE finsight_academic_test OWNER finsight_test;
```

Verify the database is completely empty (zero public objects):
```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
-- Expected: 0
```

### Step 2: Configure Environment for Academic Testing

Set these parameters in `.env.local` or directly in your PowerShell session:

```powershell
$env:TEST_DATABASE_URL = "postgresql://finsight_test:local-owner-password@localhost:5432/finsight_academic_test"
$env:ACCEPTANCE_RUNTIME_DATABASE_URL = "postgresql://finsight_runtime:local-runtime-password@localhost:5432/finsight_academic_test"
$env:ALLOW_TEST_DATABASE = "true"
$env:MONGODB_URI = "mongodb://127.0.0.1:27017"
```

The runner will automatically generate an isolated, run-specific MongoDB database (`finsight_academic_<timestamp>_<random>_test`), verify its isolation, and drop it upon test completion.

### Step 3: Install Playwright Chromium

```powershell
npx playwright install chromium
```

Ensure port `3100` is free, as Playwright launches its own isolated Next.js server instance on port 3100.

### Step 4: Execute Academic Verification

```powershell
npm run test:academic
```

Expected output:
- `fresh-postgres-and-role-isolation passed.`
- `mvp-and-full-regression passed.` (All 16 VS acceptance scenarios, 88 API tests, 24 DB tests, 17 browser tests).
- `ddl-dml-queries-and-protected-delete passed.` (Disposable DDL, relational queries, risk view, guarded case commands, immutable triggers, rolled-back and committed session cleanup).
- `indexes-and-full-text-search passed.` (5 planner-selected indexes).
- `merged-contribution-provenance passed.` (Git ancestry and committed file existence checked across all PR merge commits).
- `mongo-heterogeneous-validator-and-aggregation passed.` (Multi-facet aggregation pipeline and validator rejection code 121).

Results and execution artifacts are written to `test-results/academic/<run_id>/`.

---

## 4. Environment Variables Reference

| Variable | Required In | Default | Description |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Demo / Runtime | *None* | Nonowner application runtime PostgreSQL connection string. |
| `MIGRATOR_DATABASE_URL` | Demo / Migration | *None* | Dedicated DDL owner connection for running `npm run db:migrate`. |
| `TEST_DATABASE_URL` | Testing | *None* | Dedicated test owner connection; database name **must** end in `_test`. |
| `ACCEPTANCE_RUNTIME_DATABASE_URL` | Testing | *None* | Nonowner `finsight_runtime` connection to the test database. |
| `ALLOW_TEST_DATABASE` | Testing | `false` | Must be explicitly `'true'` to permit integration tooling on the test database. |
| `ALLOW_SYNTHETIC_SEED` | Demo | `false` | Must be explicitly `'true'` to permit synthetic dataset seeding in demo database. |
| `AUTH_SECRET` | All | *None* | Secret key of at least 32 characters for Auth.js cookie encryption. |
| `NEXTAUTH_URL` | All | Request origin | Canonical browser origin (e.g. `http://localhost:3014`). |
| `MONGODB_URI` | All | *None* | Local MongoDB connection URI (`mongodb://127.0.0.1:27017`). |
| `MONGODB_DB_NAME` | Demo | `finsight` | Database name for application MongoDB telemetry storage. |
| `DEMO_ANALYST_PASSWORD` | Demo Provisioning| *None* | Plaintext password to hash for `analyst_a@finsight.local`. |
| `DEMO_ADMIN_PASSWORD` | Demo Provisioning| *None* | Plaintext password to hash for `admin@finsight.local`. |
| `BOOTSTRAP_ADMIN_EMAIL` | Custom Provision | *None* | Email address for initial bootstrap administrator. |
| `BOOTSTRAP_ADMIN_PASSWORD`| Custom Provision | *None* | Plaintext password for initial bootstrap administrator. |

---

## 5. Verification Commands Summary

| Command | Category | Purpose / Description |
| :--- | :--- | :--- |
| `npm run lint` | Code Quality | ESLint and TypeScript ESLint verification. |
| `npm run typecheck` | Typing | Next.js type generation and `tsc --noEmit` validation. |
| `npm run test:unit` | Fast Tests | Vitest unit tests for authorization, risk parameters, and guards. |
| `npm run test:api` | Integration | API route tests with PostgreSQL fixtures and masks. |
| `npm run test:db` | Database | Migration runner transactional DDL and rollback tests. |
| `npm run test:e2e` | End-to-End | Playwright browser tests covering workspace, queues, and dialogs. |
| `npm run test:acceptance` | Acceptance | Full MVP acceptance suite across scenarios VS01 through VS16. |
| `npm run test:academic` | Academic Gate | Complete academic evidence suite (acceptance + SQL + NoSQL + git ancestry). |
| `python scripts/diagrams/verify_printables.py` | Diagrams | Verifies single-page A4 dimensions, titles, and 100% attribute coverage. |
| `npm run build` | Build | Compiles Next.js production bundle. |
| `npm start` | Production | Serves production build on port 3000. |
