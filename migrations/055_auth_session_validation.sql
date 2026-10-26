CREATE FUNCTION public.validate_app_session(p_session_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS TABLE (
    session_id uuid, user_id uuid, created_at text, last_seen_at text,
    idle_expires_at text, absolute_expires_at text, revoked_at timestamptz,
    is_idle_expired boolean, is_absolute_expired boolean, email text,
    display_name text, role text, is_active boolean, refreshed_id uuid
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
WITH locked AS MATERIALIZED (
       SELECT s.*, u.email, u.display_name, u.role, u.is_active
       FROM public.app_session s JOIN public.app_user u ON s.user_id=u.user_id
       WHERE s.session_id=p_session_id AND (p_user_id::uuid IS NULL OR s.user_id=p_user_id)
       FOR UPDATE OF s FOR SHARE OF u
     ), checked AS MATERIALIZED (
       SELECT locked.*, clock_timestamp() AS checked_at FROM locked
     ), refreshed AS (
       UPDATE public.app_session s
       SET last_seen_at=c.checked_at,
           idle_expires_at=LEAST(c.checked_at+interval '30 minutes',s.absolute_expires_at)
       FROM checked c
       WHERE s.session_id=c.session_id AND c.revoked_at IS NULL
         AND c.checked_at<c.idle_expires_at AND c.checked_at<c.absolute_expires_at
         AND c.is_active AND c.role IN ('analyst','admin')
       RETURNING s.session_id,s.idle_expires_at,s.absolute_expires_at
     ) SELECT
       s.session_id, s.user_id,
       to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
       to_char(s.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_seen_at,
       to_char(coalesce(r.idle_expires_at,s.idle_expires_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS idle_expires_at,
       to_char(s.absolute_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS absolute_expires_at,
       s.revoked_at,
       (s.checked_at >= s.idle_expires_at) AS is_idle_expired,
       (s.checked_at >= s.absolute_expires_at) AS is_absolute_expired,
       s.email,s.display_name,s.role,s.is_active,r.session_id AS refreshed_id
     FROM checked s LEFT JOIN refreshed r ON r.session_id=s.session_id;
$$;
REVOKE ALL ON FUNCTION public.validate_app_session(uuid, uuid) FROM PUBLIC;

CREATE PROCEDURE public.grant_auth_privileges(target_role regrole)
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %s', target_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.validate_app_session(uuid, uuid) TO %s', target_role);
END;
$$;
REVOKE ALL ON PROCEDURE public.grant_auth_privileges(regrole) FROM PUBLIC;

DO $$
DECLARE target text;
BEGIN
    FOREACH target IN ARRAY ARRAY['finsight_runtime', 'finsight_app', 'finsight_test'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=target) THEN
            CALL public.grant_auth_privileges(target::regrole);
        END IF;
    END LOOP;
END;
$$;
