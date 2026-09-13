// API ผู้ดูแล: tenant, ผู้ใช้, audit trail, ingest ที่ถูกปฏิเสธ และ partition

import { Router } from 'express';
import { z } from 'zod';
import { auditIn } from '../../audit/log.js';
import { hashPassword } from '../../auth/password.js';
import { requireAdmin, requireAuth } from '../../auth/rbac.js';
import { withActor, withAdmin, withOwner } from '../../db/tenant.js';
import { handler, parse, tenantScope } from '../util.js';

const tenantBody = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only'),
  name: z.string().min(1).max(120),
});

const userBody = z
  .object({
    email: z.string().email().max(320),
    password: z.string().min(10).max(512),
    role: z.enum(['admin', 'viewer']),
    tenant_id: z.string().uuid().nullish(),
  })
  .refine((v) => (v.role === 'admin' ? !v.tenant_id : !!v.tenant_id), {
    message: 'viewers need a tenant_id; admins must not have one',
    path: ['tenant_id'],
  });

const userUpdate = z.object({
  active: z.boolean().optional(),
  password: z.string().min(10).max(512).optional(),
});

export function adminRouter(): Router {
  const router = Router();

  router.get(
    '/tenants',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      const tenant = tenantScope(actor, req.query.tenant_id);

      const rows = await withActor(actor, async (db) => {
        const result = await db.query(
          `SELECT id, slug, name, active, created_at FROM tenants
           ${tenant ? 'WHERE id = $1::uuid' : ''}
           ORDER BY name`,
          tenant ? [tenant] : [],
        );
        return result.rows;
      });

      res.json({ tenants: rows });
    }),
  );

  router.post(
    '/tenants',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const body = parse(tenantBody, req.body);

      const tenant = await withActor(actor, async (db) => {
        const result = await db.query<{ id: string }>(
          `INSERT INTO tenants (slug, name) VALUES ($1, $2)
           RETURNING id, slug, name, active, created_at`,
          [body.slug, body.name],
        );
        const row = result.rows[0]!;
        await auditIn(db, actor, {
          action: 'tenant.create',
          targetType: 'tenant',
          targetId: row.id,
          tenantId: row.id,
          details: { slug: body.slug },
          srcIp: req.clientIp ?? null,
        });
        return row;
      });

      await withOwner(async (db) => {
        await db.query('SELECT ensure_partitions($1)', [2]);
      });

      res.status(201).json({ tenant });
    }),
  );

  router.get(
    '/users',
    requireAdmin,
    handler(async (req, res) => {
      const rows = await withAdmin(async (db) => {
        const result = await db.query(
          `SELECT u.id, u.email, u.role, u.tenant_id, t.name AS tenant_name,
                  u.active, u.created_at
           FROM users u
           LEFT JOIN tenants t ON t.id = u.tenant_id
           ORDER BY u.email`,
        );
        return result.rows;
      });
      res.json({ users: rows });
    }),
  );

  router.post(
    '/users',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const body = parse(userBody, req.body);
      const passwordHash = await hashPassword(body.password);

      const user = await withActor(actor, async (db) => {
        const result = await db.query(
          `INSERT INTO users (email, password_hash, role, tenant_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, email, role, tenant_id, active, created_at`,
          [body.email.toLowerCase(), passwordHash, body.role, body.tenant_id ?? null],
        );
        const row = result.rows[0]!;
        await auditIn(db, actor, {
          action: 'user.create',
          targetType: 'user',
          targetId: row.id as string,
          tenantId: body.tenant_id ?? null,
          details: { email: body.email, role: body.role },
          srcIp: req.clientIp ?? null,
        });
        return row;
      });

      res.status(201).json({ user });
    }),
  );

  router.patch(
    '/users/:id',
    requireAdmin,
    handler(async (req, res) => {
      const actor = req.actor!;
      const id = parse(z.string().uuid(), req.params.id);
      const body = parse(userUpdate, req.body);

      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.active !== undefined) {
        params.push(body.active);
        sets.push(`active = $${params.length}`);
      }
      if (body.password !== undefined) {
        params.push(await hashPassword(body.password));
        sets.push(`password_hash = $${params.length}`);
      }
      if (sets.length === 0) {
        res.status(400).json({ error: 'no fields to update' });
        return;
      }
      params.push(id);

      const user = await withActor(actor, async (db) => {
        const result = await db.query(
          `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
           RETURNING id, email, role, tenant_id, active, created_at`,
          params,
        );
        const row = result.rows[0];
        if (row) {
          await auditIn(db, actor, {
            action: 'user.update',
            targetType: 'user',
            targetId: id,
            tenantId: (row.tenant_id as string | null) ?? null,
            details: {
              active: body.active,
              password_changed: body.password !== undefined,
            },
            srcIp: req.clientIp ?? null,
          });
        }
        return row ?? null;
      });

      if (!user) {
        res.status(404).json({ error: 'user not found' });
        return;
      }
      res.json({ user });
    }),
  );

  router.get(
    '/audit',
    requireAdmin,
    handler(async (req, res) => {
      const input = parse(
        z.object({
          limit: z.coerce.number().int().min(1).max(500).default(100),
          tenant_id: z.string().uuid().optional(),
          action: z.string().max(64).optional(),
        }),
        req.query,
      );

      const params: unknown[] = [];
      const clauses: string[] = [];
      const push = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (input.tenant_id) clauses.push(`tenant_id = ${push(input.tenant_id)}::uuid`);
      if (input.action) clauses.push(`action = ${push(input.action)}`);

      const rows = await withAdmin(async (db) => {
        const result = await db.query(
          `SELECT id, at, actor_email, actor_role, tenant_id, action,
                  target_type, target_id, details, host(src_ip) AS src_ip
           FROM audit_log
           ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
           ORDER BY at DESC, id DESC
           LIMIT ${push(input.limit)}`,
          params,
        );
        return result.rows;
      });

      res.json({ entries: rows });
    }),
  );

  router.get(
    '/ingest-drops',
    requireAdmin,
    handler(async (_req, res) => {
      const rows = await withAdmin(async (db) => {
        const result = await db.query(
          `SELECT id, at, channel, reason, host(src_ip) AS src_ip, sample
           FROM ingest_drops ORDER BY at DESC LIMIT 100`,
        );
        return result.rows;
      });
      res.json({ drops: rows });
    }),
  );

  router.get(
    '/partitions',
    requireAdmin,
    handler(async (_req, res) => {
      const rows = await withAdmin(async (db) => {
        const result = await db.query('SELECT * FROM partition_overview()');
        return result.rows;
      });
      res.json({ partitions: rows });
    }),
  );

  return router;
}
