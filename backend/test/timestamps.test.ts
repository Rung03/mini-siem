// เทสต์การขยับเวลาของ log ตัวอย่างที่เก่ากว่า retention ตอนรับเข้า

import { describe, expect, it } from 'vitest';
import { rebaseStaleTimestamps, SHIFTED_TAG, timeSpan } from '../src/ingest/timestamps.js';
import { normalize } from '../src/normalize/index.js';

const now = new Date('2026-09-13T08:00:00Z');

function eventAt(iso: string) {
  return normalize('generic', {
    raw: JSON.stringify({ user: 'alice', action: 'login', result: 'failed', '@timestamp': iso }),
    receivedAt: now,
  });
}

describe('rebasing stale timestamps', () => {
  it('moves a batch older than retention to now and keeps the spacing between events', () => {
    const events = [eventAt('2025-08-20T09:10:00Z'), eventAt('2025-08-20T09:15:00Z')];

    const shift = rebaseStaleTimestamps(events, { now, retentionDays: 7 });

    expect(shift).toBeGreaterThan(0);
    expect(events[1]!.ts).toEqual(now);
    expect(events[0]!.ts).toEqual(new Date(now.getTime() - 5 * 60_000));
    expect(events[0]!.attrs.original_ts).toBe('2025-08-20T09:10:00.000Z');
    expect(events[0]!.tags).toContain(SHIFTED_TAG);
    expect(events[0]!.raw).toContain('2025-08-20T09:10:00Z');
  });

  it('leaves events inside the retention window untouched', () => {
    const events = [eventAt('2026-09-10T08:00:00Z')];

    expect(rebaseStaleTimestamps(events, { now, retentionDays: 7 })).toBe(0);
    expect(events[0]!.ts).toEqual(new Date('2026-09-10T08:00:00Z'));
    expect(events[0]!.attrs.original_ts).toBeUndefined();
    expect(events[0]!.tags ?? []).not.toContain(SHIFTED_TAG);
  });

  it('does not shift a batch whose newest event is recent, even if older ones are stale', () => {
    const events = [eventAt('2025-08-20T09:10:00Z'), eventAt('2026-09-13T07:59:00Z')];
    expect(rebaseStaleTimestamps(events, { now, retentionDays: 7 })).toBe(0);
  });

  it('handles an empty batch', () => {
    expect(rebaseStaleTimestamps([], { now, retentionDays: 7 })).toBe(0);
    expect(timeSpan([])).toEqual({ first: null, last: null });
  });

  it('reports the stored time span', () => {
    const events = [eventAt('2026-09-13T07:00:00Z'), eventAt('2026-09-13T06:00:00Z')];
    expect(timeSpan(events)).toEqual({
      first: '2026-09-13T06:00:00.000Z',
      last: '2026-09-13T07:00:00.000Z',
    });
  });
});
