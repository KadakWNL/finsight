# Development setup

The application in `src/app` serves a landing page and `GET /api/health`. Health reports process availability only. Authentication, transaction/case APIs and synthetic seeds are not implemented. The [financial baseline](financial-baseline.md), [operational schema](operational-schema.md) and [financial guards](financial-guards.md) define migrations 010-030 and their separate checks. Scaffold tests do not establish VS01-VS16 acceptance.

## Start the application

Use Node.js 24, pinned by `.nvmrc`, and npm with the committed lockfile. Run these commands from the repository root:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The landing page requires no database. Set local values in `.env.local` before running database tooling; the committed example contains placeholders. Never prefix database credentials with `NEXT_PUBLIC_` or commit local environment files.

The visual tokens follow the [UI specification](ui-ux-specification.md#visual-design-system): slate canvas, navy text, system sans typography and visible keyboard focus. Shared primitives live in `src/components/ui`; `components.json` defines shadcn-compatible paths and Tailwind configuration. Role navigation and feature controls belong to their later integration work.

## Environment and database tooling

The [development contract](development-and-testing-contract.md#2-sql-migration-contract) owns role privileges and migration ownership. Use PostgreSQL 17 and separate non-superuser connections. A local database administrator provisions databases and roles; this scaffold never provisions shared roles or grants feature privileges.

| Variable | Default | Usage |
|---|---|---|
| `DATABASE_URL` | None | Reserved server-only runtime application connection |
| `SERVICE_DATABASE_URL` | None | Reserved server-only synthetic ingestion connection |
| `MIGRATOR_DATABASE_URL` | None | Dedicated DDL connection for `db:migrate` |
| `TEST_DATABASE_URL` | None | Disposable local database owned by a non-superuser test role, name ending in `_test` |
| `ALLOW_TEST_DATABASE` | False unless exactly `true` | Explicit permission to run integration tooling against that isolated database |

`npm run db:migrate` reads `.env.local`, discovers `NNN_lowercase_name.sql` in `migrations`, takes an advisory lock and applies each file with its ledger row in one transaction. It rejects duplicate versions, changed/missing applied files and out-of-order additions. Errors omit connection details. The runner never falls back to application credentials. Migration 010 supplies financial storage; 020 adds operational tables; 030 adds financial guards/indexes. A native local PostgreSQL 17 installation works; Docker Desktop is optional.

For local database checks, an administrator creates a disposable database such as `finsight_test`, owned by a separate login with `NOSUPERUSER NOCREATEDB NOCREATEROLE`. Set `TEST_DATABASE_URL` to that local connection and `ALLOW_TEST_DATABASE=true`. URL options, remote hosts and names without the `_test` suffix are refused. Do not point this role at a shared database. No database reset helper is provided.

The migration harness requires a database without `public.schema_migrations`; it creates and removes only its own probe table and ledger. It verifies transactional DDL rollback, ledger rollback, retry behavior and checksum rejection using actual PostgreSQL. `db:migrate:test` applies repository migrations through the test connection and therefore should use a different disposable database from the runner harness.

## Verification commands

| Command | Usage |
|---|---|
| `npm run lint` | ESLint and TypeScript ESLint checks |
| `npm run typecheck` | Generate Next route types and run TypeScript without emitting |
| `npm run test:unit` | Test local database-target safety guards |
| `npm run test:api` | Invoke the health handler directly; feature HTTP/database integration remains pending |
| `npm run test:db` | Run the PostgreSQL 17 migration harness using the isolated test role |
| `npm run test:discovery` | List Vitest and Playwright tests without running database/browser checks |
| `npm run test:e2e` | Launch a real local Next server on port 3100 and check the landing page and health route in Chromium |
| `npm run build` | Create the production build |
| `npm start` | Serve the production build on port 3000 |
| `npm run db:migrate` | Apply/verify ordered migrations with the dedicated migrator connection |
| `npm run db:migrate:test` | Apply/verify migrations in an explicitly permitted isolated test database |
| `npm run db:seed` | Fail explicitly because synthetic seeds are not implemented |
| `npm run test:acceptance` | Fail explicitly because feature acceptance is not implemented |

Run `npx playwright install chromium` once before browser checks. Port 3100 must be free; Playwright starts its own server and does not reuse an unrelated process. Desktop/mobile captures and failure traces appear under ignored `test-results`. `.github/workflows/checks.yml` runs these scaffold checks with Node 24 and a disposable PostgreSQL 17 service using a non-superuser test role.
