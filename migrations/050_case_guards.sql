CREATE FUNCTION public.reject_case_event_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Case events are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER case_event_immutable_stmt BEFORE DELETE OR TRUNCATE ON public.case_event
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_case_event_mutation();

CREATE TRIGGER case_event_immutable_row AFTER UPDATE ON public.case_event
    FOR EACH ROW EXECUTE FUNCTION public.reject_case_event_mutation();

CREATE FUNCTION public.reject_case_receipt_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    RAISE EXCEPTION 'Case command receipts are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER case_command_receipt_immutable_stmt BEFORE DELETE OR TRUNCATE ON public.case_command_receipt
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_case_receipt_mutation();

CREATE TRIGGER case_command_receipt_immutable_row AFTER UPDATE ON public.case_command_receipt
    FOR EACH ROW EXECUTE FUNCTION public.reject_case_receipt_mutation();

CREATE FUNCTION public.execute_case_command(
    p_command_type text,
    p_actor_user_id uuid,
    p_idempotency_key uuid,
    p_request_hash text,
    p_expected_version bigint DEFAULT NULL,
    p_case_id uuid DEFAULT NULL,
    p_transaction_id uuid DEFAULT NULL,
    p_priority text DEFAULT NULL,
    p_reason text DEFAULT NULL,
    p_resolution_code text DEFAULT NULL,
    p_resolution_notes text DEFAULT NULL,
    p_case_ref text DEFAULT NULL
) RETURNS TABLE (
    operation_id uuid,
    case_id uuid,
    case_ref varchar(64),
    status varchar(16),
    priority varchar(8),
    assigned_to_user_id uuid,
    version bigint,
    response_status integer,
    replayed boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
    v_receipt public.case_command_receipt%ROWTYPE;
    v_actor public.app_user%ROWTYPE;
    v_assignee public.app_user%ROWTYPE;
    v_case public.investigation_case%ROWTYPE;
    v_operation_id uuid;
    v_case_id uuid;
    v_case_ref varchar(64);
    v_now timestamptz;
    v_now_iso text;
    v_closed_at_iso text;
    v_old_closed_at_iso text;
    v_created_to_state jsonb;
    v_assigned_from_state jsonb;
    v_assigned_to_state jsonb;
    v_target_status varchar(16);
    v_new_assigned_user_id uuid;
    v_reassign_needed boolean := false;
BEGIN
    IF p_command_type IS NULL OR p_command_type NOT IN ('create', 'start_review', 'escalate', 'return_to_review', 'resolve', 'dismiss', 'reopen') THEN
        RAISE EXCEPTION 'Unknown command type: %', p_command_type USING ERRCODE = '22023';
    END IF;
    IF p_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'actor_user_id is required' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = '22023';
    END IF;
    IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid request hash' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_actor FROM public.app_user WHERE app_user.user_id = p_actor_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown actor identity' USING ERRCODE = '28000';
    END IF;
    IF NOT v_actor.is_active THEN
        RAISE EXCEPTION 'Inactive actor cannot execute commands' USING ERRCODE = '28000';
    END IF;
    IF v_actor.role = 'system' THEN
        RAISE EXCEPTION 'System role cannot execute interactive case commands' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_receipt FROM public.case_command_receipt
    WHERE case_command_receipt.actor_user_id = p_actor_user_id
      AND case_command_receipt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_receipt.request_hash <> p_request_hash THEN
            RAISE EXCEPTION 'Idempotency conflict: key already used with different request hash' USING ERRCODE = 'P0409';
        END IF;
        SELECT * INTO v_case FROM public.investigation_case WHERE investigation_case.case_id = v_receipt.case_id;
        RETURN QUERY SELECT
            v_receipt.operation_id,
            v_case.case_id,
            v_case.case_ref,
            v_case.status,
            v_case.priority,
            v_case.assigned_to_user_id,
            v_case.version,
            v_receipt.response_status,
            true AS replayed;
        RETURN;
    END IF;

    v_operation_id := gen_random_uuid();
    v_now := clock_timestamp();
    v_now_iso := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

    IF p_command_type = 'create' THEN
        IF p_expected_version IS NOT NULL THEN
            RAISE EXCEPTION 'expected_version must not be provided for create command' USING ERRCODE = '22023';
        END IF;
        IF v_actor.role <> 'analyst' THEN
            RAISE EXCEPTION 'Unauthorized: only active analysts can create cases in this slice' USING ERRCODE = '42501';
        END IF;
        IF p_transaction_id IS NULL THEN
            RAISE EXCEPTION 'transaction_id is required for create' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.transaction WHERE transaction.transaction_id = p_transaction_id) THEN
            RAISE EXCEPTION 'Transaction does not exist' USING ERRCODE = '23503';
        END IF;
        IF EXISTS (SELECT 1 FROM public.investigation_case WHERE investigation_case.transaction_id = p_transaction_id AND investigation_case.status IN ('open', 'in_review', 'escalated')) THEN
            RAISE EXCEPTION 'An active case already exists for this transaction' USING ERRCODE = '23505';
        END IF;
        IF p_priority IS NULL OR p_priority NOT IN ('low', 'medium', 'high') THEN
            RAISE EXCEPTION 'Invalid priority' USING ERRCODE = '22023';
        END IF;
        IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR length(p_reason) NOT BETWEEN 1 AND 2000 THEN
            RAISE EXCEPTION 'Invalid creation reason' USING ERRCODE = '22023';
        END IF;

        v_case_id := coalesce(p_case_id, gen_random_uuid());
        IF p_case_ref IS NOT NULL AND length(btrim(p_case_ref)) BETWEEN 1 AND 64 THEN
            v_case_ref := btrim(p_case_ref);
        ELSE
            v_case_ref := 'CASE-' || upper(substr(replace(v_case_id::text, '-', ''), 1, 8));
        END IF;

        INSERT INTO public.investigation_case (
            case_id, case_ref, transaction_id, assigned_to_user_id, status, priority, opened_at, updated_at, version
        ) VALUES (
            v_case_id, v_case_ref, p_transaction_id, p_actor_user_id, 'open', p_priority, v_now, v_now, 1
        );

        v_created_to_state := jsonb_build_object(
            'case_ref', v_case_ref,
            'transaction_id', p_transaction_id::text,
            'status', 'open',
            'priority', p_priority,
            'assigned_to_user_id', null,
            'opened_at', v_now_iso
        );
        INSERT INTO public.case_event (
            case_id, actor_user_id, event_type, from_state, to_state, reason, metadata, operation_id, event_ordinal, occurred_at
        ) VALUES (
            v_case_id, p_actor_user_id, 'created', NULL, v_created_to_state, p_reason, '{}'::jsonb, v_operation_id, 1, v_now
        );

        v_assigned_from_state := jsonb_build_object('assigned_to_user_id', null);
        v_assigned_to_state := jsonb_build_object('assigned_to_user_id', p_actor_user_id::text);
        INSERT INTO public.case_event (
            case_id, actor_user_id, event_type, from_state, to_state, reason, metadata, operation_id, event_ordinal, occurred_at
        ) VALUES (
            v_case_id, p_actor_user_id, 'assigned', v_assigned_from_state, v_assigned_to_state, NULL, '{}'::jsonb, v_operation_id, 2, v_now
        );

        INSERT INTO public.case_command_receipt (
            operation_id, actor_user_id, idempotency_key, command_type, request_hash, case_id, response_status, completed_at
        ) VALUES (
            v_operation_id, p_actor_user_id, p_idempotency_key, 'create', p_request_hash, v_case_id, 201, v_now
        );

        RETURN QUERY SELECT
            v_operation_id,
            v_case_id,
            v_case_ref,
            'open'::varchar(16),
            p_priority::varchar(8),
            p_actor_user_id,
            1::bigint,
            201,
            false AS replayed;
        RETURN;
    END IF;

    IF p_case_id IS NULL THEN
        RAISE EXCEPTION 'case_id is required' USING ERRCODE = '22023';
    END IF;
    IF p_expected_version IS NULL THEN
        RAISE EXCEPTION 'expected_version is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_case FROM public.investigation_case WHERE investigation_case.case_id = p_case_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Case not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_case.version <> p_expected_version THEN
        RAISE EXCEPTION 'Version conflict: expected version %, found %', p_expected_version, v_case.version USING ERRCODE = 'P0409';
    END IF;

    IF p_command_type = 'start_review' THEN
        IF v_case.status <> 'open' THEN
            RAISE EXCEPTION 'Invalid transition: case is not open' USING ERRCODE = '22023';
        END IF;
        IF v_case.assigned_to_user_id IS NULL THEN
            RAISE EXCEPTION 'Case must be assigned to an active analyst to start review' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_assignee FROM public.app_user WHERE app_user.user_id = v_case.assigned_to_user_id;
        IF NOT FOUND OR NOT v_assignee.is_active OR v_assignee.role <> 'analyst' THEN
            RAISE EXCEPTION 'Case must be assigned to an active analyst to start review' USING ERRCODE = '22023';
        END IF;
        IF v_actor.role = 'analyst' AND (v_case.assigned_to_user_id IS DISTINCT FROM p_actor_user_id) THEN
            RAISE EXCEPTION 'Unauthorized: analyst can only start review on owned cases' USING ERRCODE = '42501';
        END IF;

        UPDATE public.investigation_case
        SET status = 'in_review', version = investigation_case.version + 1, updated_at = v_now
        WHERE investigation_case.case_id = p_case_id;

        INSERT INTO public.case_event (
            case_id, actor_user_id, event_type, from_state, to_state, reason, metadata, operation_id, event_ordinal, occurred_at
        ) VALUES (
            p_case_id, p_actor_user_id, 'status_change',
            jsonb_build_object('status', 'open'),
            jsonb_build_object('status', 'in_review'),
            NULL, '{}'::jsonb, v_operation_id, 1, v_now
        );

        INSERT INTO public.case_command_receipt (
            operation_id, actor_user_id, idempotency_key, command_type, request_hash, case_id, response_status, completed_at
        ) VALUES (
            v_operation_id, p_actor_user_id, p_idempotency_key, 'start_review', p_request_hash, p_case_id, 200, v_now
        );

        RETURN QUERY SELECT
            v_operation_id,
            p_case_id,
            v_case.case_ref,
            'in_review'::varchar(16),
            v_case.priority,
            v_case.assigned_to_user_id,
            (v_case.version + 1)::bigint,
            200,
            false AS replayed;
        RETURN;

    ELSIF p_command_type = 'escalate' THEN
        IF v_case.status <> 'in_review' THEN
            RAISE EXCEPTION 'Invalid transition: case is not in_review' USING ERRCODE = '22023';
        END IF;
        IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR length(p_reason) NOT BETWEEN 1 AND 2000 THEN
            RAISE EXCEPTION 'Invalid escalation reason' USING ERRCODE = '22023';
        END IF;
        IF v_actor.role = 'analyst' AND (v_case.assigned_to_user_id IS DISTINCT FROM p_actor_user_id) THEN
            RAISE EXCEPTION 'Unauthorized: analyst can only escalate owned cases' USING ERRCODE = '42501';
        END IF;

        UPDATE public.investigation_case
        SET status = 'escalated', version = investigation_case.version + 1, updated_at = v_now
        WHERE investigation_case.case_id = p_case_id;

        INSERT INTO public.case_event (
            case_id, actor_user_id, event_type, from_state, to_state, reason, metadata, operation_id, event_ordinal, occurred_at
        ) VALUES (
            p_case_id, p_actor_user_id, 'status_change',
            jsonb_build_object('status', 'in_review'),
            jsonb_build_object('status', 'escalated'),
            p_reason, '{}'::jsonb, v_operation_id, 1, v_now
        );

        INSERT INTO public.case_command_receipt (
            operation_id, actor_user_id, idempotency_key, command_type, request_hash, case_id, response_status, completed_at
        ) VALUES (
            v_operation_id, p_actor_user_id, p_idempotency_key, 'escalate', p_request_hash, p_case_id, 200, v_now
        );

        RETURN QUERY SELECT
            v_operation_id,
            p_case_id,
            v_case.case_ref,
            'escalated'::varchar(16),
            v_case.priority,
            v_case.assigned_to_user_id,
            (v_case.version + 1)::bigint,
            200,
            false AS replayed;
        RETURN;

    ELSIF p_command_type = 'return_to_review' THEN
        IF v_actor.role <> 'admin' THEN
            RAISE EXCEPTION 'Unauthorized: only admin can return case to review' USING ERRCODE = '42501';
        END IF;
        IF v_case.status <> 'escalated' THEN
            RAISE EXCEPTION 'Invalid transition: case is not escalated' USING ERRCODE = '22023';
        END IF;
        IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR length(p_reason) NOT BETWEEN 1 AND 2000 THEN
            RAISE EXCEPTION 'Invalid return reason' USING ERRCODE = '22023';
        END IF;
        IF v_case.assigned_to_user_id IS NULL THEN
            RAISE EXCEPTION 'Case must have an active analyst assignee to return to review' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_assignee FROM public.app_user WHERE app_user.user_id = v_case.assigned_to_user_id;
        IF NOT FOUND OR NOT v_assignee.is_active OR v_assignee.role <> 'analyst' THEN
            RAISE EXCEPTION 'Case must have an active analyst assignee to return to review' USING ERRCODE = '22023';
        END IF;

        UPDATE public.investigation_case
        SET status = 'in_review', version = investigation_case.version + 1, updated_at = v_now
        WHERE investigation_case.case_id = p_case_id;

        INSERT INTO public.case_event (
            case_id, actor_user_id, event_type, from_state, to_state, reason, metadata, operation_id, event_ordinal, occurred_at
        ) VALUES (
            p_case_id, p_actor_user_id, 'status_change',
            jsonb_build_object('status', 'escalated'),
            jsonb_build_object('status', 'in_review'),
            p_reason, '{}'::jsonb, v_operation_id, 1, v_now
        );

        INSERT INTO public.case_command_receipt (
            operation_id, actor_user_id, idempotency_key, command_type, request_hash, case_id, response_status, completed_at
        ) VALUES (
            v_operation_id, p_actor_user_id, p_idempotency_key, 'return_to_review', p_request_hash, p_case_id, 200, v_now
        );

        RETURN QUERY SELECT
            v_operation_id,
            p_case_id,
            v_case.case_ref,
            'in_review'::varchar(16),
            v_case.priority,
            v_case.assigned_to_user_id,
            (v_case.version + 1)::bigint,
            200,
            false AS replayed;
        RETURN;

    ELSIF p_command_type IN ('resolve', 'dismiss') THEN
        IF p_command_type = 'resolve' THEN
            IF p_resolution_code IS DISTINCT FROM 'confirmed_suspicious' THEN
                RAISE EXCEPTION 'Resolve requires resolution_code confirmed_suspicious' USING ERRCODE = '22023';
            END IF;
            v_target_status := 'closed';
        ELSE
            IF p_resolution_code NOT IN ('false_positive', 'insufficient_evidence') THEN
                RAISE EXCEPTION 'Dismiss requires resolution_code false_positive or insufficient_evidence' USING ERRCODE = '22023';
            END IF;
            v_target_status := 'dismissed';
        END IF;

        IF p_resolution_notes IS NULL OR p_resolution_notes <> btrim(p_resolution_notes) OR length(p_resolution_notes) NOT BETWEEN 1 AND 5000 THEN
            RAISE EXCEPTION 'Invalid resolution notes' USING ERRCODE = '22023';
        END IF;

        IF v_actor.role = 'analyst' THEN
            IF v_case.status <> 'in_review' OR v_case.assigned_to_user_id IS DISTINCT FROM p_actor_user_id THEN
                RAISE EXCEPTION 'Unauthorized: analyst can only resolve or dismiss owned in_review cases' USING ERRCODE = '42501';
            END IF;
        ELSIF v_actor.role = 'admin' THEN
            IF v_case.status NOT IN ('in_review', 'escalated') THEN
                RAISE EXCEPTION 'Invalid transition: admin can only resolve or dismiss in_review or escalated cases' USING ERRCODE = '22023';
            END IF;
        END IF;

        v_closed_at_iso := to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

        UPDATE public.investigation_case
        SET status = v_target_status,
            resolution_code = p_resolution_code,
            resolution_notes = p_resolution_notes,
            closed_at = v_now,
            version = investigation_case.version + 1,
            updated_at = v_now
        WHERE investigation_case.case_id = p_case_id;

        INSERT INTO public.case_event (
            case_id, actor_user_id, event_type, from_state, to_state, reason, metadata, operation_id, event_ordinal, occurred_at
        ) VALUES (
            p_case_id, p_actor_user_id, 'status_change',
            jsonb_build_object('closed_at', null, 'resolution_code', null, 'status', v_case.status),
            jsonb_build_object('closed_at', v_closed_at_iso, 'resolution_code', p_resolution_code, 'status', v_target_status),
            p_resolution_notes, '{}'::jsonb, v_operation_id, 1, v_now
        );

        INSERT INTO public.case_command_receipt (
            operation_id, actor_user_id, idempotency_key, command_type, request_hash, case_id, response_status, completed_at
        ) VALUES (
            v_operation_id, p_actor_user_id, p_idempotency_key, p_command_type, p_request_hash, p_case_id, 200, v_now
        );

        RETURN QUERY SELECT
            v_operation_id,
            p_case_id,
            v_case.case_ref,
            v_target_status,
            v_case.priority,
            v_case.assigned_to_user_id,
            (v_case.version + 1)::bigint,
            200,
            false AS replayed;
        RETURN;

    ELSIF p_command_type = 'reopen' THEN
        IF v_actor.role <> 'admin' THEN
            RAISE EXCEPTION 'Unauthorized: only admin can reopen a terminal case' USING ERRCODE = '42501';
        END IF;
        IF v_case.status NOT IN ('closed', 'dismissed') THEN
            RAISE EXCEPTION 'Invalid transition: case is not terminal' USING ERRCODE = '22023';
        END IF;
        IF p_reason IS NULL OR p_reason <> btrim(p_reason) OR length(p_reason) NOT BETWEEN 1 AND 2000 THEN
            RAISE EXCEPTION 'Invalid reopening reason' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (SELECT 1 FROM public.investigation_case WHERE investigation_case.transaction_id = v_case.transaction_id AND investigation_case.status IN ('open', 'in_review', 'escalated') AND investigation_case.case_id <> v_case.case_id) THEN
            RAISE EXCEPTION 'Cannot reopen: another active case exists for this transaction' USING ERRCODE = '23505';
        END IF;

        v_new_assigned_user_id := v_case.assigned_to_user_id;
        IF v_case.assigned_to_user_id IS NOT NULL THEN
            SELECT * INTO v_assignee FROM public.app_user WHERE app_user.user_id = v_case.assigned_to_user_id;
            IF NOT FOUND OR NOT v_assignee.is_active OR v_assignee.role <> 'analyst' THEN
                v_new_assigned_user_id := NULL;
                v_reassign_needed := true;
            END IF;
        END IF;

        v_old_closed_at_iso := to_char(v_case.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

        UPDATE public.investigation_case
        SET status = 'open',
            resolution_code = NULL,
            resolution_notes = NULL,
            closed_at = NULL,
            due_at = NULL,
            assigned_to_user_id = v_new_assigned_user_id,
            version = investigation_case.version + 1,
            updated_at = v_now
        WHERE investigation_case.case_id = p_case_id;

        INSERT INTO public.case_event (
            case_id, actor_user_id, event_type, from_state, to_state, reason, metadata, operation_id, event_ordinal, occurred_at
        ) VALUES (
            p_case_id, p_actor_user_id, 'status_change',
            jsonb_build_object('closed_at', v_old_closed_at_iso, 'due_at', null, 'resolution_code', v_case.resolution_code, 'status', v_case.status),
            jsonb_build_object('closed_at', null, 'due_at', null, 'resolution_code', null, 'status', 'open'),
            p_reason, '{}'::jsonb, v_operation_id, 1, v_now
        );

        IF v_reassign_needed THEN
            INSERT INTO public.case_event (
                case_id, actor_user_id, event_type, from_state, to_state, reason, metadata, operation_id, event_ordinal, occurred_at
            ) VALUES (
                p_case_id, p_actor_user_id, 'assigned',
                jsonb_build_object('assigned_to_user_id', v_case.assigned_to_user_id::text),
                jsonb_build_object('assigned_to_user_id', null),
                NULL, '{}'::jsonb, v_operation_id, 2, v_now
            );
        END IF;

        INSERT INTO public.case_command_receipt (
            operation_id, actor_user_id, idempotency_key, command_type, request_hash, case_id, response_status, completed_at
        ) VALUES (
            v_operation_id, p_actor_user_id, p_idempotency_key, 'reopen', p_request_hash, p_case_id, 200, v_now
        );

        RETURN QUERY SELECT
            v_operation_id,
            p_case_id,
            v_case.case_ref,
            'open'::varchar(16),
            v_case.priority,
            v_new_assigned_user_id,
            (v_case.version + 1)::bigint,
            200,
            false AS replayed;
        RETURN;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_case_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_case_receipt_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_case_command(text, uuid, uuid, text, bigint, uuid, uuid, text, text, text, text, text) FROM PUBLIC;

CREATE PROCEDURE public.grant_runtime_privileges(target_role regrole)
LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE format('GRANT SELECT ON TABLE public.customer, public.address, public.account,
        public.payment_method, public.merchant, public.device_fingerprint,
        public.transaction, public.risk_rule, public.risk_signal,
        public.fraud_scenario, public.transaction_label, public.app_user,
        public.app_session, public.investigation_case, public.case_event,
        public.case_command_receipt TO %s', target_role);
    EXECUTE format('GRANT SELECT ON public.v_transaction_risk TO %s', target_role);
    EXECUTE format('GRANT INSERT, UPDATE ON TABLE public.app_session TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.execute_case_command(text, uuid, uuid, text, bigint, uuid, uuid, text, text, text, text, text) TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.risk_band(numeric), public.score_transaction(uuid) TO %s', target_role);
END;
$$;
REVOKE ALL ON PROCEDURE public.grant_runtime_privileges(regrole) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_runtime') THEN
        CALL public.grant_runtime_privileges('finsight_runtime'::regrole);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_app') THEN
        CALL public.grant_runtime_privileges('finsight_app'::regrole);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finsight_test') THEN
        CALL public.grant_runtime_privileges('finsight_test'::regrole);
    END IF;
END;
$$;
