import { Router } from 'express';
import { z } from 'zod';
import { auditIn } from '../../audit/log.js';
import { requireAdmin, requireAuth } from '../../auth/rbac.js';
import { withActor } from '../../db/tenant.js';
import {
  generateToken,
  hashToken,
  invalidateCollectorCache,
} from '../../ingest/collectors.js';
import { SOURCE_TYPES } from '../../normalize/schema.js';
import { handler, parse, tenantScope } from '../util.js';

/**
 * Collector administration.
 *
 * A token is generated here, hashed immediately, and returned to the caller
 * exactly once. There is no endpoint that reads a token back, because the
 * database does not have one to read — only its SHA-256.
 */

const createBody = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: z.enum(['http', 'syslog', 'file']),
  source_type: z.enum(SOURCE_TYPES),
  /** Required for syslog collectors: which sender address this matches. */
  source_cidr: z.string().max(64).nullish(),
  enabled: z.boolean().default(true),
});

const updateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  source_cidr: z.string().max(64).nullish(),
});

const PUBLIC_COLUMNS = `id, tenant_id, name, kind, source_type,
                        host(source_cidr) AS source_cidr, enabled, created_at,
                        (token_hash IS NOT NULL) AS has_token`;

export function collectorsRouter(): Router {
  const router = Router();

  router.get(
    '/collectors',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const tenant = tenantScope(actor, req.query.tenant_id);

      const rows = await withActor(actor, async (db) => {
        const result = await db.query(
          `SELECT ${PUBLIC_COLUMNS}, text(source_cidr) AS cidr
           FROM collectors
           ${tenant ? 'WHERE tenant_id = $1::uuid' : ''}
           ORDER BY name`,
          tenant ? [tenant] : [],
        );
        return result.rows;
      });

      res.json({ collectors: rows });
    }),
  );

  router.post(
    '/collectors',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const body = parse(createBody, req.body);

      if (body.kind === 'syslog' && !body.source_cidr) {
        res.status(400).json({ error: 'syslog collectors need a source_cidr' });
        return;
      }

      // Only the HTTP channel authenticates with a token; syslog is identified
      // by source address and uploads by the signed-in user.
      const token = body.kind === 'http' ? generateToken() : null;

      const collector = await withActor(actor, async (db) => {
        const result = await db.query(
          `INSERT INTO collectors (tenant_id, name, kind, source_type, token_hash, source_cidr, enabled)
           VALUES ($1, $2, $3, $4, $5, $6::cidr, $7)
           RETURNING ${PUBLIC_COLUMNS}, text(source_cidr) AS cidr`,
          [
            body.tenant_id,
            body.name,
            body.kind,
            body.source_type,
            token ? hashToken(token) : null,
            body.source_cidr ?? null,
            body.enabled,
          ],
        );
        const row = result.rows[0]!;
        await auditIn(db, actor, {
          action: 'collector.create',
          targetType: 'collector',
          targetId: row.id as string,
          tenantId: body.tenant_id,
          details: { name: body.name, kind: body.kind, source_type: body.source_type },
          srcIp: req.clientIp ?? null,
        });
        return row;
      });

      invalidateCollectorCache();

      res.status(201).json({
        collector,
        // Shown once. After this response the plaintext exists nowhere.
        token,
      });
    }),
  );

  router.patch(
    '/collectors/:id',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const id = parse(z.string().uuid(), req.params.id);
      const body = parse(updateBody, req.body);

      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.name !== undefined) {
        params.push(body.name);
        sets.push(`name = $${params.length}`);
      }
      if (body.enabled !== undefined) {
        params.push(body.enabled);
        sets.push(`enabled = $${params.length}`);
      }
      if (body.source_cidr !== undefined) {
        params.push(body.source_cidr);
        sets.push(`source_cidr = $${params.length}::cidr`);
      }
      if (sets.length === 0) {
        res.status(400).json({ error: 'no fields to update' });
        return;
      }
      params.push(id);

      const collector = await withActor(actor, async (db) => {
        const result = await db.query(
          `UPDATE collectors SET ${sets.join(', ')} WHERE id = $${params.length}
           RETURNING ${PUBLIC_COLUMNS}, text(source_cidr) AS cidr`,
          params,
        );
        const row = result.rows[0];
        if (row) {
          await auditIn(db, actor, {
            action: 'collector.update',
            targetType: 'collector',
            targetId: id,
            tenantId: row.tenant_id as string,
            details: body as Record<string, unknown>,
            srcIp: req.clientIp ?? null,
          });
        }
        return row ?? null;
      });

      // A disabled collector has to stop working immediately, not when the
      // resolution cache happens to expire.
      invalidateCollectorCache();

      if (!collector) {
        res.status(404).json({ error: 'collector not found' });
        return;
      }
      res.json({ collector });
    }),
  );

  /** Issues a replacement token and invalidates the previous one. */
  router.post(
    '/collectors/:id/rotate-token',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const id = parse(z.string().uuid(), req.params.id);
      const token = generateToken();

      const collector = await withActor(actor, async (db) => {
        const result = await db.query(
          `UPDATE collectors SET token_hash = $1
           WHERE id = $2 AND kind = 'http'
           RETURNING ${PUBLIC_COLUMNS}`,
          [hashToken(token), id],
        );
        const row = result.rows[0];
        if (row) {
          await auditIn(db, actor, {
            action: 'collector.rotate_token',
            targetType: 'collector',
            targetId: id,
            tenantId: row.tenant_id as string,
            srcIp: req.clientIp ?? null,
          });
        }
        return row ?? null;
      });

      invalidateCollectorCache();

      if (!collector) {
        res.status(404).json({ error: 'no http collector with that id' });
        return;
      }
      res.json({ collector, token });
    }),
  );

  return router;
}
