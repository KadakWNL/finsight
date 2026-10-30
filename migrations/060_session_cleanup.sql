-- Migration 060_session_cleanup.sql
-- Audited admin cleanup of expired PostgreSQL sessions (Issue #23)

CREATE TABLE public.app_session_cleanup (
    operation_id uuid PRIMARY KEY,
    admin_id uuid NOT NULL REFERENCES public.app_user (user_id) ON DELETE RESTRICT,
    preview_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    cutoff_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    candidate_session_ids uuid[] NOT NULL,
    candidate_count integer NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'completed')),
    idempotency_key uuid,
    request_hash text CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
    completed_at timestamptz,
    deleted_count integer,
    CHECK (candidate_count >= 0 AND candidate_count <= 100),
    CHECK (preview_at <= expires_at AND cutoff_at < preview_at),
    CHECK (
        (status = 'previewed' AND completed_at IS NULL AND deleted_count IS NULL AND idempotency_key IS NULL AND request_hash IS NULL) OR
        (status = 'completed' AND completed_at IS NOT NULL AND deleted_count IS NOT NULL AND deleted_count >= 0 AND deleted_count <= candidate_count AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL)
    )
);

CREATE UNIQUE INDEX session_cleanup_admin_idempotency ON public.app_session_cleanup (admin_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE FUNCTION public.reject_cleanup_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION 'Cleanup audit records are immutable and cannot be deleted' USING ERRCODE = '55000';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'completed' THEN
            RAISE EXCEPTION 'Completed cleanup audit records are immutable' USING ERRCODE = '55000';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER cleanup_audit_immutable_stmt BEFORE DELETE OR TRUNCATE ON public.app_session_cleanup
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_cleanup_audit_mutation();

CREATE TRIGGER cleanup_audit_immutable_row BEFORE UPDATE ON public.app_session_cleanup
    FOR EACH ROW EXECUTE FUNCTION public.reject_cleanup_audit_mutation();

CREATE FUNCTION public.preview_app_session_cleanup(p_admin_user_id uuid)
RETURNS TABLE (
    operation_id uuid,
    candidate_count integer,
    cutoff_at timestamptz,
    expires_at timestamptz,
    preview_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
DECLARE
    v_admin record;
    v_now timestamptz;
    v_cutoff timestamptz;
    v_expires timestamptz;
    v_op_id uuid;
    v_candidates uuid[];
    v_count integer;
BEGIN
    SELECT role, is_active INTO v_admin FROM public.app_user WHERE user_id = p_admin_user_id FOR SHARE;
    IF v_admin.role IS NULL OR v_admin.role <> 'admin' OR v_admin.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Caller is not an active administrator' USING ERRCODE = '42501';
    END IF;

    v_now := clock_timestamp();
    v_cutoff := v_now - interval '7 days';
    v_expires := v_now + interval '10 minutes';
    v_op_id := gen_random_uuid();

    SELECT coalesce(array_agg(sub.session_id ORDER BY sub.unusable_at ASC, sub.session_id ASC), ARRAY[]::uuid[])
    INTO v_candidates
    FROM (
        SELECT s.session_id, LEAST(s.idle_expires_at, s.absolute_expires_at, s.revoked_at) AS unusable_at
        FROM public.app_session s
        WHERE LEAST(s.idle_expires_at, s.absolute_expires_at, s.revoked_at) < v_cutoff
        ORDER BY LEAST(s.idle_expires_at, s.absolute_expires_at, s.revoked_at) ASC, s.session_id ASC
        LIMIT 100
    ) sub;

    v_count := coalesce(cardinality(v_candidates), 0);

    INSERT INTO public.app_session_cleanup (
        operation_id, admin_id, preview_at, cutoff_at, expires_at,
        candidate_session_ids, candidate_count, status
    ) VALUES (
        v_op_id, p_admin_user_id, v_now, v_cutoff, v_expires,
        v_candidates, v_count, 'previewed'
    );

    RETURN QUERY SELECT v_op_id, v_count, v_cutoff, v_expires, v_now;
END;
$$;

CREATE FUNCTION public.confirm_app_session_cleanup(
    p_operation_id uuid,
    p_admin_user_id uuid,
    p_idempotency_key uuid,
    p_request_hash text
)
RETURNS TABLE (
    operation_id uuid,
    status varchar(16),
    candidate_count integer,
    deleted_count integer,
    cutoff_at timestamptz,
    completed_at timestamptz,
    replayed boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
#variable_conflict use_column
DECLARE
    v_admin record;
    v_op public.app_session_cleanup%ROWTYPE;
    v_now timestamptz;
    v_deleted_count integer;
BEGIN
    SELECT role, is_active INTO v_admin FROM public.app_user WHERE user_id = p_admin_user_id FOR SHARE;
    IF v_admin.role IS NULL OR v_admin.role <> 'admin' OR v_admin.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'Caller is not an active administrator' USING ERRCODE = '42501';
    END IF;

    IF p_operation_id IS NULL OR p_idempotency_key IS NULL OR p_request_hash IS NULL THEN
        RAISE EXCEPTION 'Operation ID, idempotency key and request hash are required' USING ERRCODE = '22023';
    END IF;

    IF p_request_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid request hash format' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_op FROM public.app_session_cleanup c WHERE c.operation_id = p_operation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cleanup operation not found' USING ERRCODE = '02000';
    END IF;

    IF v_op.admin_id <> p_admin_user_id THEN
        RAISE EXCEPTION 'Operation does not belong to administrator' USING ERRCODE = '42501';
    END IF;

    IF v_op.status = 'completed' THEN
        IF v_op.idempotency_key = p_idempotency_key THEN
            IF v_op.request_hash <> p_request_hash THEN
                RAISE EXCEPTION 'Idempotency conflict: key was used with a different request' USING ERRCODE = '23505';
            END IF;
            RETURN QUERY SELECT
                v_op.operation_id, v_op.status, v_op.candidate_count,
                v_op.deleted_count, v_op.cutoff_at, v_op.completed_at, true AS replayed;
            RETURN;
        ELSE
            RETURN QUERY SELECT
                v_op.operation_id, v_op.status, v_op.candidate_count,
                v_op.deleted_count, v_op.cutoff_at, v_op.completed_at, true AS replayed;
            RETURN;
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.app_session_cleanup c
        WHERE c.admin_id = p_admin_user_id AND c.idempotency_key = p_idempotency_key AND c.operation_id <> p_operation_id
    ) THEN
        RAISE EXCEPTION 'Idempotency conflict: key was already used for another operation' USING ERRCODE = '23505';
    END IF;

    v_now := clock_timestamp();
    IF v_now >= v_op.expires_at THEN
        RAISE EXCEPTION 'Cleanup preview has expired' USING ERRCODE = '22000';
    END IF;

    PERFORM s.session_id
    FROM public.app_session s
    WHERE s.session_id = ANY(v_op.candidate_session_ids)
    ORDER BY s.session_id ASC
    FOR UPDATE;

    -- A candidate lock may have waited past the preview validity window.
    v_now := clock_timestamp();
    IF v_now >= v_op.expires_at THEN
        RAISE EXCEPTION 'Cleanup preview has expired' USING ERRCODE = '22000';
    END IF;

    WITH eligible_candidates AS (
        SELECT s.session_id
        FROM public.app_session s
        WHERE s.session_id = ANY(v_op.candidate_session_ids)
          AND LEAST(s.idle_expires_at, s.absolute_expires_at, s.revoked_at) < v_op.cutoff_at
    ), deleted_sessions AS (
        DELETE FROM public.app_session s
        USING eligible_candidates ec
        WHERE s.session_id = ec.session_id
        RETURNING s.session_id
    )
    SELECT count(*)::integer INTO v_deleted_count FROM deleted_sessions;

    UPDATE public.app_session_cleanup
    SET status = 'completed',
        idempotency_key = p_idempotency_key,
        request_hash = p_request_hash,
        completed_at = v_now,
        deleted_count = v_deleted_count
    WHERE public.app_session_cleanup.operation_id = p_operation_id;

    RETURN QUERY SELECT
        v_op.operation_id,
        'completed'::varchar(16) AS status,
        v_op.candidate_count,
        v_deleted_count,
        v_op.cutoff_at,
        v_now AS completed_at,
        false AS replayed;
    RETURN;
END;
$$;

REVOKE ALL ON TABLE public.app_session_cleanup FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_cleanup_audit_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_app_session_cleanup(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_app_session_cleanup(uuid, uuid, uuid, text) FROM PUBLIC;

CREATE PROCEDURE public.grant_cleanup_privileges(target_role regrole)
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('GRANT SELECT ON TABLE public.app_session_cleanup TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.preview_app_session_cleanup(uuid) TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.confirm_app_session_cleanup(uuid, uuid, uuid, text) TO %s', target_role);
END;
$$;
REVOKE ALL ON PROCEDURE public.grant_cleanup_privileges(regrole) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_runtime') THEN
        CALL public.grant_cleanup_privileges('finsight_runtime'::regrole);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_app') THEN
        CALL public.grant_cleanup_privileges('finsight_app'::regrole);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_test') THEN
        CALL public.grant_cleanup_privileges('finsight_test'::regrole);
    END IF;
END;
$$;
