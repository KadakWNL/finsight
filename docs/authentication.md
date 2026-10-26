# Authentication and session setup

The Auth.js Credentials provider and JSON login endpoint use the same encrypted JWT cookie and PostgreSQL session record. [`authentication.ts`](../src/server/authentication.ts) supplies request authentication; [`auth-config.ts`](../src/server/auth-config.ts) validates current PostgreSQL authority when Auth.js constructs a session. The [approved session contract](case-auth-contracts.md#2-session-design) owns idle and absolute timeout policy. Sign-in pages and feature screens remain separate UI work.

## Configure and provision

Set `AUTH_SECRET` to a locally generated random value of at least 32 characters in ignored `.env.local`. `NEXTAUTH_SECRET` is accepted when `AUTH_SECRET` is absent. There is no built-in secret. Missing/short configuration denies authentication. Set `NEXTAUTH_URL` to the browser origin, such as `http://localhost:3000`, especially behind a reverse proxy. Never commit these secrets or put them in `NEXT_PUBLIC_` variables.

Use `MIGRATOR_DATABASE_URL` for schema/provisioning and a distinct nonowner `DATABASE_URL` for application requests. `TEST_DATABASE_URL` is selected only inside the test runner and requires the local isolated-database opt-in. Enabling test tooling does not redirect the running application to the test owner.

Apply migrations through 055:

```powershell
npm run db:migrate
```

For the runtime role, the migration owner calls both `public.grant_runtime_privileges(role::regrole)` and `public.grant_auth_privileges(role::regrole)`. Migrations automatically provision their grants for existing `finsight_runtime`, `finsight_app` and `finsight_test` roles; custom role names require explicit owner calls. The auth grant permits schema lookup and execution of the protected validation function, without granting operator-table updates.

To bootstrap the first admin, set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` and optional `BOOTSTRAP_ADMIN_NAME` through local environment configuration, then run:

```powershell
npm run auth:provision -- --bootstrap-admin
```

The command requires migrator credentials, serializes concurrent attempts with an advisory lock and refuses to alter an existing email or create another bootstrap admin. Passwords use salted Argon2id. Existing roles, active state and passwords remain unchanged on retries.

For deterministic demo actors, set `DEMO_ANALYST_PASSWORD` and `DEMO_ADMIN_PASSWORD`, then run:

```powershell
npm run auth:provision -- --demo
```

Demo provisioning requires an explicitly permitted local `_demo`/`_test` migrator target, or the explicitly permitted test connection when no migrator URL is set. It provisions analyst A/B, admin, inactive analyst and system fixtures. There are no default passwords. The system identity has no password and cannot sign in. Demo retries preserve pre-existing accounts.

## Request boundary

| Endpoint/helper | Input | Behavior |
|---|---|---|
| Auth.js Credentials callback | Framework CSRF token, credentials and same-origin POST | Credentials verification, persisted session and encrypted JWT cookie |
| `POST /api/auth/login` | Same-origin JSON containing email/password | Same credential/session service and cookie format; generic 401 on credential/throttle rejection |
| `GET /api/auth/session` | Auth.js cookie or encrypted JWT bearer | Current active human identity, session expiry metadata and client-compatible `user`/`expires`; private no-store response |
| `POST /api/auth/logout` | Same-origin POST with encrypted session credential | Revoke the persisted session and expire the same cookie; 503 if revocation is unavailable |
| Auth.js sign-out | Framework CSRF token and same-origin POST | Revoke the persisted session through the sign-out event and clear the cookie |
| `authenticateRequest(request)` | Server-side request | Validate JWT subject/session binding and current PostgreSQL authority before resource policy |

JWT claims contain subject and session identity, not authoritative roles or PII. Raw session UUIDs are not accepted as credentials. Public session JSON exposes neither the cookie token nor the internal session ID. Production cookies use `__Host-next-auth.session-token`, HttpOnly, Secure, SameSite=Lax and Path=/ without Domain. Local HTTP uses `next-auth.session-token`.

`validate_app_session` in [migration 055](../migrations/055_auth_session_validation.sql) locks the session and user rows, checks expiry after acquiring locks, and conditionally refreshes the idle deadline in one SQL statement. Revoked, expired, inactive and invalid-role sessions receive no refresh. The absolute deadline remains fixed. The function uses a fixed catalog search path, qualified tables and restricted execution; runtime callers do not need user-write privileges for row locking.

Both login paths share bounded in-memory throttling: five attempts per canonical account per 15 minutes and 100 total attempts per minute in one server process. Account keys are HMAC digests, without passwords or plaintext email in limiter state. State resets on process restart. Multiple application replicas require a shared limiter store before using the same limits as a deployment-wide guarantee.

Analysts may read owned case details. Queue projection omits cases assigned to another analyst and exposes only reference, subject, priority, status and due time for unassigned rows. Admin oversight remains available. The SQL case-command functions remain authoritative for state and ownership checks.

## Verification

Use an explicitly permitted local PostgreSQL 17 test database. The CI administrator also provisions the nonowner `finsight_auth_probe` role and grants test-owner membership, as shown in [the checks workflow](../.github/workflows/checks.yml). Run:

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run test:api
npm run test:db
npm run build
npm run test:e2e
```

The unit/API suites check generic credential failures, policy projections, origin/secret checks, throttling, JWT subject binding, no credential leakage, current roles, revocation/expiry contention and nonowner validation. Provisioning tests run concurrent bootstrap and retry commands against disposable fixtures. The HTTP test signs in through Auth.js, reads the shared session, changes active state/role, rejects foreign-origin logout, revokes through the JSON endpoint, then verifies JSON login with Auth.js sign-out. It also checks shared throttling across both HTTP paths.

The Playwright server uses the explicitly isolated test URL and a generated test secret; fixtures and cleanup remain in that test database. These tests cover authentication behavior, not the complete investigation UI or VS01-VS16 acceptance.
