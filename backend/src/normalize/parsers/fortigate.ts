// แปลง log firewall แบบ key=value (FortiGate และรูปแบบทั่วไป)

import type { CanonicalEvent, Outcome, Parser } from '../schema.js';
import { blankEvent, unparsed } from '../schema.js';
import {
  coerceDate,
  coerceInt,
  coerceIp,
  coerceString,
  fromSyslogSeverity,
  normalizeSeverity,
  parseKeyValue,
  stripSyslogHeader,
} from '../util.js';

const SUCCESS = new Set(['success', 'succeeded', 'accept', 'ok', 'allow', 'permit']);
const FAILURE = new Set(['failed', 'failure', 'denied', 'deny', 'blocked', 'drop']);

function outcomeOf(kv: Record<string, string>): Outcome {
  const status = (kv.status ?? '').toLowerCase();
  if (SUCCESS.has(status)) return 'success';
  if (FAILURE.has(status)) return 'failure';

  const action = (kv.action ?? '').toLowerCase();
  if (SUCCESS.has(action)) return 'success';
  if (FAILURE.has(action)) return 'failure';

  const desc = `${kv.logdesc ?? ''} ${kv.msg ?? ''}`.toLowerCase();
  if (desc.includes('login failed') || desc.includes('authentication failed')) return 'failure';
  if (desc.includes('login successful') || desc.includes('logged in')) return 'success';
  return 'unknown';
}

function actionOf(kv: Record<string, string>): string | null {
  const raw = (kv.action ?? '').toLowerCase();
  if (SUCCESS.has(raw)) return raw === 'accept' || raw === 'permit' ? 'allow' : raw;
  if (FAILURE.has(raw)) return raw === 'drop' || raw === 'blocked' ? 'deny' : raw;
  if (raw === 'login' || raw === 'logout') return raw;

  const desc = `${kv.logdesc ?? ''} ${kv.msg ?? ''}`.toLowerCase();
  if (desc.includes('login')) return 'login';
  return raw || null;
}

export const parseFortigate: Parser = (input): CanonicalEvent => {
  const frame = stripSyslogHeader(input.raw);
  const kv = parseKeyValue(frame.message);

  if (Object.keys(kv).length === 0) {
    return unparsed('fortigate', input, 'no key=value pairs found');
  }

  const event = blankEvent('fortigate', input);

  event.ts =
    (kv.date && kv.time ? coerceDate(`${kv.date}T${kv.time}Z`) : null) ??
    (kv.eventtime ? coerceDate(Math.floor(Number(kv.eventtime) / 1e6)) : null) ??
    frame.ts ??
    input.receivedAt;

  const action = actionOf(kv);
  const outcome = outcomeOf(kv);

  event.source = 'firewall';
  event.vendor = coerceString(kv.vendor) ?? 'Fortinet';
  event.product = coerceString(kv.product) ?? 'FortiGate';
  event.eventType = coerceString(kv.logdesc) ?? coerceString(kv.type) ?? action;
  event.eventSubtype = coerceString(kv.subtype);
  event.action = action;
  event.eventAction = action;
  event.eventOutcome = outcome;
  event.eventCategory = action === 'login' || action === 'logout' ? 'authentication' : 'network';

  event.severity =
    normalizeSeverity(kv.level) ?? fromSyslogSeverity(frame.severity) ??
    (outcome === 'failure' ? 6 : 2);

  event.userName = coerceString(kv.user);
  event.host = coerceString(kv.devname) ?? frame.host;

  event.srcIp = coerceIp(kv.srcip ?? kv.src) ?? coerceIp(kv.ui) ?? input.peerIp ?? null;
  event.srcPort = coerceInt(kv.srcport ?? kv.spt);
  event.dstIp = coerceIp(kv.dstip ?? kv.dst);
  event.dstPort = coerceInt(kv.dstport ?? kv.dpt);
  event.protocol = coerceString(kv.proto ?? kv.protocol);

  event.url = coerceString(kv.url);
  event.httpMethod = coerceString(kv.method);
  event.statusCode = coerceInt(kv.status_code);

  event.ruleName = coerceString(kv.policy ?? kv.policyname ?? kv.rule_name);
  event.ruleId = coerceString(kv.policyid ?? kv.rule_id ?? kv.logid);

  event.message =
    coerceString(kv.msg) ??
    coerceString(kv.logdesc) ??
    frame.message.slice(0, 500);

  const {
    date, time, eventtime, level, user, srcip, src, dstip, dst, srcport, spt,
    dstport, dpt, proto, protocol, devname, action: _a, status, msg, logdesc,
    vendor, product, policy, policyid, subtype, type, url, method,
    ...extra
  } = kv;
  event.attrs = { status: coerceString(status), ...extra };

  return event;
};
