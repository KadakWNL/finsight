# FinSight

A financial transaction intelligence platform: multi-database design over synthetic financial
data, detecting suspicious transaction behaviour and supporting analyst investigation.

DBMS Level 3 Project · 2 people · 2 months.

## Status

Database design is under review; the application is not scaffolded yet.

| Area | State |
|---|---|
| Relational schema + ER diagram | Reconciled design awaiting peer review; no applied schema. See [`docs/er-diagram.md`](./docs/er-diagram.md) |
| DDL migrations | Not started |
| Seed data generator | Not started |
| Next.js application | Not started |
| Setup instructions | Added once the app is scaffolded |

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

Not available yet — no application code exists. This section will be filled in once the
database migrations and Next.js app are in place.

## Documentation

PDF item #13 requires: problem statement, objectives, scope, functional requirements, ER
diagram, relational schema, database choice justification, data dictionary, implementation
details, important queries, system architecture, screenshots, testing results, and conclusion.
Database design and application planning documents exist; application implementation is pending.

Planning documents for review before implementation:

- [Product workflows](docs/product-workflows.md): scope, roles, permissions, and investigation journeys.
- [Information architecture](docs/information-architecture.md): navigation, page inventory, and screen relationships.
- [UI/UX specification](docs/ui-ux-specification.md): design system, wireframes, interactions, and states.
- [Requirements traceability](docs/requirements-traceability.md): backend/data contracts, acceptance criteria, and academic coverage.
- [Architecture gaps](docs/architecture-gaps.md): inspected evidence, missing capabilities, decisions, and implementation order.
- [Minimum risk contract](docs/risk-formula-contract.md): proposed deterministic formulas, synthetic scenarios, and formula approval gate.
- [Authentication and case commands](docs/case-auth-contracts.md): session persistence, authorization, version checks, and command/event integrity.
- [Development and testing contract](docs/development-and-testing-contract.md): migration ownership, isolated roles, test allocation, and academic scope gates.
- [Session cleanup contract](docs/session-cleanup-contract.md): approved SQL DELETE scope, bounded admin cleanup, audit, and acceptance tests.
