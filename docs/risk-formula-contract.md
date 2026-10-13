# Minimum deterministic risk contract

Status: proposed for review by @KadakWNL and @ShrikarDesai07. Neither approval is recorded. [Issue #2](https://github.com/KadakWNL/finsight/issues/2) requires both approvals before scoring implementation starts.

This proposal defines two deterministic rules for synthetic card-payment fixtures using the existing `RISK_RULE` and `RISK_SIGNAL` fields. The formulas and numeric settings below are proposed academic fixture choices. They have no production calibration or fraud-probability interpretation.

The [ER source](er-diagram.mmd) owns the entity inventory. The [currency contract](architecture-gaps.md#reporting-currency-contract) owns monetary precision and INR conversion. The [first-slice acceptance contract](requirements-traceability.md#first-vertical-slice-and-acceptance-tests) owns VS04 and VS05.

## Proposed rule definitions

For an active rule with valid inputs, evaluate its predicate once per transaction. A true predicate emits one signal with `score_contribution = weight`; a false predicate emits no signal. Disabled rules emit no signal. There are no fractional multipliers or time windows: both rules use the transaction and its referenced synthetic merchant.

| rule_code | dimension | observed_value | threshold_value and units | Predicate | Synthetic weight |
|---|---|---|---|---|---|
| `AMOUNT_BASE_GTE` | `amount` | Transaction `amount_base`, INR | `10000.00` INR | `observed_value >= threshold_value` | `40` score points |
| `MERCHANT_TIER_GTE` | `merchant` | Merchant `risk_tier` mapped as low=0, medium=1, high=2 | `2`, ordinal tier code | `observed_value >= threshold_value` | `25` score points |

Use `version = 1` and `is_active = true` for these proposed fixtures. Rule codes identify fixed semantics, including the merchant mapping; the `dimension` alone does not define a formula. Merchant tier codes are ordinal categories, with no distance or probability meaning.

Weights must be finite integer points in `[0,100]`; a zero weight is allowed and a matching rule still records one signal. Amount thresholds must be finite, positive INR decimals with at most two fractional digits within `numeric(20,2)`. Merchant thresholds must be integers in `{0,1,2}`. Reject unknown dimensions/codes, invalid tier values, negative/nonfinite weights and excessive precision before evaluation. These are proposed validation obligations, not existing database constraints.

Freeze rule configuration and merchant tiers for the fixture dataset before emitting signals. The current schema has no immutable rule revision or merchant-tier snapshot. Persist the observed tier and its mapping in signal evidence; changing a merchant must never rewrite existing evidence. Rule editing, rescoring and version replay require a separate approved design.

## Currency and missing-input behavior

The amount rule uses the rounded stored INR base amount. Original amount and currency remain visible. Follow the currency contract: positive finite rates, INR rate exactly `1.00000000`, and `amount_base = round(amount * exchange_rate, 2)`. Reject unsupported currencies, excess input precision and overflow. Synthetic USD rates are fixture data, with no live FX dependency.

A missing amount, invalid rate, missing merchant relationship or unrecognized tier rejects the fixture/evaluation input rather than manufacturing a zero observation. Do not persist partial results for either invalid input: future scoring must validate both rules before atomically inserting their signals. The contract review does not add a scoring-run or evaluation-error table.

Missing telemetry or location does not affect these two predicates. Device, location, time and frequency rules remain outside the selected rule set. The interface must label those dimensions as unevaluated when discussing coverage; their absence cannot support a safe verdict. No-signal records also cannot prove that these two rules ran, because evaluation completeness is not stored.

## Formula and fixture matrix

All rows describe proposed posted card payments with valid same-currency accounts and merchant/device relationships. Weights are the synthetic settings above. Scenario labels are human-readable fixture identifiers; future seed work assigns deterministic UUIDs. At least `control-inr` and `both-high` share one INR account/payment method, covering the existing many-transactions fixture requirement.

| Scenario | Original amount | INR rate | Amount observation / threshold | Merchant observation / threshold | Expected emitted contributions | Sum / band |
|---|---|---|---|---|---|---|
| `control-inr` | INR 500.00 | 1.00000000 | 500.00 / 10000.00 | low=0 / 2 | None | 0 / low |
| `control-usd` | USD 10.00 | 80.00000000 | 800.00 / 10000.00 | medium=1 / 2 | None | 0 / low |
| `amount-below` | INR 9999.99 | 1.00000000 | 9999.99 / 10000.00 | low=0 / 2 | None | 0 / low |
| `amount-equal` | INR 10000.00 | 1.00000000 | 10000.00 / 10000.00 | low=0 / 2 | Amount 40 | 40 / medium |
| `merchant-only` | INR 500.00 | 1.00000000 | 500.00 / 10000.00 | high=2 / 2 | Merchant 25 | 25 / low |
| `both-high` | INR 12000.00 | 1.00000000 | 12000.00 / 10000.00 | high=2 / 2 | Amount 40 + merchant 25 | 65 / high |
| `both-usd` | USD 125.00 | 80.00000000 | 10000.00 / 10000.00 | high=2 / 2 | Amount 40 + merchant 25 | 65 / high |
| `rounded-boundary` | USD 125.00 | 79.99996000 | round(9999.995, 2)=10000.00 / 10000.00 | low=0 / 2 | Amount 40 | 40 / medium |

For `both-high`, persist the following signal values. `rule_id` resolves the unique rule code; `triggered_at` is a server timestamp of signal recording, distinct from transaction occurrence time.

| rule_code | dimension | threshold | observed_value | score_contribution | Evidence text |
|---|---|---|---|---|---|
| `AMOUNT_BASE_GTE` | amount | 10000.00 INR | 12000.00 | 40 | `Synthetic amount rule: INR base 12000.00 >= threshold 10000.00 INR; contribution 40 points.` |
| `MERCHANT_TIER_GTE` | merchant | tier code 2 | 2 | 25 | `Synthetic merchant rule: high tier (low=0, medium=1, high=2), code 2 >= threshold 2; contribution 25 points.` |

Evidence must contain the evaluated observation, threshold, units/mapping and contribution. Generate it from validated synthetic facts; exclude customer names, payment tokens, credentials and raw telemetry. False predicates create no zero-contribution placeholder signals.

| Additional acceptance input | Proposed expected outcome |
|---|---|
| Amount rule disabled; high merchant; INR 12000.00 | Merchant signal only, sum 25 / low |
| Matching rule with weight 0 | One recorded signal with contribution 0; count distinguishes it from no signals |
| Zero/negative/nonfinite rate, INR rate other than 1, unsupported currency, amount overflow | Reject input; insert no signals |
| Missing merchant or invalid tier; missing amount | Reject input; insert no signals |
| Missing telemetry/location with otherwise valid `both-high` inputs | Two signals, sum 65 / high; unsupported dimensions remain unevaluated |
| Duplicate `(transaction_id, rule_id)` write | Unique constraint rejects duplicate; original immutable signal remains |
| Failure after first signal insert | Roll back both inserts; no partially scored fixture |

## Score and API boundary

The backend derives score as the sum of stored raw `score_contribution` values, and returns signal count separately. Preserve transactions without signals through a left join and coalesce sum/count to zero. A score of zero with zero signals displays "No recorded signals". A recorded zero-weight signal has count one and must remain visible.

Keep the [documented bands](requirements-traceability.md#full-scope-acceptance-scenarios): low below 35, medium from 35 to below 60, high from 60 to below 80, critical from 80 upward. Scores are raw points without normalization, percentage formatting or a cap. Two selected fixture rules can reach only 65; critical-band checks use aggregate inputs rather than inventing another rule.

| Derived score boundary | Expected band |
|---|---|
| 0, 34.99 | low |
| 35, 59.99 | medium |
| 60, 65, 79.99 | high |
| 80, 125 | critical |

Return monetary values, rates, observations, contributions and score as decimal strings to avoid binary floating-point loss. Return count as an integer. An illustrative proposed detail fragment for `both-high` is:

```json
{
  "amount": "12000.00",
  "currency_code": "INR",
  "exchange_rate": "1.00000000",
  "amount_base": "12000.00",
  "risk_score": "65",
  "signal_count": 2,
  "risk_band": "high",
  "signals": [
    {"rule_code": "AMOUNT_BASE_GTE", "observed_value": "12000.00", "score_contribution": "40"},
    {"rule_code": "MERCHANT_TIER_GTE", "observed_value": "2", "score_contribution": "25"}
  ]
}
```

This fragment defines proposed serialization, not an implemented endpoint or complete response. Full signal reads also expose stored evidence and `triggered_at` per the workflow contract. Current joined rule configuration must be labeled current; the response cannot claim it is a firing-time snapshot. Risk band, merchant tier and case priority are separate values. Ground-truth scenario labels remain demonstration data and must never supply rule predicates or live investigation answers.

## Review and handoff gate

@KadakWNL and @ShrikarDesai07 must explicitly review the inclusive amount predicate, INR 10000.00 threshold, ordinal merchant mapping, 40/25 weights, validation bounds and missing-input behavior. Record each approval against the exact PR revision; later formula changes require renewed review. No approval is inferred from assignment, publication or PR creation.

The existing unique `(transaction_id, rule_id)` supports once-only immutable signals. After approval, downstream seed/scoring work must demonstrate the matrix, rejected inputs, duplicate protection and atomic insertion using actual database tests. VS04/VS05 then verify reads and decimal-string serialization. This document supplies expected results only; it records no executed database/API evidence.

No schema objects, migrations, application endpoints or scoring engine are delivered here. The ER reconciliation remains gated by the case/session review in issue #3. Issue #2 remains open until both formula approvals are recorded.
