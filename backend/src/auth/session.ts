// จัดการ session: สร้าง ตรวจ ยกเลิก และ cookie

import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { config } from '../config.js';
import { withUnscopedApp } from '../db/tenant.js';
import type { Actor, ActorRole } from '../db/tenant.js';

export const COOKIE_NAME = 'siem_session';

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');

  const expiresAt = await withUnscopedApp(async (db) => {
    const { rows } = await db.query<{ session_create: Date }>(
      'SELECT session_create($1, $2, $3) AS session_create',
      [hashToken(token), userId, config.api.sessionTtlHours],
    );
    return rows[0]!.session_create;
  });

  return { token, expiresAt };
}

export async function lookupSession(token: string): Promise<Actor | null> {
  if (!token) return null;

  return withUnscopedApp(async (db) => {
    const { rows } = await db.query<{
      user_id: string;
      tenant_id: string | null;
      email: string;
      role: ActorRole;
    }>('SELECT * FROM session_lookup($1)', [hashToken(token)]);

    const row = rows[0];
    if (!row) return null;

    return {
      userId: row.user_id,
      email: row.email,
      role: row.role,
      tenantId: row.tenant_id,
    };
  });
}

export async function revokeSession(token: string): Promise<void> {
  if (!token) return;
  await withUnscopedApp(async (db) => {
    await db.query('SELECT session_revoke($1)', [hashToken(token)]);
  });
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.api.cookieSecure,
    expires: expiresAt,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.api.cookieSecure,
    path: '/',
  });
}

export function readSessionCookie(header: string | undefined): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return '';
}
