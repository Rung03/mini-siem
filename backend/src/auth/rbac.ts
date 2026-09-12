import type { NextFunction, Request, Response } from 'express';
import type { Actor } from '../db/tenant.js';
import { lookupSession, readSessionCookie } from './session.js';

/**
 * The two roles from the README:
 *
 *   Admin   every tenant; manages users, collectors and alert rules
 *   Viewer  its own tenant only; reads data and acknowledges its own alerts
 *
 * What these middlewares decide is which database role the request will
 * connect as. They are not the thing that keeps tenants apart — that is RLS,
 * and it holds even if this file is wrong.
 */

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
    clientIp?: string;
  }
}

/**
 * The address of the actual client.
 *
 * req.ip, not req.socket.remoteAddress: there is always at least one proxy in
 * front of this service (nginx in both deployment profiles, and Caddy as well
 * when TLS is terminated at the edge). Reading the socket directly records the
 * proxy's container address on every audit entry, which makes the trail
 * useless precisely when someone needs it.
 *
 * How far back to trust X-Forwarded-For is TRUST_PROXY_HOPS — a count, not a
 * blanket "trust everything", because a forwarded header from an untrusted hop
 * is an attacker-controlled string.
 */
export function clientIp(req: Request): string | null {
  const raw = req.ip ?? req.socket.remoteAddress ?? '';
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  return m ? m[1]! : raw || null;
}

/** Populates req.actor when a valid session cookie is present. Never rejects. */
export async function attachActor(req: Request, _res: Response, next: NextFunction) {
  req.clientIp = clientIp(req) ?? undefined;
  try {
    const token = readSessionCookie(req.headers.cookie);
    if (token) {
      const actor = await lookupSession(token);
      if (actor) req.actor = actor;
    }
  } catch (err) {
    console.error('[auth] session lookup failed', err);
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.actor) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.actor) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  if (req.actor.role !== 'admin') {
    res.status(403).json({ error: 'administrator role required' });
    return;
  }
  next();
}

/**
 * Belt to SameSite=Strict's braces. A cross-site form post cannot set a custom
 * content type, so requiring JSON on mutations rejects the one shape of CSRF
 * that a cookie-authenticated API is exposed to.
 */
export function requireJsonMutation(req: Request, res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const type = req.headers['content-type'] ?? '';
    const isJson = type.includes('application/json');
    const isUpload = type.includes('multipart/form-data') && req.path.endsWith('/file');
    if (!isJson && !isUpload) {
      res.status(415).json({ error: 'expected application/json' });
      return;
    }
  }
  next();
}
