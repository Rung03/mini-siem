import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { Actor } from '../db/tenant.js';

export function handler(
  fn: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
      .join('; ');
    throw new HttpError(400, detail);
  }
  return result.data;
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  const pgCode = (err as { code?: string } | null)?.code;
  if (pgCode === '42501') {
    res.status(403).json({
      error: 'the database refused this operation',
      detail: (err as Error).message,
    });
    return;
  }

  console.error('[api] unhandled error', err);
  res.status(500).json({ error: 'internal error' });
}

export function tenantScope(actor: Actor, requested: unknown): string | null {
  if (actor.role === 'viewer') return actor.tenantId;
  const value = typeof requested === 'string' && requested.trim() ? requested.trim() : null;
  return value;
}

export const uuid = z.string().uuid();

export const timeRange = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export function resolveRange(input: { from?: string; to?: string }): {
  from: Date;
  to: Date;
} {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new HttpError(400, 'invalid from/to timestamp');
  }
  if (from > to) throw new HttpError(400, 'from must be before to');
  return { from, to };
}
