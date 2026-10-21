\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.expect_error(statement text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected_state THEN RETURN; END IF;
        RAISE EXCEPTION 'Expected SQLSTATE %, received %', expected_state, SQLSTATE;
    END;
    RAISE EXCEPTION 'Statement unexpectedly succeeded: %', statement;
END;
$$;

INSERT INTO public.customer (customer_id, country_code, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'IN', 'active');
INSERT INTO public.account (account_id, customer_id, account_number, account_type, currency_code, balance, status, opened_at)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'SYNTHETIC-INR', 'savings', 'INR', 1000, 'active', '2026-01-01'),
       ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'SYNTHETIC-USD', 'savings', 'USD', 1000, 'active', '2026-01-01');
INSERT INTO public.payment_method (method_id, account_id, method_type, token, status)
VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'card', 'synthetic-test-token', 'active');
INSERT INTO public.merchant (merchant_id, merchant_name, category_code, country_code, risk_tier)
VALUES ('00000000-0000-0000-0000-000000000030', 'Synthetic merchant', '5411', 'IN', 'low');
INSERT INTO public.device_fingerprint (device_id, device_hash, os_family, first_seen_at)
VALUES ('00000000-0000-0000-0000-000000000040', repeat('a', 64), 'synthetic', '2026-01-01T00:00:00Z');

INSERT INTO public.transaction (transaction_id, account_id, method_id, merchant_id, device_id, amount, currency_code, exchange_rate, direction, txn_type, status, occurred_at, merchant_country_code, description)
SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020',
       '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040',
       500, 'INR', 1, 'debit', 'card_payment', 'posted', '2026-01-01T00:00:00Z', 'IN', 'Synthetic fixture'
FROM generate_series(100, 101) n;

INSERT INTO public.transaction (transaction_id, account_id, merchant_id, device_id, amount, currency_code, exchange_rate, direction, txn_type, status, occurred_at, merchant_country_code, description)
VALUES ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000011',
        '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040',
        125, 'USD', 79.99996000, 'debit', 'card_payment', 'posted', '2026-01-01T00:00:00Z', 'IN', 'Synthetic USD boundary');

DO $$
DECLARE actual numeric;
BEGIN
    SELECT amount_base INTO actual FROM public.transaction WHERE transaction_id = '00000000-0000-0000-0000-000000000102';
    IF actual IS DISTINCT FROM 10000.00 THEN RAISE EXCEPTION 'INR rounding mismatch: %', actual; END IF;
    IF (SELECT count(*) FROM public.transaction WHERE method_id = '00000000-0000-0000-0000-000000000020') <> 2 THEN RAISE EXCEPTION 'Method must support many transactions'; END IF;
    IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN
       ('customer','address','account','payment_method','merchant','device_fingerprint','transaction','risk_rule','risk_signal','fraud_scenario','transaction_label')) <> 11 THEN RAISE EXCEPTION 'Missing baseline table'; END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND contype = 'f' AND confdeltype <> 'r') THEN RAISE EXCEPTION 'Nonrestrictive FK'; END IF;
END;
$$;

SELECT pg_temp.expect_error('UPDATE public.transaction SET amount=0', '23514');
SELECT pg_temp.expect_error('UPDATE public.transaction SET amount=-1', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.transaction SET amount='NaN'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.transaction SET amount='Infinity'$q$, '22003');
SELECT pg_temp.expect_error('UPDATE public.transaction SET exchange_rate=0', '23514');
SELECT pg_temp.expect_error('UPDATE public.transaction SET exchange_rate=-1', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.transaction SET exchange_rate='Infinity'$q$, '22003');
SELECT pg_temp.expect_error($q$UPDATE public.transaction SET exchange_rate='NaN'$q$, '23514');
SELECT pg_temp.expect_error('UPDATE public.transaction SET exchange_rate=2 WHERE currency_code=''INR''', '23514');
SELECT pg_temp.expect_error('UPDATE public.transaction SET amount=999999999999999999.99, exchange_rate=999999999999.99999999 WHERE currency_code=''USD''', '22003');
SELECT pg_temp.expect_error('UPDATE public.transaction SET amount_base=12', '428C9');
SELECT pg_temp.expect_error('UPDATE public.transaction SET currency_code=''EUR''', '23514');
SELECT pg_temp.expect_error('UPDATE public.transaction SET account_id=''00000000-0000-0000-0000-000000000011'' WHERE currency_code=''INR''', '23503');
SELECT pg_temp.expect_error('UPDATE public.transaction SET method_id=''00000000-0000-0000-0000-000000000020'' WHERE currency_code=''USD''', '23503');
SELECT pg_temp.expect_error('UPDATE public.transaction SET merchant_id=NULL', '23502');
SELECT pg_temp.expect_error('UPDATE public.transaction SET device_id=NULL', '23502');
SELECT pg_temp.expect_error('UPDATE public.transaction SET txn_type=''transfer''', '23514');
SELECT pg_temp.expect_error('UPDATE public.account SET balance=-1', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.account SET balance='NaN'$q$, '23514');
SELECT pg_temp.expect_error('DELETE FROM public.customer', '23503');
SELECT pg_temp.expect_error('DELETE FROM public.account', '23503');
SELECT pg_temp.expect_error('DELETE FROM public.merchant', '23503');

INSERT INTO public.risk_rule (rule_id, rule_code, rule_name, dimension, weight, threshold_value)
VALUES ('00000000-0000-0000-0000-000000000050', 'AMOUNT_BASE_GTE', 'Synthetic amount', 'amount', 40, 10000);
INSERT INTO public.risk_signal (signal_id, transaction_id, rule_id, observed_value, score_contribution, evidence)
VALUES ('00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000050', 500, 0, 'Synthetic zero-weight storage probe; not an evaluated rule result.');
SELECT pg_temp.expect_error($q$INSERT INTO public.risk_signal SELECT '00000000-0000-0000-0000-000000000061', transaction_id, rule_id, observed_value, score_contribution, evidence, triggered_at FROM public.risk_signal$q$, '23505');
SELECT pg_temp.expect_error('UPDATE public.risk_rule SET weight=0.5', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.risk_rule SET weight='NaN'$q$, '23514');
SELECT pg_temp.expect_error('UPDATE public.risk_signal SET score_contribution=-1', '23514');
SELECT pg_temp.expect_error('DELETE FROM public.risk_rule', '23503');
SELECT pg_temp.expect_error('DELETE FROM public.transaction WHERE transaction_id=''00000000-0000-0000-0000-000000000100''', '23503');

INSERT INTO public.fraud_scenario (scenario_id, scenario_code, scenario_name, description)
VALUES ('00000000-0000-0000-0000-000000000070', 'storage-probe', 'Synthetic storage probe', 'Not a scoring result.');
INSERT INTO public.transaction_label (transaction_id, scenario_id, is_suspicious)
VALUES ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000070', false);
SELECT pg_temp.expect_error('INSERT INTO public.transaction_label SELECT * FROM public.transaction_label', '23505');
SELECT pg_temp.expect_error('DELETE FROM public.fraud_scenario', '23503');

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.customer'::regclass AND contype = 'f') THEN RAISE EXCEPTION 'Operator FK must wait for operational migration'; END IF;
    IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
               WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.grantee = 0) THEN RAISE EXCEPTION 'Public table privileges must be absent'; END IF;
END;
$$;

ROLLBACK;
\echo 'PASS: baseline tables, same-method cardinality, optional method, INR/USD rounding, money and ownership rejection, restrictive references; fixtures rolled back'
