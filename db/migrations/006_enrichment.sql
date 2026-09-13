-- คอลัมน์ enrichment: hostname, ประเทศ, เมือง, ASN

ALTER TABLE events
  ADD COLUMN src_hostname     text,
  ADD COLUMN geo_country_iso  text,
  ADD COLUMN geo_country      text,
  ADD COLUMN geo_city         text,
  ADD COLUMN geo_lat          double precision,
  ADD COLUMN geo_lon          double precision,
  ADD COLUMN asn              integer,
  ADD COLUMN as_org           text;

CREATE INDEX events_tenant_country_idx ON events (tenant_id, geo_country_iso, ts DESC)
  WHERE geo_country_iso IS NOT NULL;
