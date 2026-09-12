import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { withUnscopedApp } from '../db/tenant.js';
import type { SourceType } from '../normalize/schema.js';

/**
 * Collector resolution: turning "something arrived" into "this belongs to
 * tenant X and should be read with parser Y".
 *
 * The payload never gets a say. An HTTP sender proves itself with a bearer
 * token; a syslog sender is identified by its source address. Both look up a
 * collector row, and the collector is what carries the tenant.
 */

export interface ResolvedCollector {
  collectorId: string;
  tenantId: string;
  sourceType: SourceType;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Issued once, shown once, stored only as a hash. */
export function generateToken(): string {
  return `sk_${randomBytes(24).toString('base64url')}`;
}

export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Resolution sits in the hot path of the syslog listener, which sees one
 * datagram per event, so results are cached briefly. Misses are cached too —
 * otherwise a misconfigured device pointed at us would turn into a query per
 * packet.
 */
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;

interface CacheEntry {
  value: ResolvedCollector | null;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

function cached(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry;
}

function remember(key: string, value: ResolvedCollector | null): ResolvedCollector | null {
  cache.set(key, { value, expires: Date.now() + (value ? HIT_TTL_MS : MISS_TTL_MS) });
  return value;
}

/** Call after any change to collectors so a disabled channel stops working now. */
export function invalidateCollectorCache(): void {
  cache.clear();
}

async function lookup(
  fn: string,
  param: unknown,
  extra?: unknown,
): Promise<ResolvedCollector | null> {
  const args = extra === undefined ? [param] : [param, extra];
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');

  return withUnscopedApp(async (db) => {
    const { rows } = await db.query<{
      collector_id: string;
      tenant_id: string;
      source_type: SourceType;
    }>(`SELECT * FROM ${fn}(${placeholders})`, args);

    const row = rows[0];
    if (!row) return null;
    return {
      collectorId: row.collector_id,
      tenantId: row.tenant_id,
      sourceType: row.source_type,
    };
  });
}

export async function resolveByToken(token: string): Promise<ResolvedCollector | null> {
  const hash = hashToken(token);
  const key = `t:${hash}`;
  const hit = cached(key);
  if (hit) return hit.value;

  return remember(key, await lookup('resolve_collector_by_token', hash));
}

export async function resolveByIp(ip: string): Promise<ResolvedCollector | null> {
  const key = `i:${ip}`;
  const hit = cached(key);
  if (hit) return hit.value;

  return remember(key, await lookup('resolve_collector_by_ip', ip));
}

/**
 * A collector named explicitly, as in the upload form. Pass the caller's tenant
 * so a Viewer cannot upload into somebody else's collector; admins pass null.
 */
export async function resolveById(
  collectorId: string,
  tenantId: string | null,
): Promise<ResolvedCollector | null> {
  return lookup('resolve_collector_by_id', collectorId, tenantId);
}
