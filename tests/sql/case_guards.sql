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

-- Setup test users
INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
VALUES ('30000000-0000-0000-0000-000000000001', 'guard_analyst_a@synthetic.invalid', 'test-only', 'Analyst A', 'analyst', true),
       ('30000000-0000-0000-0000-000000000002', 'guard_analyst_b@synthetic.invalid', 'test-only', 'Analyst B', 'analyst', true),
       ('30000000-0000-0000-0000-000000000003', 'guard_admin@synthetic.invalid', 'test-only', 'Admin User', 'admin', true),
       ('30000000-0000-0000-0000-000000000004', 'guard_inactive@synthetic.invalid', 'test-only', 'Inactive User', 'analyst', false),
       ('30000000-0000-0000-0000-000000000005', 'guard_system@synthetic.invalid', NULL, 'System Service', 'system', true);

-- Setup test customer, account, merchant, device, transaction
INSERT INTO public.customer (customer_id, country_code, status)
VALUES ('30000000-0000-0000-0000-000000000010', 'IN', 'active');
INSERT INTO public.account (account_id, customer_id, account_number, account_type, currency_code, balance, status, opened_at)
VALUES ('30000000-0000-0000-0000-000000000020', '30000000-0000-0000-0000-000000000010', 'SYN-GUARD-ACC-1', 'savings', 'INR', 5000, 'active', '2026-01-01');
INSERT INTO public.merchant (merchant_id, merchant_name, category_code, country_code, risk_tier)
VALUES ('30000000-0000-0000-0000-000000000030', 'Guard Merchant', '5411', 'IN', 'low');
INSERT INTO public.device_fingerprint (device_id, device_hash, os_family, first_seen_at)
VALUES ('30000000-0000-0000-0000-000000000040', repeat('c', 64), 'synthetic', '2026-01-01T00:00:00Z');

INSERT INTO public.transaction (transaction_id, account_id, merchant_id, device_id, amount, currency_code, exchange_rate, direction, txn_type, status, occurred_at, merchant_country_code, description)
VALUES ('30000000-0000-0000-0000-000000000050', '30000000-0000-0000-0000-000000000020', '30000000-0000-0000-0000-000000000030',
        '30000000-0000-0000-0000-000000000040', 1000, 'INR', 1, 'debit', 'card_payment', 'posted', '2026-01-01T00:00:00Z', 'IN', 'Guard test transaction 1'),
       ('30000000-0000-0000-0000-000000000051', '30000000-0000-0000-0000-000000000020', '30000000-0000-0000-0000-000000000030',
        '30000000-0000-0000-0000-000000000040', 2000, 'INR', 1, 'debit', 'card_payment', 'posted', '2026-01-01T00:00:00Z', 'IN', 'Guard test transaction 2');

-- 1. System and Inactive users cannot create cases
SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'create', '30000000-0000-0000-0000-000000000005', gen_random_uuid(), repeat('1', 64),
    NULL, '30000000-0000-0000-0000-000000000060', '30000000-0000-0000-0000-000000000050', 'high', 'System attempt'
)
$q$, '28000');

SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'create', '30000000-0000-0000-0000-000000000004', gen_random_uuid(), repeat('1', 64),
    NULL, '30000000-0000-0000-0000-000000000060', '30000000-0000-0000-0000-000000000050', 'high', 'Inactive attempt'
)
$q$, '28000');

-- 2. Valid creation by Analyst A
SELECT * FROM public.execute_case_command(
    'create', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000070', repeat('1', 64),
    NULL, '30000000-0000-0000-0000-000000000060', '30000000-0000-0000-0000-000000000050', 'high', 'Initial valid creation by Analyst A',
    NULL, NULL, 'SYN-CASE-1'
);

-- Verify case row state
DO $$
DECLARE c public.investigation_case%ROWTYPE;
BEGIN
    SELECT * INTO c FROM public.investigation_case WHERE case_id = '30000000-0000-0000-0000-000000000060';
    IF c.status <> 'open' OR c.version <> 1 OR c.assigned_to_user_id <> '30000000-0000-0000-0000-000000000001' THEN
        RAISE EXCEPTION 'Case initial state mismatch';
    END IF;
END;
$$;

-- Verify event rows: created (ord 1) and assigned (ord 2)
DO $$
DECLARE cnt integer; e1 public.case_event%ROWTYPE; e2 public.case_event%ROWTYPE;
BEGIN
    SELECT count(*) INTO cnt FROM public.case_event WHERE case_id = '30000000-0000-0000-0000-000000000060';
    IF cnt <> 2 THEN RAISE EXCEPTION 'Expected exactly 2 events on creation, found %', cnt; END IF;
    SELECT * INTO e1 FROM public.case_event WHERE case_id = '30000000-0000-0000-0000-000000000060' AND event_ordinal = 1;
    SELECT * INTO e2 FROM public.case_event WHERE case_id = '30000000-0000-0000-0000-000000000060' AND event_ordinal = 2;
    IF e1.event_type <> 'created' OR e1.from_state IS NOT NULL OR e1.reason IS NULL THEN
        RAISE EXCEPTION 'Event 1 shape mismatch';
    END IF;
    IF e2.event_type <> 'assigned' OR e2.from_state ->> 'assigned_to_user_id' IS NOT NULL OR e2.to_state ->> 'assigned_to_user_id' <> '30000000-0000-0000-0000-000000000001' THEN
        RAISE EXCEPTION 'Event 2 shape mismatch';
    END IF;
END;
$$;

-- Immutability: direct UPDATE, DELETE, TRUNCATE on case_event rejected
SELECT pg_temp.expect_error('UPDATE public.case_event SET metadata = ''{}''::jsonb', '55000');
SELECT pg_temp.expect_error('DELETE FROM public.case_event', '55000');
SELECT pg_temp.expect_error('TRUNCATE public.case_event', '55000');

-- Immutability: direct UPDATE, DELETE, TRUNCATE on case_command_receipt rejected
SELECT pg_temp.expect_error('UPDATE public.case_command_receipt SET response_status=200', '55000');
SELECT pg_temp.expect_error('DELETE FROM public.case_command_receipt', '55000');
SELECT pg_temp.expect_error('TRUNCATE public.case_command_receipt', '55000');

-- 3. Idempotent replay: same key, same payload -> returns replayed true
DO $$
DECLARE res record;
BEGIN
    SELECT * INTO res FROM public.execute_case_command(
        'create', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000070', repeat('1', 64),
        NULL, '30000000-0000-0000-0000-000000000060', '30000000-0000-0000-0000-000000000050', 'high', 'Initial valid creation by Analyst A',
        NULL, NULL, 'SYN-CASE-1'
    );
    IF NOT res.replayed OR res.response_status <> 201 THEN
        RAISE EXCEPTION 'Expected replayed true, got %', res;
    END IF;
    IF (SELECT count(*) FROM public.case_event WHERE case_id = '30000000-0000-0000-0000-000000000060') <> 2 THEN
        RAISE EXCEPTION 'Replay must not duplicate events';
    END IF;
END;
$$;

-- 4. Idempotent conflict: same key, different payload -> P0409
SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'create', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000070', repeat('2', 64),
    NULL, '30000000-0000-0000-0000-000000000060', '30000000-0000-0000-0000-000000000050', 'high', 'Changed payload'
)
$q$, 'P0409');

-- 5. Competing active case on same transaction rejected
SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'create', '30000000-0000-0000-0000-000000000002', gen_random_uuid(), repeat('3', 64),
    NULL, gen_random_uuid(), '30000000-0000-0000-0000-000000000050', 'low', 'Competing case attempt'
)
$q$, '23505');

-- 6. Analyst B cannot start review on Analyst A's case
SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'start_review', '30000000-0000-0000-0000-000000000002', gen_random_uuid(), repeat('4', 64),
    1, '30000000-0000-0000-0000-000000000060'
)
$q$, '42501');

-- 7. Stale expected_version rejected
SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'start_review', '30000000-0000-0000-0000-000000000001', gen_random_uuid(), repeat('4', 64),
    999, '30000000-0000-0000-0000-000000000060'
)
$q$, 'P0409');

-- 8. Analyst A starts review -> status becomes in_review, version becomes 2
SELECT * FROM public.execute_case_command(
    'start_review', '30000000-0000-0000-0000-000000000001', gen_random_uuid(), repeat('4', 64),
    1, '30000000-0000-0000-0000-000000000060'
);

-- 9. Analyst A escalates case -> status becomes escalated, version becomes 3
SELECT * FROM public.execute_case_command(
    'escalate', '30000000-0000-0000-0000-000000000001', gen_random_uuid(), repeat('5', 64),
    2, '30000000-0000-0000-0000-000000000060', NULL, NULL, 'Suspicious transaction pattern requires tier-2 review'
);

-- 10. Analyst cannot return to review (admin only)
SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'return_to_review', '30000000-0000-0000-0000-000000000001', gen_random_uuid(), repeat('6', 64),
    3, '30000000-0000-0000-0000-000000000060', NULL, NULL, 'Analyst return attempt'
)
$q$, '42501');

-- Admin returns case to review -> status becomes in_review, version becomes 4
SELECT * FROM public.execute_case_command(
    'return_to_review', '30000000-0000-0000-0000-000000000003', gen_random_uuid(), repeat('6', 64),
    3, '30000000-0000-0000-0000-000000000060', NULL, NULL, 'Admin returning to analyst for additional device evidence'
);

-- 11. Resolution: invalid combination rejected
SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'resolve', '30000000-0000-0000-0000-000000000001', gen_random_uuid(), repeat('7', 64),
    4, '30000000-0000-0000-0000-000000000060', NULL, NULL, NULL, 'false_positive', 'Invalid code for resolve'
)
$q$, '22023');

-- Valid resolve by Analyst A -> status becomes closed, version becomes 5
SELECT * FROM public.execute_case_command(
    'resolve', '30000000-0000-0000-0000-000000000001', gen_random_uuid(), repeat('8', 64),
    4, '30000000-0000-0000-0000-000000000060', NULL, NULL, NULL, 'confirmed_suspicious', 'Verified fraudulent card activity across accounts'
);

-- 12. Analyst cannot reopen terminal case
SELECT pg_temp.expect_error($q$
SELECT * FROM public.execute_case_command(
    'reopen', '30000000-0000-0000-0000-000000000001', gen_random_uuid(), repeat('9', 64),
    5, '30000000-0000-0000-0000-000000000060', NULL, NULL, 'Analyst reopen attempt'
)
$q$, '42501');

-- Admin reopens case -> status becomes open, resolution fields cleared, version becomes 6
SELECT * FROM public.execute_case_command(
    'reopen', '30000000-0000-0000-0000-000000000003', gen_random_uuid(), repeat('9', 64),
    5, '30000000-0000-0000-0000-000000000060', NULL, NULL, 'New customer evidence provided to overturn prior conclusion'
);

DO $$
DECLARE c public.investigation_case%ROWTYPE;
BEGIN
    SELECT * INTO c FROM public.investigation_case WHERE case_id = '30000000-0000-0000-0000-000000000060';
    IF c.status <> 'open' OR c.version <> 6 OR c.resolution_code IS NOT NULL OR c.closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Reopened case state mismatch: %', c;
    END IF;
END;
$$;

ROLLBACK;
