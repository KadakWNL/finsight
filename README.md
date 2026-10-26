# FinSight

A financial transaction intelligence platform: multi-database design over synthetic financial
data, detecting suspicious transaction behaviour and supporting analyst investigation.

DBMS Level 3 Project · 2 people · 2 months.

## Status

The application serves a landing page, process-health endpoint and credential/session APIs. Migrations through 055 implement financial/operational storage, risk scoring, guarded case commands and session validation. Investigation feature APIs and screens remain pending.

| Area | State |
|---|---|
| Relational schema + ER diagram | Reconciled design merged. See [`docs/er-diagram.md`](./docs/er-diagram.md) |
| DDL migrations | Financial/operational storage and risk SQL 010-040, protected case commands 050, [session validation 055](docs/authentication.md) |
| Synthetic data and risk SQL | Eight repeatable scenarios, once-only two-rule scorer, risk view and parameterized financial reads; [commands and verification](docs/deterministic-risk.md) |
| Next.js application | Landing page, health and authentication APIs; investigation screens pending |
| Authentication | [Credential/session APIs and provisioning](docs/authentication.md), with unit, database and HTTP checks; sign-in UI pending |
| Setup instructions | [Development setup](docs/development-setup.md) |

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind + shadcn/ui
- **PostgreSQL**: hand-written SQL, no ORM; pgvector deferred until retrieval
- **MongoDB**: synthetic telemetry reads/aggregation after MVP; analyst notes deferred
- **Auth.js** + Argon2id, encrypted-cookie sessions backed by `APP_SESSION`; human roles `analyst` and `admin`

## Design

The schema is documented in [`docs/er-diagram.md`](./docs/er-diagram.md), which includes:

- Three report-ready figures (Identity & Banking, Transactions & Risk, Investigation)
- Indexes, triggers, views and privileges — an ER diagram cannot show these
- Full-text and vector retrieval strategies
- The MongoDB ↔ PostgreSQL boundary
- Deliberate denormalisations and the reason each one is accepted
- A field dictionary, relational mapping, and explicit implementation/review gates

The canonical source is [`docs/er-diagram.mmd`](./docs/er-diagram.mmd). Split sources, SVGs and JPGs
are derived with [`scripts/render_er.py`](./scripts/render_er.py); reproduction commands are in the ER mapping.
[`docs/er-diagram.puml`](./docs/er-diagram.puml) is a stale historical draft excluded from implementation/report use.

## Setup

Use Node.js 24 and `npm ci`, then `npm run dev`. The landing page does not require a database.
See [development setup](docs/development-setup.md) for environment variables, database isolation,
checks and implemented command boundaries.

## Documentation

PDF item #13 requires: problem statement, objectives, scope, functional requirements, ER
diagram, relational schema, database choice justification, data dictionary, implementation
details, important queries, system architecture, screenshots, testing results, and conclusion.
Database design, migrations, deterministic scoring, case guards, authentication and isolated checks exist. Investigation APIs/screens, MongoDB aggregation and final academic evidence remain pending.

Planning documents for review before implementation:

- [Development setup](docs/development-setup.md): runnable scaffold, environment and verification commands.

- [Product workflows](docs/product-workflows.md): scope, roles, permissions, and investigation journeys.
- [Information architecture](docs/information-architecture.md): navigation, page inventory, and screen relationships.
- [UI/UX specification](docs/ui-ux-specification.md): design system, wireframes, interactions, and states.
- [Requirements traceability](docs/requirements-traceability.md): backend/data contracts, acceptance criteria, and academic coverage.
- [Architecture gaps](docs/architecture-gaps.md): inspected evidence, missing capabilities, decisions, and implementation order.
- [Minimum risk contract](docs/risk-formula-contract.md): proposed deterministic formulas, synthetic scenarios, and formula approval gate.
- [Authentication and case commands](docs/case-auth-contracts.md): session persistence, authorization, version checks, and command/event integrity.
- [Development and testing contract](docs/development-and-testing-contract.md): migration ownership, isolated roles, test allocation, and academic scope gates.
- [Session cleanup contract](docs/session-cleanup-contract.md): approved SQL DELETE scope, bounded admin cleanup, audit, and acceptance tests.
- [Financial baseline](docs/financial-baseline.md): implemented migration boundary, nullability and isolated SQL checks.
- [Operational schema](docs/operational-schema.md): operator/case/session/receipt dictionary, event checks and isolated verification.
- [Financial guards](docs/financial-guards.md): retained facts, coordinate constraints, query plans and balance concurrency verification.
- [Deterministic risk SQL](docs/deterministic-risk.md): synthetic seed commands, once-only scoring, bounded SQL reads and exact-result verification.
- [Authentication setup](docs/authentication.md): shared encrypted sessions, runtime grants, identity provisioning and verification.
