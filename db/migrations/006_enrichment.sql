-- 006_enrichment.sql
--
-- Columns filled in by the ingest-time enrichment stage (section 2.3
-- nice-to-have): where the source address is in the world, and what it
-- resolves to.
--
-- Additive and nullable throughout. Enrichment is decoration — every one of
-- these staying NULL is a valid outcome, and is exactly what happens on an
-- appliance with no GeoIP database installed.
--
-- Only src_ip is enriched. Enriching dst_ip too would double the column count
-- for little gain: the login story and every Top-N view key on source address.

ALTER TABLE events
  -- reverse DNS of src_ip
  ADD COLUMN src_hostname     text,
  -- GeoIP, from a local DB-IP Lite database
  ADD COLUMN geo_country_iso  text,
  ADD COLUMN geo_country      text,
  ADD COLUMN geo_city         text,
  ADD COLUMN geo_lat          double precision,
  ADD COLUMN geo_lon          double precision,
  -- Only populated when the optional ASN database is present
  ADD COLUMN asn              integer,
  ADD COLUMN as_org           text;

-- The country is the only enriched field worth indexing: it is the one the
-- dashboard groups by. The rest are display-only, and every index is paid for
-- again on the ingest hot path.
CREATE INDEX events_tenant_country_idx ON events (tenant_id, geo_country_iso, ts DESC)
  WHERE geo_country_iso IS NOT NULL;
