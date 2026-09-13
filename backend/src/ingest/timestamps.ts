// ขยับเวลาของ event ชุดที่เก่ากว่า retention มาไว้ที่ปัจจุบัน ไม่ให้ถูกลบทิ้งทันทีและมองเห็นบน dashboard

import type { CanonicalEvent } from '../normalize/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SHIFTED_TAG = 'timestamp-shifted';

export function rebaseStaleTimestamps(
  events: CanonicalEvent[],
  opts: { now: Date; retentionDays: number },
): number {
  let newest = -Infinity;
  for (const e of events) newest = Math.max(newest, e.ts.getTime());

  const now = opts.now.getTime();
  if (!Number.isFinite(newest) || now - newest <= opts.retentionDays * DAY_MS) return 0;

  const shift = now - newest;
  for (const e of events) {
    e.attrs = { ...e.attrs, original_ts: e.ts.toISOString() };
    e.ts = new Date(e.ts.getTime() + shift);
    const tags = e.tags ?? [];
    if (!tags.includes(SHIFTED_TAG)) e.tags = [...tags, SHIFTED_TAG];
  }
  return shift;
}

export function timeSpan(events: CanonicalEvent[]): { first: string | null; last: string | null } {
  let first = Infinity;
  let last = -Infinity;
  for (const e of events) {
    const t = e.ts.getTime();
    first = Math.min(first, t);
    last = Math.max(last, t);
  }
  return Number.isFinite(first)
    ? { first: new Date(first).toISOString(), last: new Date(last).toISOString() }
    : { first: null, last: null };
}
