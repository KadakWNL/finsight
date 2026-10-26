\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.expect_error(statement text, expected_state text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = expected_state THEN RETURN; END IF;
        RAISE EXCEPTION 'Expected SQLSTATE %, received %: %', expected_state, SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Statement unexpectedly succeeded: %', statement;
END;
$$;
\ir financial_fixture.sql

INSERT INTO public.address (address_id, customer_id, line1, city, country_code, latitude, longitude, is_primary)
VALUES ('20000000-0000-0000-0000-000000000050', '20000000-0000-0000-0000-000000000001', 'Synthetic street', 'Synthetic city', 'IN', 90, -180, true);
SELECT pg_temp.expect_error($q$INSERT INTO public.address SELECT '20000000-0000-0000-0000-000000000051',customer_id,line1,city,state,postal_code,country_code,latitude,longitude,is_primary FROM public.address$q$, '23505');
SELECT pg_temp.expect_error('UPDATE public.address SET longitude=NULL', '23514');
SELECT pg_temp.expect_error('UPDATE public.address SET latitude=91', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.address SET latitude='NaN'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.merchant SET latitude=0,longitude='Infinity'$q$, '23514');
SELECT pg_temp.expect_error('UPDATE public.merchant SET latitude=0', '23514');
UPDATE public.address SET latitude=-90, longitude=180;
UPDATE public.address SET latitude=NULL, longitude=NULL;

DO $$
DECLARE base_sql text; r record;
BEGIN
    base_sql := 'INSERT INTO public.transaction (transaction_id,account_id,method_id,merchant_id,device_id,amount,currency_code,exchange_rate,direction,txn_type,status,occurred_at,merchant_country_code,description,latitude,longitude) SELECT gen_random_uuid(),account_id,method_id,merchant_id,device_id,%s,%s,%s,direction,txn_type,status,occurred_at,merchant_country_code,description,%s,%s FROM public.transaction LIMIT 1';
    FOR r IN SELECT * FROM (VALUES
        ('0', quote_literal('INR'), '1', 'NULL', 'NULL'),
        ('-1', quote_literal('INR'), '1', 'NULL', 'NULL'),
        (quote_literal('NaN'), quote_literal('INR'), '1', 'NULL', 'NULL'),
        ('500', quote_literal('INR'), '0', 'NULL', 'NULL'),
        ('500', quote_literal('INR'), '-1', 'NULL', 'NULL'),
        ('500', quote_literal('INR'), quote_literal('NaN'), 'NULL', 'NULL'),
        ('500', quote_literal('INR'), '2', 'NULL', 'NULL'),
        ('500', quote_literal('EUR'), '1', 'NULL', 'NULL'),
        ('500', quote_literal('INR'), '1', '0', 'NULL'),
        ('500', quote_literal('INR'), '1', '0', '181'),
        ('500', quote_literal('INR'), '1', quote_literal('NaN'), '0')
    ) AS bad(amount,currency,rate,lat,lon) LOOP
        PERFORM pg_temp.expect_error(format(base_sql,r.amount,r.currency,r.rate,r.lat,r.lon), '23514');
    END LOOP;
    PERFORM pg_temp.expect_error(replace(format(base_sql,'500',quote_literal('USD'),'80','NULL','NULL'), 'SELECT gen_random_uuid(),account_id,method_id,merchant_id', 'SELECT gen_random_uuid(),''20000000-0000-0000-0000-000000000011''::uuid,method_id,merchant_id'), '23503');
    PERFORM pg_temp.expect_error(replace(format(base_sql,'500',quote_literal('INR'),'1','NULL','NULL'), 'SELECT gen_random_uuid(),account_id,method_id,merchant_id', 'SELECT gen_random_uuid(),account_id,method_id,''ffffffff-ffff-ffff-ffff-ffffffffffff''::uuid'), '23503');
    IF (SELECT count(*) FROM public.transaction WHERE method_id='20000000-0000-0000-0000-000000000020') <> 2 THEN RAISE EXCEPTION 'Shared method lost'; END IF;
END;
$$;
SELECT pg_temp.expect_error('UPDATE public.account SET balance=-1', '23514');

INSERT INTO public.risk_rule (rule_id,rule_code,rule_name,dimension,weight,threshold_value)
VALUES ('20000000-0000-0000-0000-000000000060','GUARD_PROBE','Synthetic guard probe','amount',40,10000);
INSERT INTO public.risk_signal (signal_id,transaction_id,rule_id,observed_value,score_contribution,evidence)
VALUES ('20000000-0000-0000-0000-000000000070','20000000-0000-0000-0000-000000000100','20000000-0000-0000-0000-000000000060',500,0,'Synthetic storage probe');

SET LOCAL ROLE :"runtime_role";
SELECT pg_temp.expect_error('UPDATE public.transaction SET amount=1', '42501');
SELECT pg_temp.expect_error('DELETE FROM public.risk_signal', '42501');
SELECT pg_temp.expect_error('TRUNCATE public.transaction', '42501');
RESET ROLE;
GRANT SELECT, UPDATE, DELETE, TRUNCATE ON public.transaction, public.risk_signal TO :"runtime_role";
GRANT TRUNCATE ON public.transaction_label, public.investigation_case, public.case_event, public.case_command_receipt TO :"runtime_role";
SET LOCAL ROLE :"runtime_role";
SELECT pg_temp.expect_error('UPDATE public.transaction SET amount=1', '55000');
SELECT pg_temp.expect_error('DELETE FROM public.transaction WHERE false', '55000');
SELECT pg_temp.expect_error('TRUNCATE public.transaction CASCADE', '55000');
SELECT pg_temp.expect_error('UPDATE public.risk_signal SET evidence=''changed''', '55000');
SELECT pg_temp.expect_error('DELETE FROM public.risk_signal', '55000');
SELECT pg_temp.expect_error('TRUNCATE public.risk_signal', '55000');
SELECT pg_temp.expect_error('ALTER TABLE public.transaction DISABLE TRIGGER transaction_retained', '42501');
RESET ROLE;
DO $$
BEGIN
    IF (SELECT count(*) FROM public.transaction) <> 2 OR (SELECT count(*) FROM public.risk_signal) <> 1 THEN RAISE EXCEPTION 'Retained facts changed'; END IF;
END;
$$;
ROLLBACK;
