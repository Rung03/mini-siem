-- 002_rls.sql — privileges and row level security.
--
-- This file is the whole security story. The README promises that tenant
-- separation is not done in the UI and not done in the API code, but forced by
-- the database itself, and that logs cannot be deleted by anyone. Both of those
-- are implemented here, with GRANT and POLICY, not with application logic.
--
-- Four roles, none of them superuser and none with BYPASSRLS:
--   siem_owner      owns every object; used only for migrations and for the
--                   partition/retention jobs (DROP requires ownership)
--   siem_app        a signed-in Viewer's connection; sees exactly one tenant
--   siem_admin      a signed-in Admin's connection; sees every tenant
--   siem_evaluator  the alert engine; reads events across tenants, writes alerts

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO siem_app, siem_admin, siem_evaluator;

-- Resolves the tenant pinned to the current transaction. Returns NULL when
-- nothing has been pinned, which makes every policy below fail closed: a
-- forgotten set_config means zero rows, never all rows.
CREATE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION app_tenant_id() TO siem_app, siem_admin, siem_evaluator;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Note what is absent: nobody, in any role, is granted UPDATE or DELETE on
-- events or audit_log. An Admin trying to erase a log line gets a permission
-- denied from Postgres, not a polite error from our code.
-- ---------------------------------------------------------------------------

GRANT SELECT                 ON tenants      TO siem_app;
GRANT SELECT, INSERT, UPDATE ON tenants      TO siem_admin;

GRANT SELECT, INSERT, UPDATE ON users        TO siem_admin;

GRANT SELECT                         ON collectors TO siem_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON collectors TO siem_admin;

-- events: insert and read, nothing else, ever. Granted on the parent only —
-- never on a partition — so the app role cannot reach a partition directly to
-- step around the parent's policies. Postgres checks privileges on the parent
-- when access arrives through it, so ordinary queries are unaffected.
GRANT SELECT, INSERT ON events TO siem_app;
GRANT SELECT         ON events TO siem_admin;
GRANT SELECT         ON events TO siem_evaluator;

GRANT SELECT                         ON alert_rules TO siem_app;
GRANT SELECT                         ON alert_rules TO siem_evaluator;
GRANT SELECT, INSERT, UPDATE, DELETE ON alert_rules TO siem_admin;

GRANT SELECT, UPDATE         ON alerts TO siem_app;     -- UPDATE = acknowledge
GRANT SELECT, UPDATE         ON alerts TO siem_admin;
GRANT SELECT, INSERT, UPDATE ON alerts TO siem_evaluator;

-- audit_log: write and read. Never amend, never erase.
GRANT INSERT         ON audit_log TO siem_app;
GRANT INSERT, SELECT ON audit_log TO siem_admin;

GRANT INSERT ON ingest_drops TO siem_app;
GRANT SELECT ON ingest_drops TO siem_admin;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- FORCE matters as much as ENABLE: without it the table owner would quietly
-- bypass its own policies.
-- ---------------------------------------------------------------------------

ALTER TABLE tenants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants      FORCE  ROW LEVEL SECURITY;
ALTER TABLE users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users        FORCE  ROW LEVEL SECURITY;
ALTER TABLE collectors   ENABLE ROW LEVEL SECURITY;
ALTER TABLE collectors   FORCE  ROW LEVEL SECURITY;
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE events       FORCE  ROW LEVEL SECURITY;
ALTER TABLE alert_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules  FORCE  ROW LEVEL SECURITY;
ALTER TABLE alerts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts       FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log    FORCE  ROW LEVEL SECURITY;
ALTER TABLE ingest_drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_drops FORCE  ROW LEVEL SECURITY;

-- tenants ---------------------------------------------------------------
CREATE POLICY tenants_app_read ON tenants FOR SELECT TO siem_app
  USING (id = app_tenant_id());
CREATE POLICY tenants_admin_all ON tenants FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);
-- FORCE applies to the owner as well, which is the point of it — but the
-- partition manager runs as the owner and has to enumerate active tenants to
-- know which sub-partitions to create. This is the one thing it may read, and
-- read is all it gets.
CREATE POLICY tenants_owner_read ON tenants FOR SELECT TO siem_owner
  USING (true);

-- users -----------------------------------------------------------------
-- Only administrators touch this table through a policy at all. A Viewer's
-- own identity reaches the API through session_lookup(), not through here.
CREATE POLICY users_admin_all ON users FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);
-- Needed by auth_find_user() and session_lookup(), which are SECURITY DEFINER
-- and therefore execute as the owner. Since FORCE applies to the owner too,
-- without this every sign-in matches zero rows and nobody can log in.
CREATE POLICY users_owner_read ON users FOR SELECT TO siem_owner
  USING (true);

-- collectors ------------------------------------------------------------
CREATE POLICY collectors_app_read ON collectors FOR SELECT TO siem_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY collectors_admin_all ON collectors FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);
-- Same reason: resolve_collector_by_token/_by_ip/_by_id run as the owner,
-- because inbound data has to be matched to a tenant before any tenant is
-- known. Read only, and only through those three functions.
CREATE POLICY collectors_owner_read ON collectors FOR SELECT TO siem_owner
  USING (true);

-- events ----------------------------------------------------------------
-- The single most important pair of policies in the system.
CREATE POLICY events_app_read ON events FOR SELECT TO siem_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY events_app_write ON events FOR INSERT TO siem_app
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY events_admin_read ON events FOR SELECT TO siem_admin
  USING (true);
CREATE POLICY events_evaluator_read ON events FOR SELECT TO siem_evaluator
  USING (true);

-- alert_rules -----------------------------------------------------------
CREATE POLICY alert_rules_app_read ON alert_rules FOR SELECT TO siem_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY alert_rules_evaluator_read ON alert_rules FOR SELECT TO siem_evaluator
  USING (true);
CREATE POLICY alert_rules_admin_all ON alert_rules FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);

-- alerts ----------------------------------------------------------------
CREATE POLICY alerts_app_read ON alerts FOR SELECT TO siem_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY alerts_app_ack ON alerts FOR UPDATE TO siem_app
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY alerts_admin_all ON alerts FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);
CREATE POLICY alerts_evaluator_all ON alerts FOR ALL TO siem_evaluator
  USING (true) WITH CHECK (true);

-- audit_log -------------------------------------------------------------
-- A Viewer can append (acknowledging an alert is an auditable act) but cannot
-- read the trail back. Only an Admin reads it.
CREATE POLICY audit_app_write ON audit_log FOR INSERT TO siem_app
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY audit_admin_read ON audit_log FOR SELECT TO siem_admin
  USING (true);
CREATE POLICY audit_admin_write ON audit_log FOR INSERT TO siem_admin
  WITH CHECK (true);

-- ingest_drops ----------------------------------------------------------
CREATE POLICY drops_app_write ON ingest_drops FOR INSERT TO siem_app
  WITH CHECK (true);
CREATE POLICY drops_admin_read ON ingest_drops FOR SELECT TO siem_admin
  USING (true);
