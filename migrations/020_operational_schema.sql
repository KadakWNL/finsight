CREATE TABLE public.app_user (
    user_id uuid PRIMARY KEY,
    email varchar(320) NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email <> ''),
    password_hash text,
    display_name varchar(200) NOT NULL CHECK (length(btrim(display_name)) > 0),
    role varchar(16) NOT NULL CHECK (role IN ('analyst', 'admin', 'system')),
    is_active boolean NOT NULL DEFAULT true,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((role = 'system' AND password_hash IS NULL) OR
           (role IN ('analyst', 'admin') AND password_hash IS NOT NULL AND length(btrim(password_hash)) > 0))
);

ALTER TABLE public.customer ADD CONSTRAINT customer_user_fk
    FOREIGN KEY (user_id) REFERENCES public.app_user ON DELETE RESTRICT;

CREATE TABLE public.investigation_case (
    case_id uuid PRIMARY KEY,
    case_ref varchar(64) NOT NULL UNIQUE CHECK (case_ref = btrim(case_ref) AND case_ref <> ''),
    transaction_id uuid NOT NULL REFERENCES public.transaction ON DELETE RESTRICT,
    assigned_to_user_id uuid REFERENCES public.app_user ON DELETE RESTRICT,
    status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'escalated', 'closed', 'dismissed')),
    priority varchar(8) NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    resolution_code varchar(32),
    resolution_notes text,
    opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    due_at timestamptz,
    closed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    CONSTRAINT case_outcome CHECK ((
        (status IN ('open', 'in_review', 'escalated') AND resolution_code IS NULL AND resolution_notes IS NULL AND closed_at IS NULL)
        OR
        (status IN ('closed', 'dismissed') AND resolution_code IS NOT NULL
         AND ((status = 'closed' AND resolution_code = 'confirmed_suspicious')
              OR (status = 'dismissed' AND resolution_code IN ('false_positive', 'insufficient_evidence')))
         AND resolution_notes IS NOT NULL AND resolution_notes = btrim(resolution_notes)
         AND length(resolution_notes) BETWEEN 1 AND 5000 AND closed_at IS NOT NULL)
    ) IS TRUE)
);

CREATE UNIQUE INDEX case_one_active_transaction ON public.investigation_case (transaction_id)
    WHERE status IN ('open', 'in_review', 'escalated');

CREATE TABLE public.app_session (
    session_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.app_user ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_seen_at timestamptz NOT NULL,
    idle_expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revocation_reason varchar(32),
    CHECK (isfinite(created_at) AND isfinite(last_seen_at) AND isfinite(idle_expires_at) AND isfinite(absolute_expires_at)),
    CHECK (created_at <= last_seen_at AND last_seen_at < idle_expires_at AND idle_expires_at <= absolute_expires_at),
    CHECK (absolute_expires_at <= created_at + interval '8 hours'),
    CHECK (idle_expires_at <= last_seen_at + interval '30 minutes'),
    CHECK (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at >= created_at)),
    CHECK ((revoked_at IS NULL AND revocation_reason IS NULL) OR
           (revoked_at IS NOT NULL AND (revocation_reason IS NULL OR revocation_reason IN ('sign_out', 'user_disabled', 'security'))))
);

CREATE TABLE public.case_command_receipt (
    operation_id uuid PRIMARY KEY,
    actor_user_id uuid NOT NULL REFERENCES public.app_user ON DELETE RESTRICT,
    idempotency_key uuid NOT NULL,
    command_type varchar(32) NOT NULL CHECK (command_type IN ('create', 'start_review', 'escalate', 'return_to_review', 'resolve', 'dismiss', 'reopen')),
    request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    case_id uuid NOT NULL REFERENCES public.investigation_case ON DELETE RESTRICT,
    response_status integer NOT NULL CHECK (response_status IN (200, 201)),
    completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (actor_user_id, idempotency_key)
);

CREATE INDEX session_user_lookup ON public.app_session (user_id);
CREATE INDEX session_cleanup_order ON public.app_session
    (LEAST(idle_expires_at, absolute_expires_at, revoked_at), session_id);

CREATE FUNCTION public.valid_case_snapshot(snapshot jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE k text; v jsonb; s text;
BEGIN
    IF snapshot IS NULL OR jsonb_typeof(snapshot) <> 'object' THEN RETURN false; END IF;
    FOR k, v IN SELECT * FROM jsonb_each(snapshot) LOOP
        s := snapshot ->> k;
        IF k IN ('assigned_to_user_id', 'resolution_code', 'closed_at', 'due_at') AND v = 'null'::jsonb THEN CONTINUE; END IF;
        IF jsonb_typeof(v) <> 'string' THEN RETURN false; END IF;
        CASE k
            WHEN 'status' THEN IF s NOT IN ('open', 'in_review', 'escalated', 'closed', 'dismissed') THEN RETURN false; END IF;
            WHEN 'priority' THEN IF s NOT IN ('low', 'medium', 'high') THEN RETURN false; END IF;
            WHEN 'resolution_code' THEN IF s NOT IN ('confirmed_suspicious', 'false_positive', 'insufficient_evidence') THEN RETURN false; END IF;
            WHEN 'assigned_to_user_id', 'transaction_id' THEN
                IF s !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN false; END IF;
            WHEN 'opened_at', 'closed_at', 'due_at' THEN
                IF s !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN RETURN false; END IF;
                IF NOT isfinite(s::timestamptz) THEN RETURN false; END IF;
            WHEN 'case_ref' THEN IF length(s) NOT BETWEEN 1 AND 64 OR s <> btrim(s) THEN RETURN false; END IF;
            ELSE RETURN false;
        END CASE;
    END LOOP;
    RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_time_zone_displacement_value THEN RETURN false;
END;
$$;

CREATE FUNCTION public.valid_case_event(kind text, before_state jsonb, after_state jsonb, rationale text, details jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE old_status text; new_status text; keys text[]; required_keys text[];
BEGIN
    IF details IS DISTINCT FROM '{}'::jsonb OR NOT public.valid_case_snapshot(after_state) THEN RETURN false; END IF;
    IF rationale IS NOT NULL AND (rationale <> btrim(rationale) OR length(rationale) NOT BETWEEN 1 AND 5000) THEN RETURN false; END IF;
    SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(after_state) k;
    IF kind = 'created' THEN
        RETURN (before_state IS NULL AND rationale IS NOT NULL AND length(rationale) <= 2000
            AND after_state ?& ARRAY['status', 'priority', 'assigned_to_user_id', 'case_ref', 'transaction_id', 'opened_at']
            AND after_state - ARRAY['status', 'priority', 'assigned_to_user_id', 'case_ref', 'transaction_id', 'opened_at', 'resolution_code', 'closed_at', 'due_at'] = '{}'::jsonb
            AND after_state ->> 'status' = 'open' AND after_state -> 'assigned_to_user_id' = 'null'::jsonb
            AND (NOT after_state ? 'resolution_code' OR after_state -> 'resolution_code' = 'null'::jsonb)
            AND (NOT after_state ? 'closed_at' OR after_state -> 'closed_at' = 'null'::jsonb)) IS TRUE;
    END IF;
    IF NOT public.valid_case_snapshot(before_state) OR before_state = after_state
       OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(before_state) k) IS DISTINCT FROM keys THEN RETURN false; END IF;
    IF kind = 'assigned' THEN
        RETURN keys = ARRAY['assigned_to_user_id'] AND (rationale IS NULL OR length(rationale) <= 2000);
    END IF;
    IF kind <> 'status_change' THEN RETURN false; END IF;
    old_status := before_state ->> 'status'; new_status := after_state ->> 'status';
    IF old_status = 'open' AND new_status = 'in_review' THEN
        RETURN keys = ARRAY['status'] AND rationale IS NULL;
    ELSIF (old_status = 'in_review' AND new_status = 'escalated') OR (old_status = 'escalated' AND new_status = 'in_review') THEN
        RETURN keys = ARRAY['status'] AND rationale IS NOT NULL AND length(rationale) <= 2000;
    ELSIF old_status IN ('in_review', 'escalated') AND new_status IN ('closed', 'dismissed') THEN
        RETURN (keys = ARRAY['closed_at', 'resolution_code', 'status'] AND rationale IS NOT NULL
            AND before_state -> 'closed_at' = 'null'::jsonb AND before_state -> 'resolution_code' = 'null'::jsonb
            AND jsonb_typeof(after_state -> 'closed_at') = 'string'
            AND ((new_status = 'closed' AND after_state ->> 'resolution_code' = 'confirmed_suspicious')
              OR (new_status = 'dismissed' AND after_state ->> 'resolution_code' IN ('false_positive', 'insufficient_evidence')))) IS TRUE;
    ELSIF old_status IN ('closed', 'dismissed') AND new_status = 'open' THEN
        required_keys := ARRAY['closed_at', 'due_at', 'resolution_code', 'status'];
        RETURN (keys = required_keys AND rationale IS NOT NULL AND length(rationale) <= 2000
            AND jsonb_typeof(before_state -> 'closed_at') = 'string'
            AND ((old_status = 'closed' AND before_state ->> 'resolution_code' = 'confirmed_suspicious')
              OR (old_status = 'dismissed' AND before_state ->> 'resolution_code' IN ('false_positive', 'insufficient_evidence')))
            AND after_state -> 'closed_at' = 'null'::jsonb AND after_state -> 'due_at' = 'null'::jsonb
            AND after_state -> 'resolution_code' = 'null'::jsonb) IS TRUE;
    END IF;
    RETURN false;
END;
$$;

CREATE TABLE public.case_event (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES public.investigation_case ON DELETE RESTRICT,
    actor_user_id uuid NOT NULL REFERENCES public.app_user ON DELETE RESTRICT,
    event_type varchar(32) NOT NULL CHECK (event_type IN ('created', 'assigned', 'status_change')),
    from_state jsonb,
    to_state jsonb NOT NULL,
    reason text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    operation_id uuid NOT NULL,
    event_ordinal integer NOT NULL CHECK (event_ordinal > 0),
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (operation_id, event_ordinal),
    CONSTRAINT case_event_shape CHECK (public.valid_case_event(event_type, from_state, to_state, reason, metadata) IS TRUE)
);

REVOKE ALL ON TABLE public.app_user, public.app_session, public.investigation_case,
    public.case_event, public.case_command_receipt FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.case_event_event_id_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.valid_case_snapshot(jsonb), public.valid_case_event(text, jsonb, jsonb, text, jsonb) FROM PUBLIC;
