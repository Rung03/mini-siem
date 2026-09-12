CREATE TABLE events_backfill PARTITION OF events DEFAULT;

CREATE OR REPLACE FUNCTION purge_backfill_partition(p_keep_days integer)
  RETURNS bigint
  LANGUAGE plpgsql
  AS $$
  DECLARE
    cutoff timestamptz := (current_date - GREATEST(p_keep_days, 1))::timestamptz;
    n      bigint;
  BEGIN
    DELETE FROM events_backfill WHERE ts < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END;
  $$;

CREATE OR REPLACE FUNCTION ensure_day_partition(p_day date) RETURNS text
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

    EXECUTE format('CREATE TABLE %I PARTITION OF %I DEFAULT', day_tbl || '_def', day_tbl);

    RETURN day_tbl;
  EXCEPTION
    WHEN others THEN
      RAISE WARNING 'could not create %: % — rows for that day stay in events_backfill',
                    day_tbl, SQLERRM;
      RETURN NULL;
  END;
  $$;

CREATE OR REPLACE FUNCTION ensure_tenant_partition(p_day date, p_tenant uuid) RETURNS text
  LANGUAGE plpgsql
  AS $$
  DECLARE
    day_tbl    text := ensure_day_partition(p_day);
    tenant_tbl text := partition_tenant_name(p_day, p_tenant);
  BEGIN
    IF day_tbl IS NULL THEN
      RETURN NULL;
    END IF;
    IF to_regclass(format('public.%I', tenant_tbl)) IS NOT NULL THEN
      RETURN tenant_tbl;
    END IF;

    EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES IN (%L)',
                   tenant_tbl, day_tbl, p_tenant);
    RETURN tenant_tbl;
  EXCEPTION
    WHEN others THEN
      RAISE WARNING 'could not create %: % — rows stay in the default partition',
                    tenant_tbl, SQLERRM;
      RETURN NULL;
  END;
  $$;
