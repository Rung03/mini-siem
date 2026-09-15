// API สถิติสำหรับ dashboard: สรุป, ตามเวลา, อันดับ, แหล่งข้อมูล

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../auth/rbac.js';
import { withActor } from '../../db/tenant.js';
import { SOURCES, SOURCE_TYPES } from '../../normalize/schema.js';
import { handler, parse, resolveRange } from '../util.js';
import { buildFilter } from './events.js';

const baseQuery = z.object({
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
  cursor: z.string().optional(),
});

const bucketQuery = baseQuery.extend({
  bucket: z.enum(['minute', 'hour', 'day']).default('hour'),
});

const topQuery = baseQuery.extend({
  field: z
    .enum([
      'user_name', 'src_ip', 'dst_ip', 'host', 'source_type', 'source',
      'event_type', 'action', 'rule_name', 'process',
      'geo_country_iso', 'geo_country', 'as_org', 'src_hostname',
    ])
    .default('user_name'),
  top: z.coerce.number().int().min(1).max(50).default(10),
});

export function statsRouter(): Router {
  const router = Router();

  router.get(
    '/stats/summary',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const input = parse(baseQuery, req.query);
      const range = resolveRange(input);
      const { where, params } = buildFilter(actor, input, range);

      const row = await withActor(actor, async (db) => {
        const result = await db.query<{
          total: number;
          success: number;
          failure: number;
          unique_users: number;
          unique_ips: number;
          unparsed: number;
        }>(
          `SELECT
             count(*)                                             AS total,
             count(*) FILTER (WHERE event_outcome = 'success')    AS success,
             count(*) FILTER (WHERE event_outcome = 'failure')    AS failure,
             count(DISTINCT user_name)                            AS unique_users,
             count(DISTINCT src_ip)                               AS unique_ips,
             count(*) FILTER (WHERE NOT parse_ok)                 AS unparsed
           FROM events
           WHERE ${where}`,
          params,
        );
        return result.rows[0]!;
      });

      res.json({
        from: range.from,
        to: range.to,
        ...row,
      });
    }),
  );

  router.get(
    '/stats/timeseries',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const input = parse(bucketQuery, req.query);
      const range = resolveRange(input);
      const { where, params } = buildFilter(actor, input, range);

      const interval = `1 ${input.bucket}`;
      const buckets = await withActor(actor, async (db) => {
        const result = await db.query<{
          bucket: string;
          success: number;
          failure: number;
          total: number;
        }>(
          `WITH series AS (
             SELECT generate_series(
               date_trunc($${params.length + 1}, $1::timestamptz),
               date_trunc($${params.length + 1}, $2::timestamptz),
               $${params.length + 2}::interval
             ) AS bucket
           ),
           counted AS (
             SELECT date_trunc($${params.length + 1}, ts) AS bucket,
                    count(*) FILTER (WHERE event_outcome = 'success') AS success,
                    count(*) FILTER (WHERE event_outcome = 'failure') AS failure,
                    count(*) AS total
             FROM events
             WHERE ${where}
             GROUP BY 1
           )
           SELECT s.bucket,
                  COALESCE(c.success, 0) AS success,
                  COALESCE(c.failure, 0) AS failure,
                  COALESCE(c.total, 0)   AS total
           FROM series s
           LEFT JOIN counted c ON c.bucket = s.bucket
           ORDER BY s.bucket`,
          [...params, input.bucket, interval],
        );
        return result.rows;
      });

      res.json({ bucket: input.bucket, from: range.from, to: range.to, buckets });
    }),
  );

  router.get(
    '/stats/top',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const input = parse(topQuery, req.query);
      const range = resolveRange(input);
      const { where, params } = buildFilter(actor, input, range);

      const column =
        input.field === 'src_ip' ? 'host(src_ip)'
        : input.field === 'dst_ip' ? 'host(dst_ip)'
        : input.field;

      const rows = await withActor(actor, async (db) => {
        const result = await db.query<{
          value: string;
          total: number;
          success: number;
          failure: number;
        }>(
          `SELECT ${column} AS value,
                  count(*) AS total,
                  count(*) FILTER (WHERE event_outcome = 'success') AS success,
                  count(*) FILTER (WHERE event_outcome = 'failure') AS failure
           FROM events
           WHERE ${where} AND ${input.field} IS NOT NULL
           GROUP BY 1
           ORDER BY total DESC, value
           LIMIT $${params.length + 1}`,
          [...params, input.top],
        );
        return result.rows;
      });

      res.json({ field: input.field, from: range.from, to: range.to, rows });
    }),
  );

  router.get(
    '/stats/sources',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const input = parse(baseQuery, req.query);
      const range = resolveRange(input);
      const { where, params } = buildFilter(actor, input, range);

      const rows = await withActor(actor, async (db) => {
        const result = await db.query(
          `SELECT source_type,
                  count(*) AS total,
                  count(*) FILTER (WHERE NOT parse_ok) AS unparsed,
                  max(received_at) AS last_seen
           FROM events
           WHERE ${where}
           GROUP BY 1
           ORDER BY total DESC`,
          params,
        );
        return result.rows;
      });

      res.json({ sources: rows });
    }),
  );

  return router;
}
