import { config } from '../config.js';
import { enrichBatch } from '../enrich/index.js';
import type { Queryable } from '../db/tenant.js';
import { withApp, withUnscopedApp } from '../db/tenant.js';
import type { CanonicalEvent } from '../normalize/schema.js';

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
