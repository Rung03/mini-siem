// API ค้นหา event และดู payload ดิบ

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/rbac.js';
import { withActor } from '../../db/tenant.js';
import type { Actor } from '../../db/tenant.js';
import { SOURCES, SOURCE_TYPES } from '../../normalize/schema.js';
import { HttpError, handler, parse, resolveRange, tenantScope } from '../util.js';

const query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  tenant_id: z.string().uuid().optional(),
  outcome: z.enum(['success', 'failure', 'unknown']).optional(),
  source_type: z.enum(SOURCE_TYPES).optional(),
  source: z.enum(SOURCES).optional(),
  event_type: z.string().max(120).optional(),
  action: z.string().max(64).optional(),
  country: z.string().length(2).optional(),
  user: z.string().max(320).optional(),
  user_exact: z.string().max(320).optional(),
  ip: z.string().max(64).optional(),
  host: z.string().max(255).optional(),
  category: z.string().max(64).optional(),
  q: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(120).optional(),
});

export type EventQuery = z.infer<typeof query>;

export interface FilterSql {
  where: string;
  params: unknown[];
}

export function buildFilter(
  actor: Actor,
  input: EventQuery,
  range: { from: Date; to: Date },
): FilterSql {
  const params: unknown[] = [];
  const clauses: string[] = [];

  const push = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  clauses.push(`ts >= ${push(range.from)}`);
  clauses.push(`ts <= ${push(range.to)}`);

  const tenant = tenantScope(actor, input.tenant_id);
  if (tenant) clauses.push(`tenant_id = ${push(tenant)}::uuid`);

  if (input.outcome) clauses.push(`event_outcome = ${push(input.outcome)}`);
  if (input.source_type) clauses.push(`source_type = ${push(input.source_type)}`);
  if (input.source) clauses.push(`source = ${push(input.source)}`);
  if (input.event_type) clauses.push(`event_type = ${push(input.event_type)}`);
  if (input.action) clauses.push(`action = ${push(input.action)}`);
  if (input.country) clauses.push(`geo_country_iso = ${push(input.country.toUpperCase())}`);
  if (input.category) clauses.push(`event_category = ${push(input.category)}`);
  if (input.host) clauses.push(`host = ${push(input.host)}`);
  if (input.user) clauses.push(`user_name ILIKE ${push(`%${input.user}%`)}`);
  if (input.user_exact) clauses.push(`user_name = ${push(input.user_exact)}`);

  if (input.ip) {
    const isCidr = input.ip.includes('/');
    clauses.push(
      isCidr ? `src_ip << ${push(input.ip)}::inet` : `src_ip = ${push(input.ip)}::inet`,
    );
  }

  if (input.q) clauses.push(`message ILIKE ${push(`%${input.q}%`)}`);

  return { where: clauses.join(' AND '), params };
}

function decodeCursor(cursor: string): { ts: Date; id: string } {
  const sep = cursor.lastIndexOf('|');
  if (sep === -1) throw new HttpError(400, 'malformed cursor');
  const ts = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(ts.getTime()) || !id) throw new HttpError(400, 'malformed cursor');
  return { ts, id };
}

export function eventsRouter(): Router {
  const router = Router();

  router.get(
    '/events',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const input = parse(query, req.query);
      const range = resolveRange(input);
      const filter = buildFilter(actor, input, range);

      const params = [...filter.params];
      let where = filter.where;

      if (input.cursor) {
        const { ts, id } = decodeCursor(input.cursor);
        params.push(ts, id);
        where += ` AND (ts, id) < ($${params.length - 1}, $${params.length}::uuid)`;
      }

      params.push(input.limit + 1);
      const limitParam = `$${params.length}`;

      const rows = await withActor(actor, async (db) => {
        const result = await db.query(
          `SELECT id, tenant_id, ts, received_at, source_type, source, vendor,
                  product, event_type, event_subtype, event_category,
                  event_action, action, event_outcome, severity,
                  user_name, host, process,
                  host(src_ip) AS src_ip, src_port,
                  host(dst_ip) AS dst_ip, dst_port, protocol,
                  url, http_method, status_code, rule_name, rule_id,
                  cloud_account_id, cloud_region, cloud_service,
                  src_hostname, geo_country_iso, geo_country, geo_city,
                  geo_lat, geo_lon, asn, as_org,
                  message, attrs, tags, parse_ok
           FROM events
           WHERE ${where}
           ORDER BY ts DESC, id DESC
           LIMIT ${limitParam}`,
          params,
        );
        return result.rows;
      });

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const last = page[page.length - 1];

      res.json({
        events: page,
        next_cursor:
          hasMore && last
            ? `${new Date(last.ts as string).toISOString()}|${last.id as string}`
            : null,
      });
    }),
  );

  router.get(
    '/events/:id/raw',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const id = parse(z.string().uuid(), req.params.id);
      const ts = parse(z.string().datetime().optional(), req.query.ts);

      const row = await withActor(actor, async (db) => {
        const params: unknown[] = [id];
        let extra = '';
        if (ts) {
          params.push(new Date(ts));
          extra = ` AND ts >= $2::timestamptz - interval '1 second'
                    AND ts <= $2::timestamptz + interval '1 second'`;
        }
        const result = await db.query<{ raw: string; ts: string; source_type: string }>(
          `SELECT raw, ts, source_type FROM events WHERE id = $1${extra} LIMIT 1`,
          params,
        );
        return result.rows[0] ?? null;
      });

      if (!row) {
        res.status(404).json({ error: 'event not found' });
        return;
      }
      res.json(row);
    }),
  );

  return router;
}
