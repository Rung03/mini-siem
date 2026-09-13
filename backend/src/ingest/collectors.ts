// จับคู่ข้อมูลที่เข้ามากับ collector จาก token หรือ IP เพื่อรู้ tenant และ parser

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { withUnscopedApp } from '../db/tenant.js';
import type { SourceType } from '../normalize/schema.js';

export interface ResolvedCollector {
  collectorId: string;
  tenantId: string;
  sourceType: SourceType;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(): string {
  return `sk_${randomBytes(24).toString('base64url')}`;
}

export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

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

export async function resolveById(
  collectorId: string,
  tenantId: string | null,
): Promise<ResolvedCollector | null> {
  return lookup('resolve_collector_by_id', collectorId, tenantId);
}
