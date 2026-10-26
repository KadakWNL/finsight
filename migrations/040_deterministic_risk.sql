CREATE TRIGGER risk_rule_frozen BEFORE UPDATE OR DELETE OR TRUNCATE ON public.risk_rule
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_retained_financial_change();

CREATE FUNCTION public.freeze_merchant_tier() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF NEW.risk_tier IS DISTINCT FROM OLD.risk_tier THEN
        RAISE EXCEPTION 'Synthetic merchant tiers are frozen' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.freeze_merchant_tier() FROM PUBLIC;
CREATE TRIGGER merchant_tier_frozen BEFORE UPDATE OF risk_tier ON public.merchant
    FOR EACH ROW EXECUTE FUNCTION public.freeze_merchant_tier();

CREATE FUNCTION public.risk_band(score numeric) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
BEGIN
    IF score < 0 OR score >= 'Infinity'::numeric THEN
        RAISE EXCEPTION 'Invalid risk score' USING ERRCODE='22023';
    END IF;
    RETURN CASE WHEN score < 35 THEN 'low' WHEN score < 60 THEN 'medium' WHEN score < 80 THEN 'high' ELSE 'critical' END;
END;
$$;

CREATE FUNCTION public.score_transaction(subject uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE txn public.transaction%ROWTYPE; tier text; tier_code integer; rule public.risk_rule%ROWTYPE;
    observation numeric; explanation text; inserted integer := 0; affected integer;
BEGIN
    SELECT * INTO txn FROM public.transaction WHERE transaction_id=subject FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown transaction' USING ERRCODE='22023'; END IF;
    SELECT risk_tier INTO tier FROM public.merchant WHERE merchant_id=txn.merchant_id FOR SHARE;
    tier_code := CASE tier WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 END;
    IF txn.amount_base IS NULL OR txn.amount_base <= 0 OR txn.amount_base >= 'Infinity'::numeric OR tier_code IS NULL THEN
        RAISE EXCEPTION 'Incomplete scoring input' USING ERRCODE='22023';
    END IF;
    IF (SELECT count(*) FROM public.risk_rule) <> 2 OR
       EXISTS (SELECT 1 FROM public.risk_rule WHERE rule_code NOT IN ('AMOUNT_BASE_GTE','MERCHANT_TIER_GTE')) THEN
        RAISE EXCEPTION 'Expected exactly the two approved rules' USING ERRCODE='22023';
    END IF;
    FOR rule IN SELECT * FROM public.risk_rule ORDER BY rule_code FOR SHARE LOOP
        IF rule.version <> 1 OR rule.weight < 0 OR rule.weight > 100 OR rule.weight <> trunc(rule.weight)
           OR (rule.rule_code='AMOUNT_BASE_GTE' AND (rule.dimension <> 'amount' OR rule.threshold_value <= 0
               OR rule.threshold_value >= 1000000000000000000 OR rule.threshold_value <> round(rule.threshold_value,2)))
           OR (rule.rule_code='MERCHANT_TIER_GTE' AND (rule.dimension <> 'merchant' OR rule.threshold_value NOT IN (0,1,2))) THEN
            RAISE EXCEPTION 'Invalid scoring configuration' USING ERRCODE='22023';
        END IF;
    END LOOP;
    FOR rule IN SELECT * FROM public.risk_rule ORDER BY rule_code LOOP
        IF NOT rule.is_active THEN CONTINUE; END IF;
        IF rule.rule_code='AMOUNT_BASE_GTE' THEN
            observation := txn.amount_base;
            explanation := format('Synthetic amount rule: INR base %s >= threshold %s INR; contribution %s points.', observation, rule.threshold_value, rule.weight);
        ELSE
            observation := tier_code;
            explanation := format('Synthetic merchant rule: %s tier (low=0, medium=1, high=2), code %s >= threshold %s; contribution %s points.', tier, observation, rule.threshold_value, rule.weight);
        END IF;
        IF observation >= rule.threshold_value THEN
            INSERT INTO public.risk_signal (signal_id,transaction_id,rule_id,observed_value,score_contribution,evidence)
            VALUES (md5(subject::text || ':' || rule.rule_id::text)::uuid,subject,rule.rule_id,observation,rule.weight,explanation)
            ON CONFLICT (transaction_id,rule_id) DO NOTHING;
            GET DIAGNOSTICS affected = ROW_COUNT;
            inserted := inserted + affected;
        END IF;
    END LOOP;
    RETURN inserted;
END;
$$;

CREATE VIEW public.v_transaction_risk AS
SELECT t.transaction_id, coalesce(sum(s.score_contribution),0) AS risk_score,
       count(s.signal_id)::integer AS signal_count,
       public.risk_band(coalesce(sum(s.score_contribution),0)) AS risk_band
FROM public.transaction t LEFT JOIN public.risk_signal s USING (transaction_id)
GROUP BY t.transaction_id;

REVOKE ALL ON FUNCTION public.risk_band(numeric), public.score_transaction(uuid) FROM PUBLIC;
REVOKE ALL ON public.v_transaction_risk FROM PUBLIC;
