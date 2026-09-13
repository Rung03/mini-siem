// แปลง log CrowdStrike Falcon (audit และ detection)

import type { CanonicalEvent, Outcome, Parser } from '../schema.js';
import { blankEvent, unparsed } from '../schema.js';
import {
  coerceDate,
  coerceInt,
  coerceIp,
  coerceString,
  isPlainObject,
  looksLikeEnvelope,
  parseEnvelope,
  pick,
  tryJson,
} from '../util.js';

const SEVERITY_BY_NAME: Record<string, number> = {
  critical: 10,
  high: 8,
  medium: 5,
  low: 3,
  informational: 1,
};

function auditOutcome(event: Record<string, unknown>): Outcome {
  const success = event.Success;
  if (success === true || success === 'true') return 'success';
  if (success === false || success === 'false') return 'failure';

  const op = coerceString(event.OperationName)?.toLowerCase() ?? '';
  if (op.includes('fail')) return 'failure';
  if (op.includes('authenticate') || op.includes('login')) return 'success';
  return 'unknown';
}

function auditKeyValues(event: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const list = event.AuditKeyValues;
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    if (!isPlainObject(entry)) continue;
    const key = coerceString(entry.Key);
    const value = coerceString(entry.ValueString ?? entry.Value);
    if (key && value) out[key] = value;
  }
  return out;
}

export const parseCrowdstrike: Parser = (input): CanonicalEvent => {
  const json = input.json ?? tryJson(input.raw);
  if (!isPlainObject(json)) {
    return unparsed('crowdstrike', input, 'payload is not a JSON object');
  }

  if (looksLikeEnvelope(json)) {
    const base = parseEnvelope('crowdstrike', input, json);
    base.source = 'crowdstrike';
    base.vendor = 'CrowdStrike';
    base.product = 'Falcon';
    if ((base.eventType ?? '').toLowerCase().includes('malware') || base.action === 'alert') {
      base.eventCategory = 'detection';
    }
    return base;
  }

  const eventType = coerceString(pick(json, 'metadata', 'eventType'));
  const inner = isPlainObject(json.event) ? json.event : json;
  const metaTime =
    coerceDate(pick(json, 'metadata', 'eventCreationTime')) ??
    coerceDate(pick(json, 'metadata', 'eventCreationTimeString'));

  const event = blankEvent('crowdstrike', input);
  event.source = 'crowdstrike';
  event.vendor = 'CrowdStrike';
  event.product = 'Falcon';

  if (eventType === 'DetectionSummaryEvent' || inner.DetectName || inner.SeverityName) {
    const severityName = coerceString(inner.SeverityName)?.toLowerCase();

    event.ts = metaTime ?? coerceDate(inner.ProcessStartTime) ?? input.receivedAt;
    event.eventCategory = 'detection';
    event.eventType = coerceString(inner.DetectName) ?? 'detection';
    event.eventSubtype = coerceString(inner.Tactic);
    event.action = 'alert';
    event.eventAction = coerceString(inner.PatternDispositionDescription) ?? 'alert';
    event.eventOutcome = 'unknown';
    event.severity =
      (severityName ? SEVERITY_BY_NAME[severityName] : undefined) ??
      coerceInt(inner.Severity) ??
      5;
    event.userName = coerceString(inner.UserName);
    event.host = coerceString(inner.ComputerName ?? inner.Hostname);
    event.process = coerceString(inner.FileName ?? inner.ImageFileName);
    event.srcIp = coerceIp(inner.LocalIP ?? inner.ExternalIP);
    event.message =
      coerceString(inner.DetectDescription) ??
      `${coerceString(inner.DetectName) ?? 'Detection'} on ${
        coerceString(inner.ComputerName) ?? 'unknown host'
      }`;
    event.attrs = {
      event_type: eventType,
      tactic: coerceString(inner.Tactic),
      technique: coerceString(inner.Technique),
      severity_name: coerceString(inner.SeverityName),
      sha256: coerceString(inner.SHA256String),
    };
    return event;
  }

  if (eventType === 'UserActivityAuditEvent' || inner.OperationName) {
    const outcome = auditOutcome(inner);
    const kv = auditKeyValues(inner);
    const operation = coerceString(inner.OperationName);
    const isLogin = (operation ?? '').toLowerCase().includes('authenticate');

    event.ts = metaTime ?? coerceDate(inner.UTCTimestamp) ?? input.receivedAt;
    event.eventCategory = isLogin ? 'authentication' : 'audit';
    event.eventType = operation ?? 'audit';
    event.action = isLogin ? 'login' : (operation ?? null);
    event.eventAction = event.action;
    event.eventOutcome = outcome;
    event.severity = outcome === 'failure' ? 6 : 2;
    event.userName = coerceString(inner.UserId ?? inner.UserName);
    event.srcIp = coerceIp(inner.UserIp ?? kv.user_ip);
    event.host = coerceString(inner.ServiceName) ?? 'falcon-console';
    event.message =
      `${operation ?? 'Falcon audit'} — ${outcome}` +
      (kv.trace_id ? ` (trace ${kv.trace_id})` : '');
    event.attrs = { event_type: eventType, operation, ...kv };
    return event;
  }

  return unparsed('crowdstrike', input, `unhandled eventType: ${eventType ?? 'none'}`);
};
