import { config } from '../config.js';
import { enrichBatch } from '../enrich/index.js';
import type { Queryable } from '../db/tenant.js';
import { withApp, withUnscopedApp } from '../db/tenant.js';
import type { CanonicalEvent } from '../normalize/schema.js';

/**
 * The only place in this codebase that writes to events.
 *
 * It goes through withApp(tenantId), which means the insert runs as siem_app
 * with the tenant pinned for the transaction. The RLS WITH CHECK clause then
 * verifies every row's tenant_id against that pin — so even if a caller passed
 * the wrong tenant alongside the rows, the database rejects the write rather
 * than filing one customer's logs under another.
 */

const COLUMNS = [
  'tenant_id',
  'ts',
  'source_type',
  'collector_id',
  'source',
  'vendor',
  'product',
  'event_type',
  'event_subtype',
  'event_category',
  'event_action',
  'action',
  'event_outcome',
  'severity',
  'user_name',
  'host',
  'process',
  'src_ip',
  'src_port',
  'dst_ip',
  'dst_port',
  'protocol',
  'url',
  'http_method',
  'status_code',
  'rule_name',
  'rule_id',
  'cloud_account_id',
  'cloud_region',
  'cloud_service',
  'message',
  'raw',
  'attrs',
  'tags',
  'parse_ok',
  'src_hostname',
  'geo_country_iso',
  'geo_country',
  'geo_city',
  'geo_lat',
  'geo_lon',
  'asn',
  'as_org',
] as const;

export interface WriteBatch {
  tenantId: string;
  collectorId: string | null;
  events: CanonicalEvent[];
}

/** Postgres caps a statement at 65535 bind parameters. Stay well under it. */
const MAX_ROWS_PER_STATEMENT = Math.min(
  config.ingest.writeBatchSize,
  Math.floor(60_000 / COLUMNS.length),
);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function insertEvents(batch: WriteBatch): Promise<number> {
  if (batch.events.length === 0) return 0;

  // Deliberately outside withApp(): enrichment must not run while a pooled
  // connection is held open. It never throws and never drops an event, so
  // there is nothing to guard here.
  enrichBatch(batch.events);

  return withApp(batch.tenantId, async (db) => {
    let written = 0;

    for (const rows of chunk(batch.events, MAX_ROWS_PER_STATEMENT)) {
      const values: unknown[] = [];
      const tuples: string[] = [];

      for (const e of rows) {
        const base = values.length;
        tuples.push(
          `(${COLUMNS.map((_, i) => `$${base + i + 1}`).join(', ')})`,
        );
        values.push(
          batch.tenantId,
          e.ts,
          e.sourceType,
          batch.collectorId,
          e.source,
          e.vendor,
          e.product,
          e.eventType,
          e.eventSubtype,
          e.eventCategory,
          e.eventAction,
          e.action,
          e.eventOutcome,
          e.severity,
          e.userName,
          e.host,
          e.process,
          e.srcIp,
          e.srcPort,
          e.dstIp,
          e.dstPort,
          e.protocol,
          e.url,
          e.httpMethod,
          e.statusCode,
          e.ruleName,
          e.ruleId,
          e.cloudAccountId,
          e.cloudRegion,
          e.cloudService,
          e.message,
          e.raw,
          JSON.stringify(e.attrs ?? {}),
          e.tags,
          e.parseOk,
          e.srcHostname,
          e.geoCountryIso,
          e.geoCountry,
          e.geoCity,
          e.geoLat,
          e.geoLon,
          e.asn,
          e.asOrg,
        );
      }

      const sql =
        `INSERT INTO events (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`;
      const result = await db.query(sql, values);
      written += result.rowCount ?? rows.length;
    }

    return written;
  });
}

/**
 * Records a payload that never became an event.
 *
 * The most important case is a syslog sender matching no collector, which by
 * definition has no tenant to attribute it to. ingest_drops therefore has no
 * tenant_id column and its insert policy is unconditional — so these rows are
 * written on an unpinned connection rather than being thrown away. Without
 * that, "why is nothing arriving from the new firewall?" would have no answer
 * anywhere except the container log.
 */
export async function recordDrop(
  tenantId: string | null,
  channel: string,
  reason: string,
  srcIp: string | null,
  sample: string | null,
): Promise<void> {
  console.warn(`[ingest] dropped ${channel} payload from ${srcIp ?? 'unknown'}: ${reason}`);

  const write = async (db: Queryable) => {
    await db.query(
      'INSERT INTO ingest_drops (channel, reason, src_ip, sample) VALUES ($1, $2, $3, $4)',
      [channel, reason, srcIp, sample?.slice(0, 1000) ?? null],
    );
  };

  try {
    await (tenantId ? withApp(tenantId, write) : withUnscopedApp(write));
  } catch (err) {
    console.error('[ingest] could not record drop', err);
  }
}
