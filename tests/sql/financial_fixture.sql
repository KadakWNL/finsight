INSERT INTO public.customer (customer_id, country_code, status)
VALUES ('20000000-0000-0000-0000-000000000001', 'IN', 'active');
INSERT INTO public.account (account_id, customer_id, account_number, account_type, currency_code, balance, status, opened_at)
VALUES ('20000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000001', 'SYN-GUARD-INR', 'savings', 'INR', 1000, 'active', '2026-01-01'),
       ('20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'SYN-GUARD-USD', 'savings', 'USD', 1000, 'active', '2026-01-01');
INSERT INTO public.payment_method (method_id, account_id, method_type, token, status)
VALUES ('20000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000010', 'card', 'synthetic-noncredential', 'active');
INSERT INTO public.merchant (merchant_id, merchant_name, category_code, country_code, risk_tier)
VALUES ('20000000-0000-0000-0000-000000000030', 'Synthetic guard merchant', '5411', 'IN', 'low');
INSERT INTO public.device_fingerprint (device_id, device_hash, os_family, first_seen_at)
VALUES ('20000000-0000-0000-0000-000000000040', repeat('c',64), 'synthetic', '2026-01-01T00:00:00Z');
INSERT INTO public.transaction (transaction_id, account_id, method_id, merchant_id, device_id, amount, currency_code, exchange_rate, direction, txn_type, status, occurred_at, merchant_country_code, description)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
       '20000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000020',
       '20000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000040',
       500, 'INR', 1, 'debit', 'card_payment', 'posted', '2026-01-01T00:00:00Z', 'IN', 'Synthetic financial guard fixture'
FROM generate_series(100,101) n;
