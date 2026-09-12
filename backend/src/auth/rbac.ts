import type { NextFunction, Request, Response } from 'express';
import type { Actor } from '../db/tenant.js';
import { lookupSession, readSessionCookie } from './session.js';

declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
    clientIp?: string;
  }
}

export function clientIp(req: Request): string | null {
  const raw = req.ip ?? req.socket.remoteAddress ?? '';
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  return m ? m[1]! : raw || null;
}

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
