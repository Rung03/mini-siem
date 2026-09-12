import { isIP } from 'node:net';
import type { CanonicalEvent, Outcome, ParserInput, Source, SourceType } from './schema.js';
import { SOURCES, blankEvent } from './schema.js';

export function parseKeyValue(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z0-9_.-]+)=("([^"]*)"|'([^']*)'|([^\s]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const key = m[1]!;
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    out[key] = value;
  }
  return out;
}

export function coerceIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let v = value.trim();
  if (!v || v === '-' || v.toLowerCase() === 'null') return null;

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped) v = mapped[1]!;

  if (isIP(v) === 0 && v.includes(':') && v.split(':').length === 2) {
    v = v.split(':')[0]!;
  }

  const wrapped = /\(([^)]+)\)/.exec(v);
  if (isIP(v) === 0 && wrapped && isIP(wrapped[1]!.trim()) !== 0) {
    v = wrapped[1]!.trim();
  }

  return isIP(v) === 0 ? null : v;
}

export function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e11 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return coerceDate(Number(s));

    const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s);
    const d = new Date(naive ? `${s.replace(' ', 'T')}Z` : s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export function coerceString(value: unknown): string | null {
  if (typeof value === 'string') {
    const v = value.trim();
    return v && v !== '-' ? v : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function coerceInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(coerceString(value));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

const SEVERITY_WORDS: Record<string, number> = {
  emergency: 10,
  emerg: 10,
  alert: 10,
  critical: 9,
  crit: 9,
  error: 8,
  err: 8,
  high: 8,
  warning: 6,
  warn: 6,
  medium: 5,
  notice: 4,
  low: 3,
  information: 2,
  informational: 2,
  info: 2,
  debug: 1,
};

export function fromSyslogSeverity(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(7, Math.trunc(n)));
  return Math.round(10 - (clamped * 9) / 7);
}

export function normalizeSeverity(value: unknown): number | null {
  const s = coerceString(value);
  if (s === null) return null;

  const word = SEVERITY_WORDS[s.toLowerCase()];
  if (word !== undefined) return word;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.trunc(n)));
}

export function pick(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface SyslogFrame {
  facility: number | null;
  severity: number | null;
  ts: Date | null;
  host: string | null;
  tag: string | null;
  message: string;
}

export function stripSyslogHeader(line: string): SyslogFrame {
  const frame: SyslogFrame = {
    facility: null,
    severity: null,
    ts: null,
    host: null,
    tag: null,
    message: line,
  };

  let rest = line;

  const pri = /^<(\d{1,3})>/.exec(rest);
  if (pri) {
    const value = Number(pri[1]);
    frame.facility = Math.floor(value / 8);
    frame.severity = value % 8;
    rest = rest.slice(pri[0].length);
  }

  const rfc5424 =
    /^1\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(-|\[.*?\])\s?([\s\S]*)$/.exec(rest);
  if (rfc5424) {
    frame.ts = coerceDate(rfc5424[1]);
    frame.host = rfc5424[2] === '-' ? null : rfc5424[2]!;
    frame.tag = rfc5424[3] === '-' ? null : rfc5424[3]!;
    frame.message = rfc5424[7] ?? '';
    return frame;
  }

  const rfc3164 = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([\s\S]*)$/.exec(rest);
  if (rfc3164) {
    const now = new Date();
    const guess = new Date(`${rfc3164[1]} ${now.getUTCFullYear()} UTC`);
    if (!Number.isNaN(guess.getTime())) {
      if (guess.getTime() - now.getTime() > 86_400_000) {
        guess.setUTCFullYear(guess.getUTCFullYear() - 1);
      }
      frame.ts = guess;
    }
    frame.host = rfc3164[2]!;

    const body = rfc3164[3]!;
    const tagged = /^([A-Za-z0-9_\/.-]+)(\[\d+\])?:\s*([\s\S]*)$/.exec(body);
    if (tagged) {
      frame.tag = tagged[1]!;
      frame.message = tagged[3] ?? '';
    } else {
      frame.message = body;
    }
    return frame;
  }

  frame.message = rest;
  return frame;
}

export function tryJson(text: string): unknown | undefined {
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

const ACTION_BY_KEYWORD: [RegExp, string][] = [
  [/logg?ed[\s_-]*out|log[\s_-]*off|sign(?:ed)?[\s_-]*out|logout/i, 'logout'],
  [/logg?ed[\s_-]*in|log[\s_-]*on|sign(?:ed)?[\s_-]*in|login|authenticat/i, 'login'],
  [/create|add|provision/i, 'create'],
  [/delete|remove|deprovision/i, 'delete'],
  [/deny|block|quarantine|reject|drop/i, 'deny'],
  [/allow|permit|accept/i, 'allow'],
  [/detect|malware|alert|threat/i, 'alert'],
];

function inferAction(...hints: (string | null | undefined)[]): string | null {
  const text = hints.filter(Boolean).join(' ');
  if (!text) return null;
  for (const [re, action] of ACTION_BY_KEYWORD) {
    if (re.test(text)) return action;
  }
  return null;
}

function inferOutcome(...hints: (string | null | undefined)[]): Outcome {
  const text = hints.filter(Boolean).join(' ').toLowerCase();
  if (!text) return 'unknown';
  if (/fail|denied|deny|error|invalid|blocked|lockout/.test(text)) return 'failure';
  if (/success|succeeded|accept|allow|granted|loggedin|logged_in/.test(text)) return 'success';
  return 'unknown';
}

function asSource(value: unknown): Source | null {
  const s = coerceString(value)?.toLowerCase();
  if (!s) return null;
  return (SOURCES as readonly string[]).includes(s) ? (s as Source) : null;
}

export function looksLikeEnvelope(json: unknown): boolean {
  if (!isPlainObject(json)) return false;
  const hasTime = '@timestamp' in json;
  const hasShape = 'event_type' in json || ('source' in json && 'tenant' in json);
  return hasTime && hasShape;
}

export function parseEnvelope(
  sourceType: SourceType,
  input: ParserInput,
  json: Record<string, unknown>,
): CanonicalEvent {
  const event = blankEvent(sourceType, input);

  const eventType = coerceString(json.event_type);
  const status = coerceString(json.status ?? json.result ?? json.outcome);
  const explicitAction = coerceString(json.action);

  event.ts = coerceDate(json['@timestamp'] ?? json.timestamp ?? json.time) ?? input.receivedAt;
  event.source = asSource(json.source);
  event.vendor = coerceString(json.vendor);
  event.product = coerceString(json.product);
  event.eventType = eventType;
  event.eventSubtype = coerceString(json.event_subtype);
  event.action = explicitAction ?? inferAction(eventType, coerceString(json.event_subtype));
  event.eventAction = event.action;
  event.eventOutcome = inferOutcome(status, eventType, coerceString(json.reason));

  event.eventCategory =
    event.action === 'login' || event.action === 'logout' ? 'authentication'
    : event.action === 'alert' ? 'detection'
    : 'audit';

  const rawSeverity = json.severity;
  event.severity =
    typeof rawSeverity === 'number'
      ? Math.max(0, Math.min(10, Math.trunc(rawSeverity)))
      : (normalizeSeverity(rawSeverity) ?? (event.eventOutcome === 'failure' ? 6 : 2));

  event.userName = coerceString(json.user ?? json.username ?? json.user_name);
  event.host = coerceString(json.host ?? json.hostname ?? json.computer);
  event.process = coerceString(json.process);

  event.srcIp = coerceIp(json.ip ?? json.src_ip ?? json.src ?? json.source_ip) ?? input.peerIp ?? null;
  event.srcPort = coerceInt(json.src_port ?? json.spt);
  event.dstIp = coerceIp(json.dst_ip ?? json.dst ?? json.dest_ip);
  event.dstPort = coerceInt(json.dst_port ?? json.dpt);
  event.protocol = coerceString(json.protocol ?? json.proto);

  event.url = coerceString(json.url);
  event.httpMethod = coerceString(json.http_method);
  event.statusCode = coerceInt(json.status_code);

  event.ruleName = coerceString(json.rule_name ?? json.policy);
  event.ruleId = coerceString(json.rule_id);

  event.cloudAccountId = coerceString(pick(json, 'cloud', 'account_id') ?? json.cloud_account_id);
  event.cloudRegion = coerceString(pick(json, 'cloud', 'region') ?? json.cloud_region);
  event.cloudService = coerceString(pick(json, 'cloud', 'service') ?? json.cloud_service);

  const tags = json._tags ?? json.tags;
  event.tags = Array.isArray(tags)
    ? tags.map((t) => String(t)).filter((t) => t.length > 0)
    : null;

  const described = [
    eventType,
    event.userName ? `for ${event.userName}` : null,
    status ? `- ${status}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  event.message = coerceString(json.message ?? json.msg) ?? (described || null);

  const claimed = coerceString(json.tenant);
  const known = new Set([
    '@timestamp', 'timestamp', 'time', 'tenant', 'source', 'vendor', 'product',
    'event_type', 'event_subtype', 'action', 'status', 'result', 'outcome',
    'severity', 'user', 'username', 'user_name', 'host', 'hostname', 'computer',
    'process', 'ip', 'src_ip', 'src', 'source_ip', 'src_port', 'spt', 'dst_ip',
    'dst', 'dest_ip', 'dst_port', 'dpt', 'protocol', 'proto', 'url',
    'http_method', 'status_code', 'rule_name', 'policy', 'rule_id', 'cloud',
    'cloud_account_id', 'cloud_region', 'cloud_service', '_tags', 'tags',
    'message', 'msg',
  ]);
  for (const [k, v] of Object.entries(json)) {
    if (!known.has(k)) event.attrs[k] = v;
  }
  if (claimed) {
    event.attrs.claimed_tenant = claimed;
  }

  return event;
}
