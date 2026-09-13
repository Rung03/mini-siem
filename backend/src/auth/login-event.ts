// สร้าง event ของการล็อกอินหน้าเว็บ (ไม่มีรหัสผ่านอยู่ใน event)

import type { CanonicalEvent } from '../normalize/schema.js';
import { blankEvent } from '../normalize/schema.js';

export type LoginOutcome = 'success' | 'bad_password' | 'unknown_user' | 'inactive_user';

export interface LoginAttempt {
  email: string;
  outcome: LoginOutcome;
  role: string | null;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}

export function buildLoginEvent(attempt: LoginAttempt): CanonicalEvent {
  const succeeded = attempt.outcome === 'success';
  const email = attempt.email.trim().toLowerCase().slice(0, 320);
  const userAgent = attempt.userAgent?.slice(0, 512) ?? null;

  const record = {
    email,
    outcome: attempt.outcome,
    role: attempt.role,
    ip: attempt.ip,
    user_agent: userAgent,
    at: attempt.at.toISOString(),
  };

  const event = blankEvent('generic', {
    raw: JSON.stringify(record),
    receivedAt: attempt.at,
    peerIp: attempt.ip,
  });

  event.ts = attempt.at;
  event.source = 'api';
  event.vendor = 'Mini SIEM';
  event.product = 'web';
  event.eventType = succeeded ? 'web_login' : 'web_login_failed';
  event.eventCategory = 'authentication';
  event.eventAction = 'login';
  event.action = 'login';
  event.eventOutcome = succeeded ? 'success' : 'failure';
  event.severity = succeeded ? 2 : 6;
  event.userName = email;
  event.host = 'mini-siem-web';
  event.message = succeeded
    ? `web login succeeded for ${email}`
    : `web login failed for ${email} (${attempt.outcome})`;
  event.attrs = { reason: attempt.outcome, role: attempt.role, user_agent: userAgent };

  return event;
}
