// API กฎแจ้งเตือน: อ่าน สร้าง แก้ไข ลบ

import { Router } from 'express';
import { z } from 'zod';
import { auditIn } from '../../audit/log.js';
import { requireAdmin, requireAuth } from '../../auth/rbac.js';
import { withActor } from '../../db/tenant.js';
import { SOURCE_TYPES } from '../../normalize/schema.js';
import { handler, parse, tenantScope } from '../util.js';

const ruleBody = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  match_category: z.string().max(64).nullish(),
  match_action: z.string().max(64).nullish(),
  match_outcome: z.enum(['success', 'failure', 'unknown']).nullish(),
  match_source: z.enum(SOURCE_TYPES).nullish(),
  group_by: z.enum(['src_ip', 'user_name', 'host']).default('src_ip'),
  window_seconds: z.number().int().min(30).max(86_400),
  threshold: z.number().int().min(1).max(100_000),
  severity: z.number().int().min(1).max(5).default(3),
  suppress_seconds: z.number().int().min(0).max(86_400).default(900),
  webhook_url: z.string().url().max(2048).nullish(),
});

const ruleUpdate = ruleBody.partial().omit({ tenant_id: true });

const COLUMNS = `id, tenant_id, name, enabled, match_category, match_action,
                 match_outcome, match_source, group_by, window_seconds, threshold,
                 severity, suppress_seconds, webhook_url, created_at`;

export function rulesRouter(): Router {
  const router = Router();

  router.get(
    '/rules',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const tenant = tenantScope(actor, req.query.tenant_id);

      const rows = await withActor(actor, async (db) => {
        const result = await db.query(
          `SELECT ${COLUMNS} FROM alert_rules
           ${tenant ? 'WHERE tenant_id = $1::uuid' : ''}
           ORDER BY name`,
          tenant ? [tenant] : [],
        );
        return result.rows;
      });

      res.json({ rules: rows });
    }),
  );

  router.post(
    '/rules',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const body = parse(ruleBody, req.body);

      const rule = await withActor(actor, async (db) => {
        const result = await db.query(
          `INSERT INTO alert_rules
             (tenant_id, name, enabled, match_category, match_action, match_outcome,
              match_source, group_by, window_seconds, threshold, severity,
              suppress_seconds, webhook_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING ${COLUMNS}`,
          [
            body.tenant_id,
            body.name,
            body.enabled,
            body.match_category ?? null,
            body.match_action ?? null,
            body.match_outcome ?? null,
            body.match_source ?? null,
            body.group_by,
            body.window_seconds,
            body.threshold,
            body.severity,
            body.suppress_seconds,
            body.webhook_url ?? null,
          ],
        );
        const row = result.rows[0]!;
        await auditIn(db, actor, {
          action: 'rule.create',
          targetType: 'alert_rule',
          targetId: row.id as string,
          tenantId: body.tenant_id,
          details: { name: body.name, threshold: body.threshold },
          srcIp: req.clientIp ?? null,
        });
        return row;
      });

      res.status(201).json({ rule });
    }),
  );

  router.patch(
    '/rules/:id',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const id = parse(z.string().uuid(), req.params.id);
      const body = parse(ruleUpdate, req.body);

      const entries = Object.entries(body).filter(([, v]) => v !== undefined);
      if (entries.length === 0) {
        res.status(400).json({ error: 'no fields to update' });
        return;
      }

      const allowed = new Set(Object.keys(ruleUpdate.shape));
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [key, value] of entries) {
        if (!allowed.has(key)) continue;
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
      params.push(id);

      const rule = await withActor(actor, async (db) => {
        const result = await db.query(
          `UPDATE alert_rules SET ${sets.join(', ')}
           WHERE id = $${params.length}
           RETURNING ${COLUMNS}`,
          params,
        );
        const row = result.rows[0];
        if (row) {
          await auditIn(db, actor, {
            action: 'rule.update',
            targetType: 'alert_rule',
            targetId: id,
            tenantId: row.tenant_id as string,
            details: body as Record<string, unknown>,
            srcIp: req.clientIp ?? null,
          });
        }
        return row ?? null;
      });

      if (!rule) {
        res.status(404).json({ error: 'rule not found' });
        return;
      }
      res.json({ rule });
    }),
  );

  router.delete(
    '/rules/:id',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const id = parse(z.string().uuid(), req.params.id);

      const deleted = await withActor(actor, async (db) => {
        const { rows: used } = await db.query<{ count: number }>(
          'SELECT count(*) AS count FROM alerts WHERE rule_id = $1',
          [id],
        );
        if ((used[0]?.count ?? 0) > 0) {
          await db.query('UPDATE alert_rules SET enabled = false WHERE id = $1', [id]);
          await auditIn(db, actor, {
            action: 'rule.disable',
            targetType: 'alert_rule',
            targetId: id,
            details: { reason: 'rule has alert history' },
            srcIp: req.clientIp ?? null,
          });
          return 'disabled' as const;
        }

        const result = await db.query('DELETE FROM alert_rules WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) return null;

        await auditIn(db, actor, {
          action: 'rule.delete',
          targetType: 'alert_rule',
          targetId: id,
          srcIp: req.clientIp ?? null,
        });
        return 'deleted' as const;
      });

      if (!deleted) {
        res.status(404).json({ error: 'rule not found' });
        return;
      }
      res.json({ ok: true, outcome: deleted });
    }),
  );

  return router;
}
