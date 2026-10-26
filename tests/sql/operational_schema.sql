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

INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
VALUES ('10000000-0000-0000-0000-000000000001', 'analyst@synthetic.invalid', 'test-only-noncredential', 'Synthetic analyst', 'analyst', true),
       ('10000000-0000-0000-0000-000000000002', 'admin@synthetic.invalid', 'test-only-noncredential', 'Synthetic admin', 'admin', true),
       ('10000000-0000-0000-0000-000000000003', 'inactive@synthetic.invalid', 'test-only-noncredential', 'Inactive analyst', 'analyst', false),
       ('10000000-0000-0000-0000-000000000004', 'system@synthetic.invalid', NULL, 'Synthetic service', 'system', true);

INSERT INTO public.customer (customer_id, user_id, country_code, status)
VALUES ('10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'IN', 'active');
INSERT INTO public.account (account_id, customer_id, account_number, account_type, currency_code, balance, status, opened_at)
VALUES ('10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000010', 'SYNTHETIC-OPS', 'savings', 'INR', 1000, 'active', '2026-01-01');
INSERT INTO public.merchant (merchant_id, merchant_name, category_code, country_code, risk_tier)
VALUES ('10000000-0000-0000-0000-000000000030', 'Synthetic merchant', '5411', 'IN', 'low');
INSERT INTO public.device_fingerprint (device_id, device_hash, os_family, first_seen_at)
VALUES ('10000000-0000-0000-0000-000000000040', repeat('b', 64), 'synthetic', '2026-01-01T00:00:00Z');
INSERT INTO public.transaction (transaction_id, account_id, merchant_id, device_id, amount, currency_code, exchange_rate, direction, txn_type, status, occurred_at, merchant_country_code, description)
VALUES ('10000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000030',
        '10000000-0000-0000-0000-000000000040', 500, 'INR', 1, 'debit', 'card_payment', 'posted', '2026-01-01T00:00:00Z', 'IN', 'Synthetic operational fixture');

INSERT INTO public.investigation_case (case_id, case_ref, transaction_id, assigned_to_user_id, priority)
VALUES ('10000000-0000-0000-0000-000000000060', 'SYN-OPS-1', '10000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000001', 'high');

SELECT pg_temp.expect_error($q$UPDATE public.app_user SET email=' Analyst@synthetic.invalid ' WHERE role='analyst'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.app_user SET email='admin@synthetic.invalid' WHERE role='system'$q$, '23505');
SELECT pg_temp.expect_error($q$UPDATE public.app_user SET role='customer'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.app_user SET password_hash=NULL WHERE role='analyst'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.app_user SET password_hash='credential' WHERE role='system'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.customer SET user_id='ffffffff-ffff-ffff-ffff-ffffffffffff'$q$, '23503');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET transaction_id='ffffffff-ffff-ffff-ffff-ffffffffffff'$q$, '23503');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET assigned_to_user_id='ffffffff-ffff-ffff-ffff-ffffffffffff'$q$, '23503');
SELECT pg_temp.expect_error('UPDATE public.investigation_case SET transaction_id=NULL', '23502');
SELECT pg_temp.expect_error('UPDATE public.investigation_case SET version=0', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET priority='urgent'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET status='closed'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET resolution_code='false_positive'$q$, '23514');
SELECT pg_temp.expect_error($q$INSERT INTO public.investigation_case (case_id, case_ref, transaction_id, priority) VALUES ('10000000-0000-0000-0000-000000000061', 'SYN-OPS-2', '10000000-0000-0000-0000-000000000050', 'low')$q$, '23505');

UPDATE public.investigation_case SET status='closed', resolution_code='confirmed_suspicious', resolution_notes='Synthetic conclusion', closed_at='2026-01-02T00:00:00Z';
SELECT pg_temp.expect_error('UPDATE public.investigation_case SET resolution_code=NULL', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET resolution_code='false_positive'$q$, '23514');
SELECT pg_temp.expect_error('UPDATE public.investigation_case SET closed_at=NULL', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET resolution_notes=' '$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET resolution_notes=repeat('x',5001)$q$, '23514');
UPDATE public.investigation_case SET status='dismissed', resolution_code='false_positive';
UPDATE public.investigation_case SET resolution_code='insufficient_evidence';
INSERT INTO public.investigation_case (case_id, case_ref, transaction_id, priority)
VALUES ('10000000-0000-0000-0000-000000000061', 'SYN-OPS-2', '10000000-0000-0000-0000-000000000050', 'low');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET status='open', resolution_code=NULL, resolution_notes=NULL, closed_at=NULL WHERE case_ref='SYN-OPS-1'$q$, '23505');
SELECT pg_temp.expect_error($q$UPDATE public.investigation_case SET case_ref='SYN-OPS-1' WHERE case_ref='SYN-OPS-2'$q$, '23505');

INSERT INTO public.case_event (case_id, actor_user_id, event_type, from_state, to_state, reason, operation_id, event_ordinal)
VALUES ('10000000-0000-0000-0000-000000000060', '10000000-0000-0000-0000-000000000001', 'created', NULL,
        '{"case_ref":"SYN-OPS-1","transaction_id":"10000000-0000-0000-0000-000000000050","status":"open","priority":"high","assigned_to_user_id":null,"opened_at":"2026-01-01T00:00:00Z"}',
        'Synthetic rationale', '10000000-0000-0000-0000-000000000070', 1),
       ('10000000-0000-0000-0000-000000000060', '10000000-0000-0000-0000-000000000001', 'assigned', '{"assigned_to_user_id":null}',
        '{"assigned_to_user_id":"10000000-0000-0000-0000-000000000001"}', NULL, '10000000-0000-0000-0000-000000000070', 2);

SELECT pg_temp.expect_error('UPDATE public.case_event SET event_ordinal=0', '23514');
SELECT pg_temp.expect_error('UPDATE public.case_event SET event_ordinal=1', '23505');
SELECT pg_temp.expect_error('UPDATE public.case_event SET operation_id=NULL', '23502');
SELECT pg_temp.expect_error('UPDATE public.case_event SET actor_user_id=NULL', '23502');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET metadata='{"password":"x"}'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET to_state=to_state || '{"reason":"x"}'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET to_state='null'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET to_state='[]'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET reason=NULL WHERE event_type='created'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET reason=repeat('x',2001) WHERE event_type='created'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET to_state=jsonb_set(to_state,'{assigned_to_user_id}','42') WHERE event_type='assigned'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET to_state=jsonb_set(to_state,'{opened_at}','"2026-02-30T00:00:00Z"') WHERE event_type='created'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET to_state=jsonb_set(to_state,'{opened_at}','"2026-01-01T00:00:00+25:00"') WHERE event_type='created'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_event SET event_type='note_added'$q$, '23514');

DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT * FROM (VALUES
      ('{"status":"open"}', '{"status":"in_review"}', NULL::text),
      ('{"status":"in_review"}', '{"status":"escalated"}', 'Escalate synthetic case'),
      ('{"status":"escalated"}', '{"status":"in_review"}', 'Return synthetic case'),
      ('{"status":"in_review","resolution_code":null,"closed_at":null}', '{"status":"closed","resolution_code":"confirmed_suspicious","closed_at":"2026-01-02T00:00:00Z"}', 'Synthetic conclusion'),
      ('{"status":"escalated","resolution_code":null,"closed_at":null}', '{"status":"dismissed","resolution_code":"false_positive","closed_at":"2026-01-02T00:00:00Z"}', 'Synthetic dismissal'),
      ('{"status":"in_review","resolution_code":null,"closed_at":null}', '{"status":"dismissed","resolution_code":"insufficient_evidence","closed_at":"2026-01-02T00:00:00Z"}', 'Synthetic inconclusive'),
      ('{"status":"closed","resolution_code":"confirmed_suspicious","closed_at":"2026-01-02T00:00:00Z","due_at":null}', '{"status":"open","resolution_code":null,"closed_at":null,"due_at":null}', 'Reopen synthetic case')
    ) AS examples(before_state, after_state, reason) LOOP
        INSERT INTO public.case_event (case_id, actor_user_id, event_type, from_state, to_state, reason, operation_id, event_ordinal)
        VALUES ('10000000-0000-0000-0000-000000000060', '10000000-0000-0000-0000-000000000002', 'status_change', r.before_state::jsonb, r.after_state::jsonb, r.reason, gen_random_uuid(), 1);
    END LOOP;
    FOR r IN SELECT * FROM (VALUES
      ('{"status":"open"}', '{"status":"closed"}', 'Invalid direct close'),
      ('{"status":"in_review"}', '{"status":"escalated"}', NULL::text),
      ('{"status":"open"}', '{"status":"in_review","priority":"low"}', NULL::text),
      ('{"status":"open"}', '{"status":42}', NULL::text),
      ('{"status":"open"}', '{"status":null}', NULL::text),
      ('{"status":"in_review","resolution_code":null,"closed_at":null}', '{"status":"closed","resolution_code":"false_positive","closed_at":null}', 'Bad terminal'),
      ('{"status":"closed","resolution_code":"confirmed_suspicious","closed_at":"2026-01-02T00:00:00Z","due_at":null}', '{"status":"open","resolution_code":null,"closed_at":null,"due_at":null}', NULL::text)
    ) AS examples(before_state, after_state, reason) LOOP
        PERFORM pg_temp.expect_error(format('INSERT INTO public.case_event (case_id, actor_user_id, event_type, from_state, to_state, reason, operation_id, event_ordinal) VALUES (%L,%L,%L,%L,%L,%L,gen_random_uuid(),1)',
            '10000000-0000-0000-0000-000000000060', '10000000-0000-0000-0000-000000000002', 'status_change', r.before_state, r.after_state, r.reason), '23514');
    END LOOP;
END;
$$;

INSERT INTO public.app_session (session_id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
VALUES ('10000000-0000-0000-0000-000000000080', '10000000-0000-0000-0000-000000000001', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:30:00Z', '2026-01-01T08:00:00Z');
SELECT pg_temp.expect_error($q$UPDATE public.app_session SET user_id='ffffffff-ffff-ffff-ffff-ffffffffffff'$q$, '23503');
SELECT pg_temp.expect_error($q$UPDATE public.app_session SET idle_expires_at='2026-01-01T00:31:00Z'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.app_session SET absolute_expires_at='2026-01-01T08:01:00Z'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.app_session SET last_seen_at='2025-12-31T23:59:00Z'$q$, '23514');
SELECT pg_temp.expect_error('UPDATE public.app_session SET idle_expires_at=last_seen_at', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.app_session SET revocation_reason='sign_out'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.app_session SET absolute_expires_at='infinity'$q$, '23514');
UPDATE public.app_session SET revoked_at='2026-01-01T00:01:00Z', revocation_reason='sign_out';
SELECT pg_temp.expect_error($q$UPDATE public.app_session SET revocation_reason='arbitrary text'$q$, '23514');

INSERT INTO public.case_command_receipt (operation_id, actor_user_id, idempotency_key, command_type, request_hash, case_id, response_status)
VALUES ('10000000-0000-0000-0000-000000000070', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000090', 'create', repeat('a',64), '10000000-0000-0000-0000-000000000060', 201);
SELECT pg_temp.expect_error('INSERT INTO public.case_command_receipt SELECT gen_random_uuid(), actor_user_id, idempotency_key, command_type, request_hash, case_id, response_status, completed_at FROM public.case_command_receipt', '23505');
SELECT pg_temp.expect_error($q$UPDATE public.case_command_receipt SET request_hash='payload'$q$, '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_command_receipt SET command_type='delete'$q$, '23514');
SELECT pg_temp.expect_error('UPDATE public.case_command_receipt SET response_status=409', '23514');
SELECT pg_temp.expect_error($q$UPDATE public.case_command_receipt SET case_id='ffffffff-ffff-ffff-ffff-ffffffffffff'$q$, '23503');
SELECT pg_temp.expect_error('DELETE FROM public.investigation_case', '23503');
SELECT pg_temp.expect_error('DELETE FROM public.app_user', '23503');
SELECT pg_temp.expect_error('DELETE FROM public.transaction', CASE
    WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.transaction'::regclass AND tgname='transaction_retained') THEN '55000'
    ELSE '23503' END);

DO $$
BEGIN
    IF (SELECT version FROM public.investigation_case WHERE case_ref='SYN-OPS-1') <> 1 THEN RAISE EXCEPTION 'Initial version mismatch'; END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND confdeltype <> 'r') THEN RAISE EXCEPTION 'Nonrestrictive FK'; END IF;
    IF EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r',c.relowner))) a
               WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('app_user','app_session','investigation_case','case_event','case_command_receipt') AND a.grantee=0) THEN RAISE EXCEPTION 'PUBLIC operational grants'; END IF;
END;
$$;
ROLLBACK;
