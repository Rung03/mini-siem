// จำกัดจำนวนคำขอต่อ key ในหน้าต่างเวลา และล็อกบัญชีชั่วคราวเมื่อล็อกอินผิดซ้ำ (เก็บในหน่วยความจำ)

import type { NextFunction, Request, Response } from 'express';
import { rateLimited } from '../observability/metrics.js';

export interface Decision {
  allowed: boolean;
  retryAfterSeconds: number;
}

function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

function evictOldest<V>(map: Map<string, V>, maxKeys: number, expired: (v: V) => boolean): void {
  if (map.size < maxKeys) return;
  for (const [k, v] of map) if (expired(v)) map.delete(k);
  while (map.size >= maxKeys) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  consume(key: string, now = Date.now()): Decision {
    if (this.limit <= 0) return { allowed: true, retryAfterSeconds: 0 };

    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.delete(key);
      evictOldest(this.windows, this.maxKeys, (v) => v.resetAt <= now);
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }

    w.count++;
    if (w.count <= this.limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: secondsUntil(w.resetAt, now) };
  }
}

export class LoginLockout {
  private readonly entries = new Map<
    string,
    { failures: number; windowEndsAt: number; lockedUntil: number }
  >();

  constructor(
    readonly threshold: number,
    readonly windowMs: number,
    readonly lockMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  retryAfter(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    return e && e.lockedUntil > now ? secondsUntil(e.lockedUntil, now) : 0;
  }

  recordFailure(key: string, now = Date.now()): void {
    if (this.threshold <= 0) return;

    let e = this.entries.get(key);
    if (!e || (e.windowEndsAt <= now && e.lockedUntil <= now)) {
      this.entries.delete(key);
      evictOldest(this.entries, this.maxKeys, (v) => v.windowEndsAt <= now && v.lockedUntil <= now);
      e = { failures: 0, windowEndsAt: now + this.windowMs, lockedUntil: 0 };
      this.entries.set(key, e);
    }

    e.failures++;
    if (e.failures >= this.threshold) {
      e.lockedUntil = now + this.lockMs;
      e.failures = 0;
      e.windowEndsAt = now + this.windowMs;
    }
  }

  clear(key: string): void {
    this.entries.delete(key);
  }
}

export function limitRequests(
  limiter: FixedWindowLimiter,
  scope: string,
  keyOf: (req: Request) => string | null,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyOf(req);
    if (key === null) {
      next();
      return;
    }

    const decision = limiter.consume(`${scope}:${key}`);
    if (decision.allowed) {
      next();
      return;
    }

    rateLimited.inc({ scope });
    res.setHeader('Retry-After', String(decision.retryAfterSeconds));
    res.status(429).json({
      error: 'too many requests',
      retry_after_seconds: decision.retryAfterSeconds,
    });
  };
}
