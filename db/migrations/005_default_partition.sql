-- 005_default_partition.sql
--
-- A catch-all partition for events whose timestamp falls outside the days that
-- have been pre-created.
--
-- Without this, an INSERT for an unexpected date fails outright with "no
-- partition of relation events found for row" — which is exactly what happens
-- when someone replays a historical export. The assignment's own sample
-- payloads are dated 2025-08-20, so this is the normal case for a batch
-- upload, not an edge case. Losing a log line because of how storage is laid
-- out is not an acceptable failure mode for a system whose job is keeping log
-- lines.

CREATE TABLE events_backfill PARTITION OF events DEFAULT;

-- Retention still has to apply here. Day partitions are removed by dropping
-- the table, but this one is permanent, so expired rows are deleted from it
-- instead. That is done by the owner connection during maintenance; no
-- application role is granted DELETE on events, so an Admin still cannot erase
-- anything (002_rls.sql is unchanged).
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

-- Creating a day partition fails if the default already holds rows for that
-- day. Recreate the function so maintenance reports that instead of aborting:
-- the rows are stored and queryable either way.
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

-- ensure_tenant_partition calls the above and assumes it gets a table name.
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
