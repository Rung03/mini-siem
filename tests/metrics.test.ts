// เทสต์รูปแบบข้อความ Prometheus ของ /api/metrics

import { describe, expect, it } from 'vitest';
import { Counter, registerGauge, renderMetrics } from '../backend/src/observability/metrics.js';

describe('metrics exposition', () => {
  it('renders counters with sorted and escaped labels', () => {
    const c = new Counter('test_requests_total', 'Test counter');
    c.inc({ scope: 'login' });
    c.inc({ scope: 'login' }, 2);
    c.inc({ z: 'a"b', a: 'x' });

    const text = renderMetrics();
    expect(text).toContain('# TYPE test_requests_total counter');
    expect(text).toContain('test_requests_total{scope="login"} 3');
    expect(text).toContain('test_requests_total{a="x",z="a\\"b"} 1');
  });

  it('reports 0 for a counter that never moved, and ignores non-positive increments', () => {
    const c = new Counter('test_idle_total', 'Idle counter');
    c.inc({}, 0);
    c.inc({}, -1);
    c.inc({}, Number.NaN);
    expect(c.value()).toBe(0);
    expect(renderMetrics()).toContain('test_idle_total 0');
  });

  it('renders gauges and skips one whose reader throws', () => {
    registerGauge('test_gauge', 'Test gauge', () => 42);
    registerGauge('test_broken_gauge', 'Broken gauge', () => {
      throw new Error('unavailable');
    });

    const text = renderMetrics();
    expect(text).toContain('# TYPE test_gauge gauge');
    expect(text).toContain('test_gauge 42');
    expect(text).not.toContain('test_broken_gauge');
    expect(text.endsWith('\n')).toBe(true);
  });
});
