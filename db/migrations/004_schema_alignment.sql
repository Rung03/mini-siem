-- 004_schema_alignment.sql
--
-- Brings the events table in line with the central schema in section 3 of the
-- assignment. Additive only: every column below is nullable, so existing rows
-- and the earlier migrations stay valid.
--
-- One field from that list is deliberately absent: `tenant`. The samples carry
-- it inside the payload, but a sender that can name its own tenant can name
-- somebody else's. Section 2.2 asks for the tenant to arrive as a parameter,
-- header or claim, so it comes from the authenticated collector instead and a
-- tenant found in a payload is kept in attrs as a claim, never as routing.

ALTER TABLE events
  -- Taxonomy from section 3: firewall|crowdstrike|aws|m365|ad|api|network.
  -- source_type (the parser that read it) stays as well: one says which
  -- product produced the line, the other which family it belongs to.
  ADD COLUMN source            text,
  ADD COLUMN vendor            text,
  ADD COLUMN product           text,
  ADD COLUMN event_type        text,
  ADD COLUMN event_subtype     text,
  -- allow|deny|create|delete|login|logout|alert
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

-- Section 3 specifies severity on a 0-10 scale. Earlier rows used a 1-5 scale,
-- so rescale them before the constraint goes on, or the check would fail on
-- data that was correct under the old rules.
UPDATE events
SET severity = LEAST(10, GREATEST(0, severity * 2))
WHERE severity IS NOT NULL AND severity <= 5;

ALTER TABLE events
  ADD CONSTRAINT events_severity_range CHECK (severity IS NULL OR severity BETWEEN 0 AND 10);

-- Indexes for the fields the dashboard and search actually filter on.
-- Created on the parent, so every existing and future partition inherits them.
CREATE INDEX events_tenant_event_type_idx ON events (tenant_id, event_type, ts DESC);
CREATE INDEX events_tenant_source_idx     ON events (tenant_id, source, ts DESC);
CREATE INDEX events_tenant_action_idx     ON events (tenant_id, action, ts DESC);
CREATE INDEX events_tenant_dst_ip_idx     ON events (tenant_id, dst_ip, ts DESC)
  WHERE dst_ip IS NOT NULL;
CREATE INDEX events_tags_idx              ON events USING gin (tags)
  WHERE tags IS NOT NULL;
