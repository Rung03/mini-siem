-- สิทธิ์ของ role และ Row Level Security: แยกข้อมูล tenant และห้ามลบ log

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO siem_app, siem_admin, siem_evaluator;

CREATE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION app_tenant_id() TO siem_app, siem_admin, siem_evaluator;

GRANT SELECT                 ON tenants      TO siem_app;
GRANT SELECT, INSERT, UPDATE ON tenants      TO siem_admin;

GRANT SELECT, INSERT, UPDATE ON users        TO siem_admin;

GRANT SELECT                         ON collectors TO siem_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON collectors TO siem_admin;

GRANT SELECT, INSERT ON events TO siem_app;
GRANT SELECT         ON events TO siem_admin;
GRANT SELECT         ON events TO siem_evaluator;

GRANT SELECT                         ON alert_rules TO siem_app;
GRANT SELECT                         ON alert_rules TO siem_evaluator;
GRANT SELECT, INSERT, UPDATE, DELETE ON alert_rules TO siem_admin;

GRANT SELECT, UPDATE         ON alerts TO siem_app;
GRANT SELECT, UPDATE         ON alerts TO siem_admin;
GRANT SELECT, INSERT, UPDATE ON alerts TO siem_evaluator;

GRANT INSERT         ON audit_log TO siem_app;
GRANT INSERT, SELECT ON audit_log TO siem_admin;

GRANT INSERT ON ingest_drops TO siem_app;
GRANT SELECT ON ingest_drops TO siem_admin;

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

CREATE POLICY tenants_app_read ON tenants FOR SELECT TO siem_app
  USING (id = app_tenant_id());
CREATE POLICY tenants_admin_all ON tenants FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);
CREATE POLICY tenants_owner_read ON tenants FOR SELECT TO siem_owner
  USING (true);

CREATE POLICY users_admin_all ON users FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);
CREATE POLICY users_owner_read ON users FOR SELECT TO siem_owner
  USING (true);

CREATE POLICY collectors_app_read ON collectors FOR SELECT TO siem_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY collectors_admin_all ON collectors FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);
CREATE POLICY collectors_owner_read ON collectors FOR SELECT TO siem_owner
  USING (true);

CREATE POLICY events_app_read ON events FOR SELECT TO siem_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY events_app_write ON events FOR INSERT TO siem_app
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY events_admin_read ON events FOR SELECT TO siem_admin
  USING (true);
CREATE POLICY events_evaluator_read ON events FOR SELECT TO siem_evaluator
  USING (true);

CREATE POLICY alert_rules_app_read ON alert_rules FOR SELECT TO siem_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY alert_rules_evaluator_read ON alert_rules FOR SELECT TO siem_evaluator
  USING (true);
CREATE POLICY alert_rules_admin_all ON alert_rules FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);

CREATE POLICY alerts_app_read ON alerts FOR SELECT TO siem_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY alerts_app_ack ON alerts FOR UPDATE TO siem_app
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY alerts_admin_all ON alerts FOR ALL TO siem_admin
  USING (true) WITH CHECK (true);
CREATE POLICY alerts_evaluator_all ON alerts FOR ALL TO siem_evaluator
  USING (true) WITH CHECK (true);

CREATE POLICY audit_app_write ON audit_log FOR INSERT TO siem_app
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY audit_admin_read ON audit_log FOR SELECT TO siem_admin
  USING (true);
CREATE POLICY audit_admin_write ON audit_log FOR INSERT TO siem_admin
  WITH CHECK (true);

CREATE POLICY drops_app_write ON ingest_drops FOR INSERT TO siem_app
  WITH CHECK (true);
CREATE POLICY drops_admin_read ON ingest_drops FOR SELECT TO siem_admin
  USING (true);
