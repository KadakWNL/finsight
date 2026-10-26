ALTER TABLE public.address ADD CONSTRAINT address_coordinates CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
ALTER TABLE public.merchant ADD CONSTRAINT merchant_coordinates CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
ALTER TABLE public.transaction ADD CONSTRAINT transaction_coordinates CHECK (
    (latitude IS NULL AND longitude IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
CREATE UNIQUE INDEX address_one_primary ON public.address (customer_id) WHERE is_primary;

CREATE FUNCTION public.reject_retained_financial_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Retained financial facts cannot be changed' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public.reject_retained_financial_change() FROM PUBLIC;

CREATE TRIGGER transaction_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON public.transaction
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_retained_financial_change();
CREATE TRIGGER risk_signal_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON public.risk_signal
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_retained_financial_change();

CREATE INDEX transaction_cursor ON public.transaction (occurred_at DESC, transaction_id DESC);
CREATE INDEX transaction_account_activity ON public.transaction (account_id, occurred_at DESC, transaction_id DESC);
CREATE INDEX transaction_merchant_activity ON public.transaction (merchant_id, occurred_at DESC, transaction_id DESC);
CREATE INDEX transaction_device_activity ON public.transaction (device_id, occurred_at DESC, transaction_id DESC);
CREATE INDEX transaction_description_search ON public.transaction USING gin (search_vector);
CREATE INDEX account_customer_lookup ON public.account (customer_id);
CREATE INDEX payment_method_account_lookup ON public.payment_method (account_id);
