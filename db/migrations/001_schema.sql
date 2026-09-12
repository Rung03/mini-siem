CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  email          text NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('admin', 'viewer')),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower CHECK (email = lower(email)),
  CONSTRAINT users_tenant_matches_role CHECK (
    (role = 'admin'  AND tenant_id IS NULL) OR
    (role = 'viewer' AND tenant_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_seen   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE collectors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('http', 'syslog', 'file')),
  source_type   text NOT NULL CHECK (source_type IN
                   ('fortigate','windows_ad','m365','aws_cloudtrail','crowdstrike','generic')),
  token_hash    text,
  source_cidr   cidr,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collectors_http_has_token  CHECK (kind <> 'http'   OR token_hash  IS NOT NULL),
  CONSTRAINT collectors_syslog_has_cidr CHECK (kind <> 'syslog' OR source_cidr IS NOT NULL)
);
CREATE UNIQUE INDEX collectors_token_key ON collectors (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX collectors_cidr_idx ON collectors USING gist (source_cidr inet_ops)
  WHERE source_cidr IS NOT NULL;
CREATE UNIQUE INDEX collectors_tenant_name_key ON collectors (tenant_id, name);

CREATE TABLE events (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  ts              timestamptz NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  source_type     text NOT NULL,
  collector_id    uuid,
  event_category  text,
  event_action    text,
  event_outcome   text CHECK (event_outcome IN ('success', 'failure', 'unknown')),
  user_name       text,
  src_ip          inet,
  host            text,
  severity        smallint,
  message         text,
  raw             text NOT NULL,
  attrs           jsonb NOT NULL DEFAULT '{}'::jsonb,
  parse_ok        boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, ts, id)
) PARTITION BY RANGE (ts);

CREATE INDEX events_tenant_ts_idx      ON events (tenant_id, ts DESC);
CREATE INDEX events_tenant_user_ts_idx ON events (tenant_id, user_name, ts DESC);
CREATE INDEX events_tenant_ip_ts_idx   ON events (tenant_id, src_ip, ts DESC);
CREATE INDEX events_failure_idx        ON events (tenant_id, src_ip, ts DESC)
  WHERE event_outcome = 'failure';

CREATE TABLE alert_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name            text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  match_category  text,
  match_action    text,
  match_outcome   text,
  match_source    text,
  group_by        text NOT NULL DEFAULT 'src_ip'
                    CHECK (group_by IN ('src_ip', 'user_name', 'host')),
  window_seconds  integer NOT NULL CHECK (window_seconds BETWEEN 30 AND 86400),
  threshold       integer NOT NULL CHECK (threshold > 0),
  severity        smallint NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5),
  suppress_seconds integer NOT NULL DEFAULT 900 CHECK (suppress_seconds >= 0),
  webhook_url     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX alert_rules_tenant_name_key ON alert_rules (tenant_id, name);

CREATE TABLE alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  rule_id        uuid NOT NULL REFERENCES alert_rules(id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  first_seen     timestamptz NOT NULL,
  last_seen      timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged')),
  severity       smallint NOT NULL,
  group_by       text NOT NULL,
  group_value    text NOT NULL,
  event_count    integer NOT NULL,
  title          text NOT NULL,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  acked_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  acked_at       timestamptz,
  dedupe_key     text NOT NULL,
  webhook_status text NOT NULL DEFAULT 'pending'
                   CHECK (webhook_status IN ('pending','sent','failed','disabled','none')),
  webhook_error  text,
  webhook_attempts integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX alerts_dedupe_key ON alerts (tenant_id, dedupe_key);
CREATE INDEX alerts_tenant_created_idx ON alerts (tenant_id, created_at DESC);
CREATE INDEX alerts_webhook_pending_idx ON alerts (webhook_status) WHERE webhook_status = 'pending';

CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     uuid,
  actor_email  text,
  actor_role   text,
  tenant_id    uuid,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  src_ip       inet
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_tenant_at_idx ON audit_log (tenant_id, at DESC);

CREATE TABLE ingest_drops (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  channel    text NOT NULL,
  reason     text NOT NULL,
  src_ip     inet,
  sample     text
);
CREATE INDEX ingest_drops_at_idx ON ingest_drops (at DESC);
