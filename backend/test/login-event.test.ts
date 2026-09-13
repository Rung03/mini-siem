// เทสต์ event ของการล็อกอินหน้าเว็บ

import { describe, expect, it } from 'vitest';
import { buildLoginEvent } from '../src/auth/login-event.js';

const at = new Date('2026-09-13T08:00:00Z');

describe('web login events', () => {
  it('records a wrong password as an authentication failure the brute-force rule can match', () => {
    const e = buildLoginEvent({
      email: 'Admin@SIEM.local',
      outcome: 'bad_password',
      role: 'admin',
      ip: '203.0.113.9',
      userAgent: 'curl/8.0',
      at,
    });

    expect(e.eventCategory).toBe('authentication');
    expect(e.eventOutcome).toBe('failure');
    expect(e.action).toBe('login');
    expect(e.eventType).toBe('web_login_failed');
    expect(e.source).toBe('api');
    expect(e.userName).toBe('admin@siem.local');
    expect(e.srcIp).toBe('203.0.113.9');
    expect(e.ts).toEqual(at);
    expect(e.attrs.reason).toBe('bad_password');
    expect(e.parseOk).toBe(true);
  });

  it('records a successful login', () => {
    const e = buildLoginEvent({
      email: 'viewer@northwind.local',
      outcome: 'success',
      role: 'viewer',
      ip: '10.0.0.5',
      userAgent: null,
      at,
    });

    expect(e.eventOutcome).toBe('success');
    expect(e.eventType).toBe('web_login');
    expect(e.severity).toBe(2);
  });

  it('records an attempt for an email that does not exist', () => {
    const e = buildLoginEvent({
      email: 'nobody@example.com',
      outcome: 'unknown_user',
      role: null,
      ip: '198.51.100.4',
      userAgent: null,
      at,
    });

    expect(e.eventOutcome).toBe('failure');
    expect(e.attrs.reason).toBe('unknown_user');
    expect(e.attrs.role).toBeNull();
  });

  it('keeps the raw payload free of any password field', () => {
    const e = buildLoginEvent({
      email: 'admin@siem.local',
      outcome: 'bad_password',
      role: 'admin',
      ip: '203.0.113.9',
      userAgent: 'x'.repeat(2000),
      at,
    });

    const raw = JSON.parse(e.raw) as Record<string, unknown>;
    expect(Object.keys(raw)).not.toContain('password');
    expect(String(raw.user_agent).length).toBe(512);
  });
});
