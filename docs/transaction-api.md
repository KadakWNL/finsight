# Transaction read API

`GET /api/v1/transactions` and `GET /api/v1/transactions/{id}` expose authenticated PostgreSQL-backed transaction facts and recorded risk. Both analyst and admin roles may read the masked financial dataset. Case links remain actor-scoped. The [OpenAPI contract](api/transactions.openapi.yaml) defines the response fields; [authentication setup](authentication.md) owns encrypted-cookie configuration.

## Filters and paging

All query parameters are single-valued. Unknown or repeated parameters return 400. Filter validation occurs after session authentication and before transaction queries. Values are bound SQL parameters; sorting selects only fixed server expressions.

| Parameter | Default | Usage |
|---|---|---|
| `q` | None | Trimmed description full-text query, 1-500 characters; a complete UUID instead selects that exact transaction |
| `transaction_id` | None | Exact transaction UUID |
| `account_id`, `merchant_id`, `device_id` | None | Exact related-entity UUID filters; compose with other filters |
| `from`, `to` | None | Inclusive start and exclusive end, RFC3339 with uppercase T/Z or an explicit offset, at most six fractional digits; normalized to UTC |
| `status` | None | posted, pending, reversed or blocked |
| `risk` | None | low, medium, high or critical, derived from stored contributions |
| `currency` | None | Original currency INR or USD |
| `amount_mode` | original | original compares original amounts; base compares generated INR values across original currencies and excludes the currency parameter |
| `amount_min`, `amount_max` | None | Inclusive nonnegative decimal bounds, at most 18 integer and two fractional digits; original mode requires currency |
| `sort` | occurred_at | occurred_at, amount, risk_score or status; amount uses the selected amount mode and requires currency in original mode |
| `order` | desc | asc or desc; transaction UUID breaks ties in the same direction |
| `page_size` | 25 | Integer 1-100 |
| `cursor` | None | Server-issued signed continuation, bound to current actor/role, normalized filters, order and page size |

Collection responses contain `data`, `page_size`, `next_cursor` and `request_id`. One extra row determines continuation; the response never exceeds the requested size. Occurrence cursors retain microseconds. Reset the cursor when filters, sorting or page size change. A changed actor or role invalidates an old cursor. Invalid/tampered cursors return a field error rather than silently restarting.

Pages represent live data. Newly inserted transactions, newly recorded signals and case changes can alter later reads. Risk sorting does not promise a frozen report snapshot. There is no exact-total query, export endpoint or client-controlled field/SQL projection.

Example requests:

```text
GET /api/v1/transactions?page_size=25&status=posted&risk=high
GET /api/v1/transactions?currency=USD&amount_min=125.00&amount_max=125.00&sort=amount
GET /api/v1/transactions?amount_mode=base&amount_min=10000.00&sort=risk_score
GET /api/v1/transactions?q=30000000-0000-0000-0000-000000000106
GET /api/v1/transactions/30000000-0000-0000-0000-000000000106
```

In the canonical synthetic dataset, the final subject has original USD 125.00, generated INR base 10000.00, score `"65"`, two signals and high band. Monetary values, rates, observations, contributions and scores are decimal strings. Counts and rule versions are integers. Zero-signal transactions remain in results and detail says "No recorded signals"; a low/zero score is not a safe verdict or proof of complete evaluation.

## Projections and privacy

List and detail share one explicit projection in [`financial-queries.ts`](../src/server/financial-queries.ts). Account numbers expose a masked suffix; customer display labels use stable ID suffixes instead of names. Context includes account type/status/currency, customer country/status, current merchant identity/category/country/city/tier, device OS/first-seen country, and optional instrument type/last4. Transaction country/city is labeled separately from current merchant context. Null payment methods remain null without removing transactions.

Customer names, email, phone, birth date and address fields are absent. Payment tokens, full account numbers, device hashes, passwords, evaluation scenarios/labels and private case history/reasons are never selected into responses. Description full text searches transaction descriptions only.

Every row has `active_case`:

| Shape | Audience | Usage |
|---|---|---|
| `{"exists":false,"access":"none"}` | Both roles | No nonterminal case; historical terminal cases do not create an active indicator |
| `{"exists":true,"access":"restricted"}` | Analyst viewing another owner's or unassigned case | Display only "Existing case"; no case ID/reference/status/owner is disclosed |
| exists true, access permitted, case_id/case_ref/status | Owning analyst or admin | Permitted existing-case link |

Detail includes recorded signal evidence/observations/contributions/times and labels joined rule settings as current. It does not invent a firing-time rule revision. Score/count/band, signal rows, context and case indicator are read in one SQL snapshot. Disabled current configuration does not hide an existing signal. This API does not claim that case-command HTTP routes or entity administration are implemented.

## Errors and frontend handoff

All implemented GET responses use `Cache-Control: private, no-store`. A successful detail response contains `data` and `request_id`; a missing valid UUID returns 404. Errors use:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Invalid request parameters.",
    "fields": {"page_size": "Page size must be 1-100."}
  },
  "request_id": "00000000-0000-4000-8000-000000000001"
}
```

400 means malformed filters/ID/cursor; 401 means missing, revoked, expired or ineligible authentication; 403 is the role-denial boundary; 404 means absent transaction; 503 means unavailable authentication/database reads. Error bodies omit SQL, connection details, credentials and supplied cursor contents. An empty `data` array is a successful query, not a dependency failure. Unsupported write methods return the framework's 405 response and change no financial facts.

Frontend requests use the existing same-origin Auth.js cookie. Keep monetary strings intact for rendering. Preserve filter state on errors; reset continuation only when the query changes or a cursor is rejected. Use the scoped case indicator for link availability and the no-signal/coverage wording for explanation. Other dimensions remain unevaluated. Sign-in/navigation/explorer/detail UI remains separate work.

## Verification

[`transactions.test.ts`](../tests/api/transactions.test.ts) runs against real isolated PostgreSQL fixtures, with active/inactive/system actors, owned/private/unassigned/terminal cases and private-field sentinels. It verifies exact risk/currency values, composite filters, all four sort orders in both directions, tied microseconds, 100-row limits, signed cursor scope, safe errors, inactive-rule reads and provisioned nonowner execution. [`transaction-parameters.test.ts`](../tests/unit/transaction-parameters.test.ts) tests strict dates/decimals and cursor binding. The [HTTP test](../tests/e2e/auth.spec.ts) signs in through Auth.js before reading both routes and verifies role changes, private-case concealment, 400/401/404/405 behavior and retained financial row counts.

Run the standard unit/API/database/build/HTTP checks from [development setup](development-setup.md). No schema migration or new runtime read grant is required for these endpoints.
