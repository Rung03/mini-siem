ALTER TABLE events
  ADD COLUMN source            text,
  ADD COLUMN vendor            text,
  ADD COLUMN product           text,
  ADD COLUMN event_type        text,
  ADD COLUMN event_subtype     text,
  ADD COLUMN action            text,
  ADD COLUMN src_port          integer,
  ADD COLUMN dst_ip            inet,
  ADD COLUMN dst_port          integer,
  ADD COLUMN protocol          text,
  ADD COLUMN process           text,
  ADD COLUMN url               text,
  ADD COLUMN http_method       text,
  ADD COLUMN status_code       integer,
  ADD COLUMN rule_name         text,
  ADD COLUMN rule_id           text,
  ADD COLUMN cloud_account_id  text,
  ADD COLUMN cloud_region      text,
  ADD COLUMN cloud_service     text,
  ADD COLUMN tags              text[];

UPDATE events
SET severity = LEAST(10, GREATEST(0, severity * 2))
WHERE severity IS NOT NULL AND severity <= 5;

ALTER TABLE events
  ADD CONSTRAINT events_severity_range CHECK (severity IS NULL OR severity BETWEEN 0 AND 10);

CREATE INDEX events_tenant_event_type_idx ON events (tenant_id, event_type, ts DESC);
CREATE INDEX events_tenant_source_idx     ON events (tenant_id, source, ts DESC);
CREATE INDEX events_tenant_action_idx     ON events (tenant_id, action, ts DESC);
CREATE INDEX events_tenant_dst_ip_idx     ON events (tenant_id, dst_ip, ts DESC)
  WHERE dst_ip IS NOT NULL;
CREATE INDEX events_tags_idx              ON events USING gin (tags)
  WHERE tags IS NOT NULL;
