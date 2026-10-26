# Development setup

The application in `src/app` serves a landing page, `GET /api/health`, [authentication APIs](authentication.md), [transaction read APIs](transaction-api.md) and the [discovery workspace](discovery-ui.md). Health reports process availability only. The [case lifecycle APIs](case-api.md) are implemented; case screens remain pending. Migrations through 055 implement storage, financial guards/risk SQL, case commands and protected session validation. These checks do not establish VS01-VS16 acceptance.

## Start the application

Use Node.js 24, pinned by `.nvmrc`, and npm with the committed lockfile. Run these commands from the repository root:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev -- --port 3014
```

Open `http://localhost:3014`. The landing page requires no database. Set local values in `.env.local` before running database tooling; the committed example contains placeholders. Never prefix database credentials with `NEXT_PUBLIC_` or commit local environment files.

The local visual system is recorded in [DESIGN.md](../DESIGN.md) and records the accepted visual direction. `src/app/globals.css` defines light/dark semantic colors, violet accents, bordered surfaces, visible keyboard focus and square sidebar selection. `src/app/layout.tsx` loads local IBM Plex Sans and initializes the theme from a stored choice or system preference. Shared primitives live in `src/components/ui`; `components.json` defines shadcn-compatible paths and Tailwind configuration. Workspace components live in `src/components/workspace`. Open `/sign-in` after configuring the database and [provisioning identities](authentication.md).

## Environment and database tooling

The [development contract](development-and-testing-contract.md#2-sql-migration-contract) owns role privileges and migration ownership. Use PostgreSQL 17 and separate non-superuser connections. A local database administrator provisions databases and roles; this scaffold never provisions shared roles or grants feature privileges.

| Variable | Default | Usage |
|---|---|---|
| `DATABASE_URL` | None | Server-only nonowner runtime application connection |
| `SERVICE_DATABASE_URL` | None | Reserved server-only synthetic ingestion connection |
| `MIGRATOR_DATABASE_URL` | None | Dedicated DDL connection for `db:migrate` |
| `TEST_DATABASE_URL` | None | Disposable local database owned by a non-superuser test role, name ending in `_test` |
| `ALLOW_TEST_DATABASE` | False unless exactly `true` | Explicit permission to run integration tooling against that isolated database |
| `ALLOW_SYNTHETIC_SEED` | False unless exactly `true` | Explicit permission for synthetic seed work via a local migrator database ending in `_demo` or `_test` |
| `AUTH_SECRET` | None | Random secret of at least 32 characters for encrypted Auth.js cookies; `NEXTAUTH_SECRET` is accepted when absent |
| `NEXTAUTH_URL` | Request origin for custom origin checks | Canonical browser origin for authentication, required behind a reverse proxy |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | None | Local credential input to protected initial-admin provisioning |
| `BOOTSTRAP_ADMIN_NAME` | Primary Administrator | Display name for the initial admin |
| `DEMO_ANALYST_PASSWORD`, `DEMO_ADMIN_PASSWORD` | None | Explicit passwords for isolated demo provisioning |

`npm run db:migrate` reads `.env.local`, discovers `NNN_lowercase_name.sql` in `migrations`, takes an advisory lock and applies each file with its ledger row in one transaction. It rejects duplicate versions, changed/missing applied files and out-of-order additions. Errors omit connection details. The runner never falls back to application credentials. Migrations 010-040 supply financial/operational storage and risk SQL; 050 adds guarded case commands; 055 adds protected session validation. A native local PostgreSQL 17 installation works; Docker Desktop is optional.

For local database checks, an administrator creates a disposable database such as `finsight_test`, owned by a separate login with `NOSUPERUSER NOCREATEDB NOCREATEROLE`. Set `TEST_DATABASE_URL` to that local connection and `ALLOW_TEST_DATABASE=true`. URL options, remote hosts and names without the `_test` suffix are refused. Do not point this role at a shared database. No database reset helper is provided.

The migration harness requires a database without `public.schema_migrations`; it creates and removes only its own probe table and ledger. It verifies transactional DDL rollback, ledger rollback, retry behavior and checksum rejection using actual PostgreSQL. `db:migrate:test` applies repository migrations through the test connection and therefore should use a different disposable database from the runner harness.

## Verification commands

| Command | Usage |
|---|---|
| `npm run lint` | ESLint and TypeScript ESLint checks |
| `npm run typecheck` | Generate Next route types and run TypeScript without emitting |
| `npm run test:unit` | Test database-target guards, password hashing and authorization/security helpers |
| `npm run test:api` | Exercise auth/session and transaction handlers with PostgreSQL fixtures, masks, signed cursors and provisioning CLIs |
| `npm run test:db` | Run the PostgreSQL 17 migration harness using the isolated test role |
| `npm run test:discovery` | List Vitest and Playwright tests without running database/browser checks |
| `npm run test:e2e` | Launch a local Next server on port 3100 against the isolated test database; verify discovery UI, case creation/recovery, mobile/keyboard behavior and authentication/transaction HTTP behavior |
| `npm run build` | Create the production build |
| `npm start` | Serve the production build on port 3000 |
| `npm run db:migrate` | Apply/verify ordered migrations with the dedicated migrator connection |
| `npm run db:migrate:test` | Apply/verify migrations in an explicitly permitted isolated test database |
| `npm run db:seed` | Verify eight deterministic synthetic scenarios and once-only signals in an explicitly permitted local demo/test database; see [risk SQL](deterministic-risk.md) |
| `npm run demo:fx -- --out=data/local/fx.json` | Save daily historical FX reference observations for the [reproducible demo](demo-dataset.md) |
| `npm run demo:import -- --snapshot=data/local/fx.json --manifest=data/local/demo.json` | Add a bounded synthetic dataset using the saved rate snapshot and an isolated demo/test database |
| `npm run auth:provision -- --bootstrap-admin` | Provision the first admin through migrator credentials and local credential input |
| `npm run auth:provision -- --demo` | Provision explicit-password demo identities in an opted-in local isolated database |
| `npm run test:acceptance` | Fail explicitly because feature acceptance is not implemented |

Run `npx playwright install chromium` once before browser checks. Port 3100 must be free; Playwright starts its own server and does not reuse an unrelated process. Desktop/mobile captures and failure traces appear under ignored `test-results`. `.github/workflows/checks.yml` runs these scaffold checks with Node 24 and a disposable PostgreSQL 17 service using a non-superuser test role.
