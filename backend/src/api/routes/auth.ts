// API เข้าสู่ระบบ ออกจากระบบ และข้อมูลผู้ใช้ปัจจุบัน

import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../audit/log.js';
import { dummyVerify, verifyPassword } from '../../auth/password.js';
import {
  clearSessionCookie,
  createSession,
  readSessionCookie,
  revokeSession,
  setSessionCookie,
} from '../../auth/session.js';
import { requireAuth } from '../../auth/rbac.js';
import { withUnscopedApp } from '../../db/tenant.js';
import type { Actor, ActorRole } from '../../db/tenant.js';
import { handler, parse } from '../util.js';

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(512),
});

export function authRouter(): Router {
  const router = Router();

  router.post(
    '/auth/login',
    handler(async (req, res) => {
      const { email, password } = parse(credentials, req.body);

      const row = await withUnscopedApp(async (db) => {
        const { rows } = await db.query<{
          id: string;
          tenant_id: string | null;
          email: string;
          password_hash: string;
          role: ActorRole;
          active: boolean;
        }>('SELECT * FROM auth_find_user($1)', [email.toLowerCase()]);
        return rows[0] ?? null;
      });

      const ok = row ? await verifyPassword(password, row.password_hash) : await dummyVerify();

      if (!row || !ok || !row.active) {
        res.status(401).json({ error: 'invalid email or password' });
        return;
      }

      const { token, expiresAt } = await createSession(row.id);
      setSessionCookie(res, token, expiresAt);

      const actor: Actor = {
        userId: row.id,
        email: row.email,
        role: row.role,
        tenantId: row.tenant_id,
      };
      await audit(actor, {
        action: 'auth.login',
        targetType: 'user',
        targetId: row.id,
        srcIp: req.clientIp ?? null,
      });

      res.json({
        user: {
          id: row.id,
          email: row.email,
          role: row.role,
          tenant_id: row.tenant_id,
        },
        expires_at: expiresAt,
      });
    }),
  );

  router.post(
    '/auth/logout',
    handler(async (req, res) => {
      const token = readSessionCookie(req.headers.cookie);
      if (token) await revokeSession(token);
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  router.get(
    '/auth/me',
    requireAuth,
    handler(async (req, res) => {
      const actor = req.actor!;
      res.json({
        user: {
          id: actor.userId,
          email: actor.email,
          role: actor.role,
          tenant_id: actor.tenantId,
        },
      });
    }),
  );

  return router;
}
