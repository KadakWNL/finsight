-- 070_analyst_administration.sql
-- Admin-managed analyst credentials with immutable administrative audit.
-- Analysts are deactivated, never deleted: case, event, receipt and session rows retain valid actors.

CREATE TABLE public.admin_audit_event (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id uuid NOT NULL,
    actor_user_id uuid NOT NULL REFERENCES public.app_user ON DELETE RESTRICT,
    action varchar(32) NOT NULL CHECK (action IN (
        'analyst_created',
        'analyst_deactivated',
        'analyst_reactivated',
        'password_reset'
    )),
    target_user_id uuid NOT NULL REFERENCES public.app_user ON DELETE RESTRICT,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT admin_audit_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX admin_audit_target_time ON public.admin_audit_event
    (target_user_id, occurred_at DESC, event_id DESC);
CREATE INDEX admin_audit_actor_time ON public.admin_audit_event
    (actor_user_id, occurred_at DESC, event_id DESC);

CREATE FUNCTION public.reject_admin_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Administrative audit events are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER admin_audit_event_immutable_stmt BEFORE DELETE OR TRUNCATE ON public.admin_audit_event
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_admin_audit_mutation();

CREATE TRIGGER admin_audit_event_immutable_row AFTER UPDATE ON public.admin_audit_event
    FOR EACH ROW EXECUTE FUNCTION public.reject_admin_audit_mutation();

CREATE FUNCTION public.create_analyst_account(
    p_actor_user_id uuid,
    p_email text,
    p_display_name text,
    p_password_hash text
) RETURNS TABLE (
    user_id uuid,
    email text,
    display_name text,
    role text,
    is_active boolean,
    created_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
    v_actor public.app_user%ROWTYPE;
    v_user public.app_user%ROWTYPE;
    v_email text;
    v_name text;
BEGIN
    SELECT * INTO v_actor FROM public.app_user
    WHERE public.app_user.user_id = p_actor_user_id FOR SHARE;
    IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'admin' THEN
        RAISE EXCEPTION 'Only an active administrator can manage analyst accounts' USING ERRCODE = '42501';
    END IF;

    v_email := lower(btrim(coalesce(p_email, '')));
    IF v_email = '' OR length(v_email) > 320 OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023';
    END IF;

    v_name := btrim(coalesce(p_display_name, ''));
    IF length(v_name) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'Display name must contain 1-200 characters' USING ERRCODE = '22023';
    END IF;

    IF p_password_hash IS NULL OR p_password_hash !~ '^\$argon2id\$' OR length(p_password_hash) > 1024 THEN
        RAISE EXCEPTION 'Password hash must be an Argon2id hash' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (SELECT 1 FROM public.app_user WHERE public.app_user.email = v_email) THEN
        RAISE EXCEPTION 'An account with this email already exists' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.app_user (user_id, email, password_hash, display_name, role, is_active)
    VALUES (gen_random_uuid(), v_email, p_password_hash, v_name, 'analyst', true)
    RETURNING * INTO v_user;

    INSERT INTO public.admin_audit_event (operation_id, actor_user_id, action, target_user_id, details)
    VALUES (gen_random_uuid(), p_actor_user_id, 'analyst_created', v_user.user_id, '{}'::jsonb);

    RETURN QUERY SELECT v_user.user_id, v_user.email::text, v_user.display_name::text,
        v_user.role::text, v_user.is_active, v_user.created_at;
END;
$$;

CREATE FUNCTION public.deactivate_analyst_account(
    p_actor_user_id uuid,
    p_target_user_id uuid,
    p_reason text DEFAULT NULL
) RETURNS TABLE (
    user_id uuid,
    is_active boolean,
    unassigned_case_count integer,
    sessions_revoked integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
    v_actor public.app_user%ROWTYPE;
    v_target public.app_user%ROWTYPE;
    v_case record;
    v_now timestamptz;
    v_operation_id uuid := gen_random_uuid();
    v_ordinal integer := 0;
    v_cases integer := 0;
    v_sessions integer := 0;
    v_reason text;
BEGIN
    SELECT * INTO v_actor FROM public.app_user
    WHERE public.app_user.user_id = p_actor_user_id FOR SHARE;
    IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'admin' THEN
        RAISE EXCEPTION 'Only an active administrator can manage analyst accounts' USING ERRCODE = '42501';
    END IF;

    IF p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'target user_id is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target FROM public.app_user
    WHERE public.app_user.user_id = p_target_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Analyst account not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.role <> 'analyst' THEN
        RAISE EXCEPTION 'Only analyst accounts can be managed' USING ERRCODE = '22023';
    END IF;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    IF p_reason IS NOT NULL AND (v_reason IS NULL OR length(v_reason) > 500) THEN
        RAISE EXCEPTION 'Deactivation reason must contain 1-500 characters' USING ERRCODE = '22023';
    END IF;

    IF NOT v_target.is_active THEN
        RETURN QUERY SELECT v_target.user_id, false, 0, 0;
        RETURN;
    END IF;

    v_now := clock_timestamp();

    UPDATE public.app_user SET is_active = false
    WHERE public.app_user.user_id = p_target_user_id;

    UPDATE public.app_session
    SET revoked_at = v_now, revocation_reason = 'user_disabled'
    WHERE public.app_session.user_id = p_target_user_id AND public.app_session.revoked_at IS NULL;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;

    FOR v_case IN
        SELECT c.case_id
        FROM public.investigation_case c
        WHERE c.assigned_to_user_id = p_target_user_id
          AND c.status IN ('open', 'in_review', 'escalated')
        ORDER BY c.case_id
        FOR UPDATE
    LOOP
        v_ordinal := v_ordinal + 1;
        UPDATE public.investigation_case
        SET assigned_to_user_id = NULL,
            version = investigation_case.version + 1,
            updated_at = v_now
        WHERE investigation_case.case_id = v_case.case_id;

        INSERT INTO public.case_event (
            case_id, actor_user_id, event_type, from_state, to_state,
            reason, metadata, operation_id, event_ordinal, occurred_at
        ) VALUES (
            v_case.case_id, p_actor_user_id, 'assigned',
            jsonb_build_object('assigned_to_user_id', p_target_user_id::text),
            jsonb_build_object('assigned_to_user_id', null),
            coalesce(v_reason, 'Analyst account deactivated'),
            '{}'::jsonb, v_operation_id, v_ordinal, v_now
        );
        v_cases := v_cases + 1;
    END LOOP;

    INSERT INTO public.admin_audit_event (operation_id, actor_user_id, action, target_user_id, details)
    VALUES (
        v_operation_id, p_actor_user_id, 'analyst_deactivated', p_target_user_id,
        jsonb_build_object(
            'unassigned_case_count', v_cases,
            'sessions_revoked', v_sessions,
            'reason', v_reason
        )
    );

    RETURN QUERY SELECT v_target.user_id, false, v_cases, v_sessions;
END;
$$;

CREATE FUNCTION public.reactivate_analyst_account(
    p_actor_user_id uuid,
    p_target_user_id uuid,
    p_password_hash text
) RETURNS TABLE (
    user_id uuid,
    is_active boolean,
    sessions_revoked integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
    v_actor public.app_user%ROWTYPE;
    v_target public.app_user%ROWTYPE;
    v_now timestamptz;
    v_sessions integer := 0;
BEGIN
    SELECT * INTO v_actor FROM public.app_user
    WHERE public.app_user.user_id = p_actor_user_id FOR SHARE;
    IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'admin' THEN
        RAISE EXCEPTION 'Only an active administrator can manage analyst accounts' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target FROM public.app_user
    WHERE public.app_user.user_id = p_target_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Analyst account not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.role <> 'analyst' THEN
        RAISE EXCEPTION 'Only analyst accounts can be managed' USING ERRCODE = '22023';
    END IF;
    IF v_target.is_active THEN
        RAISE EXCEPTION 'Account is already active' USING ERRCODE = '22023';
    END IF;
    IF p_password_hash IS NULL OR p_password_hash !~ '^\$argon2id\$' OR length(p_password_hash) > 1024 THEN
        RAISE EXCEPTION 'Password hash must be an Argon2id hash' USING ERRCODE = '22023';
    END IF;

    v_now := clock_timestamp();

    UPDATE public.app_user
    SET is_active = true, password_hash = p_password_hash
    WHERE public.app_user.user_id = p_target_user_id;

    UPDATE public.app_session
    SET revoked_at = v_now, revocation_reason = 'security'
    WHERE public.app_session.user_id = p_target_user_id AND public.app_session.revoked_at IS NULL;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;

    INSERT INTO public.admin_audit_event (operation_id, actor_user_id, action, target_user_id, details)
    VALUES (
        gen_random_uuid(), p_actor_user_id, 'analyst_reactivated', p_target_user_id,
        jsonb_build_object('sessions_revoked', v_sessions)
    );

    RETURN QUERY SELECT v_target.user_id, true, v_sessions;
END;
$$;

CREATE FUNCTION public.reset_analyst_password(
    p_actor_user_id uuid,
    p_target_user_id uuid,
    p_password_hash text
) RETURNS TABLE (
    user_id uuid,
    sessions_revoked integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
    v_actor public.app_user%ROWTYPE;
    v_target public.app_user%ROWTYPE;
    v_now timestamptz;
    v_sessions integer := 0;
BEGIN
    SELECT * INTO v_actor FROM public.app_user
    WHERE public.app_user.user_id = p_actor_user_id FOR SHARE;
    IF NOT FOUND OR NOT v_actor.is_active OR v_actor.role <> 'admin' THEN
        RAISE EXCEPTION 'Only an active administrator can manage analyst accounts' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target FROM public.app_user
    WHERE public.app_user.user_id = p_target_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Analyst account not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_target.role <> 'analyst' THEN
        RAISE EXCEPTION 'Only analyst accounts can be managed' USING ERRCODE = '22023';
    END IF;
    IF NOT v_target.is_active THEN
        RAISE EXCEPTION 'Reactivate the account with a new password instead' USING ERRCODE = '22023';
    END IF;
    IF p_password_hash IS NULL OR p_password_hash !~ '^\$argon2id\$' OR length(p_password_hash) > 1024 THEN
        RAISE EXCEPTION 'Password hash must be an Argon2id hash' USING ERRCODE = '22023';
    END IF;

    v_now := clock_timestamp();

    UPDATE public.app_user SET password_hash = p_password_hash
    WHERE public.app_user.user_id = p_target_user_id;

    UPDATE public.app_session
    SET revoked_at = v_now, revocation_reason = 'security'
    WHERE public.app_session.user_id = p_target_user_id AND public.app_session.revoked_at IS NULL;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;

    INSERT INTO public.admin_audit_event (operation_id, actor_user_id, action, target_user_id, details)
    VALUES (
        gen_random_uuid(), p_actor_user_id, 'password_reset', p_target_user_id,
        jsonb_build_object('sessions_revoked', v_sessions)
    );

    RETURN QUERY SELECT v_target.user_id, v_sessions;
END;
$$;

REVOKE ALL ON TABLE public.admin_audit_event FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.admin_audit_event_event_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_admin_audit_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_analyst_account(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_analyst_account(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reactivate_analyst_account(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_analyst_password(uuid, uuid, text) FROM PUBLIC;

CREATE PROCEDURE public.grant_analyst_admin_privileges(target_role regrole)
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('GRANT SELECT ON TABLE public.admin_audit_event TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.create_analyst_account(uuid, text, text, text) TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.deactivate_analyst_account(uuid, uuid, text) TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.reactivate_analyst_account(uuid, uuid, text) TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.reset_analyst_password(uuid, uuid, text) TO %s', target_role);
END;
$$;
REVOKE ALL ON PROCEDURE public.grant_analyst_admin_privileges(regrole) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_runtime') THEN
        CALL public.grant_analyst_admin_privileges('finsight_runtime'::regrole);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_app') THEN
        CALL public.grant_analyst_admin_privileges('finsight_app'::regrole);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_test') THEN
        CALL public.grant_analyst_admin_privileges('finsight_test'::regrole);
    END IF;
END;
$$;
