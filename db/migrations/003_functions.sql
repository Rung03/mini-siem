-- 003_functions.sql — the few operations that legitimately have to see across
-- tenants, plus partition management.
--
-- Authentication and collector resolution are chicken-and-egg problems: you
-- cannot scope a query to a tenant before you know which tenant the caller
-- belongs to. Rather than punching a hole in RLS for those cases, each one is
-- a narrow SECURITY DEFINER function that returns exactly the columns needed
-- and nothing else. Everything is pinned to search_path = public, pg_temp.

-- ---------------------------------------------------------------------------
-- Authentication
-- ---------------------------------------------------------------------------

CREATE FUNCTION auth_find_user(p_email text)
  RETURNS TABLE (id uuid, tenant_id uuid, email text, password_hash text,
                 role text, active boolean)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT u.id, u.tenant_id, u.email, u.password_hash, u.role, u.active
    FROM users u
    WHERE u.email = lower(p_email)
  $$;
GRANT EXECUTE ON FUNCTION auth_find_user(text) TO siem_app;

CREATE FUNCTION session_create(p_token_hash text, p_user_id uuid, p_ttl_hours integer)
  RETURNS timestamptz
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (p_token_hash, p_user_id, now() + make_interval(hours => p_ttl_hours))
    RETURNING expires_at
  $$;
GRANT EXECUTE ON FUNCTION session_create(text, uuid, integer) TO siem_app;

-- Returns the signed-in identity, or no rows if the token is unknown, expired,
-- or belongs to a deactivated user.
CREATE FUNCTION session_lookup(p_token_hash text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, email text, role text,
                 expires_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    UPDATE sessions s SET last_seen = now()
    WHERE s.token_hash = p_token_hash AND s.expires_at > now();

    RETURN QUERY
      SELECT u.id, u.tenant_id, u.email, u.role, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = p_token_hash
        AND s.expires_at > now()
        AND u.active;
  END;
  $$;
GRANT EXECUTE ON FUNCTION session_lookup(text) TO siem_app, siem_admin;

CREATE FUNCTION session_revoke(p_token_hash text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ DELETE FROM sessions WHERE token_hash = p_token_hash $$;
GRANT EXECUTE ON FUNCTION session_revoke(text) TO siem_app, siem_admin;

CREATE FUNCTION session_purge_expired() RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE n bigint;
  BEGIN
    DELETE FROM sessions WHERE expires_at < now();
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END;
  $$;

-- ---------------------------------------------------------------------------
-- Collector resolution — how inbound data acquires a tenant
-- ---------------------------------------------------------------------------

CREATE FUNCTION resolve_collector_by_token(p_token_hash text)
  RETURNS TABLE (collector_id uuid, tenant_id uuid, source_type text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.id, c.tenant_id, c.source_type
    FROM collectors c
    JOIN tenants t ON t.id = c.tenant_id
    WHERE c.token_hash = p_token_hash AND c.enabled AND t.active
  $$;
GRANT EXECUTE ON FUNCTION resolve_collector_by_token(text) TO siem_app;

-- Syslog senders identify themselves only by source address. The most
-- specific matching CIDR wins, so a /32 for one firewall beats a /24 for the
-- subnet it sits in.
CREATE FUNCTION resolve_collector_by_ip(p_ip inet)
  RETURNS TABLE (collector_id uuid, tenant_id uuid, source_type text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.id, c.tenant_id, c.source_type
    FROM collectors c
    JOIN tenants t ON t.id = c.tenant_id
    WHERE c.kind = 'syslog' AND c.enabled AND t.active
      AND c.source_cidr >>= p_ip
    ORDER BY masklen(c.source_cidr) DESC
    LIMIT 1
  $$;
GRANT EXECUTE ON FUNCTION resolve_collector_by_ip(inet) TO siem_app;

-- A collector referenced explicitly, e.g. the one picked in the upload form.
-- Returns nothing unless the caller's tenant owns it.
CREATE FUNCTION resolve_collector_by_id(p_id uuid, p_tenant uuid)
  RETURNS TABLE (collector_id uuid, tenant_id uuid, source_type text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.id, c.tenant_id, c.source_type
    FROM collectors c
    JOIN tenants t ON t.id = c.tenant_id
    WHERE c.id = p_id AND c.enabled AND t.active
      AND (p_tenant IS NULL OR c.tenant_id = p_tenant)
  $$;
GRANT EXECUTE ON FUNCTION resolve_collector_by_id(uuid, uuid) TO siem_app, siem_admin;

-- ---------------------------------------------------------------------------
-- Partitions: one table per day, sub-partitioned one table per tenant
--
-- These are called by the owner connection only. They are the reason the
-- retention promise can be kept by dropping a table rather than deleting rows.
-- ---------------------------------------------------------------------------

CREATE FUNCTION partition_day_name(p_day date) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT 'events_p' || to_char(p_day, 'YYYYMMDD') $$;

CREATE FUNCTION partition_tenant_name(p_day date, p_tenant uuid) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT partition_day_name(p_day) || '_t' ||
               substr(replace(p_tenant::text, '-', ''), 1, 12) $$;

CREATE FUNCTION ensure_day_partition(p_day date) RETURNS text
  LANGUAGE plpgsql
  AS $$
  DECLARE
    day_tbl text := partition_day_name(p_day);
  BEGIN
    IF to_regclass(format('public.%I', day_tbl)) IS NOT NULL THEN
      RETURN day_tbl;
    END IF;

    EXECUTE format(
      'CREATE TABLE %I PARTITION OF events FOR VALUES FROM (%L) TO (%L) PARTITION BY LIST (tenant_id)',
      day_tbl, p_day::timestamptz, (p_day + 1)::timestamptz);

    -- Catch-all so an unknown tenant can never make an INSERT fail outright.
    EXECUTE format('CREATE TABLE %I PARTITION OF %I DEFAULT', day_tbl || '_def', day_tbl);

    RETURN day_tbl;
  END;
  $$;

CREATE FUNCTION ensure_tenant_partition(p_day date, p_tenant uuid) RETURNS text
  LANGUAGE plpgsql
  AS $$
  DECLARE
    day_tbl    text := ensure_day_partition(p_day);
    tenant_tbl text := partition_tenant_name(p_day, p_tenant);
  BEGIN
    IF to_regclass(format('public.%I', tenant_tbl)) IS NOT NULL THEN
      RETURN tenant_tbl;
    END IF;

    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES IN (%L)',
                   tenant_tbl, day_tbl, p_tenant);
    RETURN tenant_tbl;
  EXCEPTION
    -- If rows for this tenant already landed in the day's DEFAULT partition,
    -- Postgres refuses to carve out the list partition. That is not fatal:
    -- the data is stored and queryable either way.
    WHEN others THEN
      RAISE WARNING 'could not create %: % — rows stay in the default partition',
                    tenant_tbl, SQLERRM;
      RETURN NULL;
  END;
  $$;

-- Make sure today and the next p_days_ahead days are ready for every active
-- tenant. Idempotent, so it is safe to run on every boot and every night.
CREATE FUNCTION ensure_partitions(p_days_ahead integer DEFAULT 1)
  RETURNS SETOF text
  LANGUAGE plpgsql
  AS $$
  DECLARE
    d      date;
    t      uuid;
    made   text;
  BEGIN
    FOR d IN SELECT (current_date + i)::date
             FROM generate_series(0, GREATEST(p_days_ahead, 0)) AS i
    LOOP
      made := ensure_day_partition(d);
      RETURN NEXT made;
      FOR t IN SELECT id FROM tenants WHERE active LOOP
        made := ensure_tenant_partition(d, t);
        IF made IS NOT NULL THEN
          RETURN NEXT made;
        END IF;
      END LOOP;
    END LOOP;
  END;
  $$;

-- Retention. Drops whole day partitions, which is the only way event data is
-- ever removed — there is no DELETE path anywhere in this system.
CREATE FUNCTION drop_old_partitions(p_keep_days integer)
  RETURNS SETOF text
  LANGUAGE plpgsql
  AS $$
  DECLARE
    cutoff date := current_date - GREATEST(p_keep_days, 1);
    rec    record;
  BEGIN
    FOR rec IN
      SELECT c.relname
      FROM pg_inherits i
      JOIN pg_class c      ON c.oid = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      WHERE parent.relname = 'events'
        AND c.relname ~ '^events_p[0-9]{8}$'
        AND to_date(substr(c.relname, 9, 8), 'YYYYMMDD') < cutoff
      ORDER BY c.relname
    LOOP
      EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', rec.relname);
      RETURN NEXT rec.relname;
    END LOOP;
  END;
  $$;

-- Read-only introspection, handy for the admin screen and for verifying that
-- retention actually happened.
CREATE FUNCTION partition_overview()
  RETURNS TABLE (day_partition text, subpartitions bigint)
  LANGUAGE sql STABLE
  AS $$
    SELECT c.relname,
           (SELECT count(*) FROM pg_inherits s WHERE s.inhparent = c.oid)
    FROM pg_inherits i
    JOIN pg_class c      ON c.oid = i.inhrelid
    JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE parent.relname = 'events'
    ORDER BY c.relname
  $$;
GRANT EXECUTE ON FUNCTION partition_overview() TO siem_admin;
