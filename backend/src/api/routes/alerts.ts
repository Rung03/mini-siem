// API alert: รายการ และ acknowledge

import { Router } from 'express';
import { z } from 'zod';
import { auditIn } from '../../audit/log.js';
import { requireAuth } from '../../auth/rbac.js';
import { withActor } from '../../db/tenant.js';
import { handler, parse, tenantScope } from '../util.js';

const listQuery = z.object({
  status: z.enum(['open', 'acknowledged']).optional(),
  tenant_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function alertsRouter(): Router {
  const router = Router();

  router.get(
    '/alerts',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const input = parse(listQuery, req.query);

      const params: unknown[] = [];
      const clauses: string[] = [];
      const push = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };

      const tenant = tenantScope(actor, input.tenant_id);
      if (tenant) clauses.push(`a.tenant_id = ${push(tenant)}::uuid`);
      if (input.status) clauses.push(`a.status = ${push(input.status)}`);

      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

      const rows = await withActor(actor, async (db) => {
        const result = await db.query(
          `SELECT a.id, a.tenant_id, a.rule_id, r.name AS rule_name,
                  a.created_at, a.first_seen, a.last_seen, a.status, a.severity,
                  a.group_by, a.group_value, a.event_count, a.title, a.details,
                  a.acked_at, a.acked_by, a.webhook_status, a.webhook_error
           FROM alerts a
           LEFT JOIN alert_rules r ON r.id = a.rule_id
           ${where}
           ORDER BY a.created_at DESC
           LIMIT ${push(input.limit)}`,
          params,
        );
        return result.rows;
      });

      res.json({ alerts: rows });
    }),
  );

  router.post(
    '/alerts/:id/ack',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const id = parse(z.string().uuid(), req.params.id);

      const updated = await withActor(actor, async (db) => {
        const result = await db.query<{ id: string; tenant_id: string; title: string }>(
          `UPDATE alerts
           SET status = 'acknowledged', acked_by = $1, acked_at = now()
           WHERE id = $2 AND status = 'open'
           RETURNING id, tenant_id, title`,
          [actor.userId, id],
        );

        const row = result.rows[0];
        if (row) {
          await auditIn(db, actor, {
            action: 'alert.acknowledge',
            targetType: 'alert',
            targetId: row.id,
            tenantId: row.tenant_id,
            details: { title: row.title },
            srcIp: req.clientIp ?? null,
          });
        }
        return row ?? null;
      });

      if (!updated) {
        res.status(404).json({ error: 'no open alert with that id' });
        return;
      }

      res.json({ ok: true, id: updated.id });
    }),
  );

  return router;
}
