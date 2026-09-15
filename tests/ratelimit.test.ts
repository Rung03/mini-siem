// เทสต์ตัวจำกัดจำนวนคำขอและการล็อกบัญชีเมื่อล็อกอินผิดซ้ำ

import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter, LoginLockout } from '../backend/src/api/ratelimit.js';

const MINUTE = 60_000;

describe('fixed window rate limit', () => {
  it('allows up to the limit, then refuses until the window resets', () => {
    const limiter = new FixedWindowLimiter(3, MINUTE);
    const t0 = 1_000_000;

    expect([0, 1, 2].map(() => limiter.consume('203.0.113.9', t0).allowed)).toEqual([
      true,
      true,
      true,
    ]);

    const refused = limiter.consume('203.0.113.9', t0 + 1_000);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(59);

    expect(limiter.consume('203.0.113.9', t0 + MINUTE).allowed).toBe(true);
  });

  it('counts each key separately', () => {
    const limiter = new FixedWindowLimiter(1, MINUTE);
    expect(limiter.consume('a', 0).allowed).toBe(true);
    expect(limiter.consume('a', 0).allowed).toBe(false);
    expect(limiter.consume('b', 0).allowed).toBe(true);
  });

  it('is switched off by a limit of 0', () => {
    const limiter = new FixedWindowLimiter(0, MINUTE);
    for (let i = 0; i < 100; i++) expect(limiter.consume('a', 0).allowed).toBe(true);
  });

  it('stays bounded when a flood of distinct addresses arrives', () => {
    const limiter = new FixedWindowLimiter(1, MINUTE, 100);
    for (let i = 0; i < 1_000; i++) limiter.consume(`10.0.${i >> 8}.${i & 255}`, 0);
    const size = (limiter as unknown as { windows: Map<string, unknown> }).windows.size;
    expect(size).toBeLessThanOrEqual(100);
  });
});

describe('login lockout', () => {
  const lockMs = 15 * MINUTE;

  it('locks an account once the failure threshold is reached, then releases it', () => {
    const lockout = new LoginLockout(5, lockMs, lockMs);

    for (let i = 0; i < 4; i++) lockout.recordFailure('admin@siem.local', i);
    expect(lockout.retryAfter('admin@siem.local', 5)).toBe(0);

    lockout.recordFailure('admin@siem.local', 10);
    expect(lockout.retryAfter('admin@siem.local', 11)).toBe(900);
    expect(lockout.retryAfter('viewer@contoso.local', 11)).toBe(0);

    expect(lockout.retryAfter('admin@siem.local', 10 + lockMs)).toBe(0);
  });

  it('forgets failures older than the window', () => {
    const lockout = new LoginLockout(3, MINUTE, lockMs);
    lockout.recordFailure('a@x', 0);
    lockout.recordFailure('a@x', 1);
    lockout.recordFailure('a@x', MINUTE + 1);
    expect(lockout.retryAfter('a@x', MINUTE + 2)).toBe(0);
  });

  it('starts from zero after a successful sign-in', () => {
    const lockout = new LoginLockout(3, MINUTE, lockMs);
    lockout.recordFailure('a@x', 0);
    lockout.recordFailure('a@x', 1);
    lockout.clear('a@x');
    lockout.recordFailure('a@x', 2);
    expect(lockout.retryAfter('a@x', 3)).toBe(0);
  });

  it('is switched off by a threshold of 0', () => {
    const lockout = new LoginLockout(0, MINUTE, lockMs);
    for (let i = 0; i < 50; i++) lockout.recordFailure('a@x', i);
    expect(lockout.retryAfter('a@x', 60)).toBe(0);
  });
});
