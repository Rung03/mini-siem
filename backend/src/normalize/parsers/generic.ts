import type { CanonicalEvent, Outcome, Parser, ParserInput } from '../schema.js';
import { blankEvent } from '../schema.js';
import {
  coerceDate,
  coerceInt,
  coerceIp,
  coerceString,
  fromSyslogSeverity,
  isPlainObject,
  looksLikeEnvelope,
  normalizeSeverity,
  parseEnvelope,
  parseKeyValue,
  stripSyslogHeader,
  tryJson,
} from '../util.js';

/**
 * The catch-all: plain syslog from anything that is not one of the named
 * products, plus JSON from in-house applications.
 *
 * It still tries hard on the login story, because in practice the most common
 * thing on this channel is sshd:
 *
 *   Failed password for invalid user admin from 203.0.113.66 port 52344 ssh2
 *   Accepted password for jsmith from 10.0.0.5 port 51234 ssh2
 *
 * Nothing here ever returns parseOk false. A line that matches no pattern is
 * still a real event with its raw text intact — this channel exists precisely
 * for payloads whose shape we do not know in advance.
 */

interface LoginHint {
  outcome: Outcome;
  user: string | null;
  ip: string | null;
  port: number | null;
}

const PATTERNS: { re: RegExp; outcome: Outcome }[] = [
  {
    re: /(?:Failed|Invalid) (?:password|publickey)(?: for)?(?: invalid user)? (\S+) from (\S+)/i,
    outcome: 'failure',
  },
  {
    re: /Accepted (?:password|publickey|keyboard-interactive)(?: for)? (\S+) from (\S+)/i,
    outcome: 'success',
  },
  {
    re: /authentication failure.*?(?:ruser|user)=(\S+).*?rhost=(\S+)/i,
    outcome: 'failure',
  },
  {
    re: /session opened for user (\S+)(?:.*?from (\S+))?/i,
    outcome: 'success',
  },
];

function sniffLogin(message: string): LoginHint | null {
  const port = /\bport (\d{1,5})\b/i.exec(message);
  const portNumber = port ? Number(port[1]) : null;

  for (const p of PATTERNS) {
    const m = p.re.exec(message);
    if (m) {
      return { outcome: p.outcome, user: m[1] ?? null, ip: coerceIp(m[2]), port: portNumber };
    }
  }

  // "Invalid user admin from 203.0.113.44" — no password attempt, still a probe.
  const probe = /Invalid user (\S+) from (\S+)/i.exec(message);
  if (probe) {
    return { outcome: 'failure', user: probe[1]!, ip: coerceIp(probe[2]), port: portNumber };
  }
  return null;
}

/** An application shipping its own JSON, in whatever field spelling it likes. */
function fromJson(o: Record<string, unknown>, input: ParserInput): CanonicalEvent {
  const event = blankEvent('generic', input);

  const outcomeRaw = coerceString(
    o.outcome ?? o.result ?? o.status ?? o.event_outcome,
  )?.toLowerCase();
  const outcome: Outcome =
    outcomeRaw === 'success' || outcomeRaw === 'ok' || outcomeRaw === 'succeeded'
      ? 'success'
      : outcomeRaw === 'failure' || outcomeRaw === 'failed' || outcomeRaw === 'error'
        ? 'failure'
        : 'unknown';

  const action = coerceString(o.action ?? o.event) ?? 'login';

  event.ts = coerceDate(o.timestamp ?? o.time ?? o.ts ?? o['@timestamp']) ?? input.receivedAt;
  event.source = 'api';
  event.vendor = coerceString(o.vendor);
  event.product = coerceString(o.product ?? o.app ?? o.application);
  event.eventType = coerceString(o.event_type ?? o.event) ?? action;
  event.action = action;
  event.eventAction = action;
  event.eventOutcome = outcome;
  event.eventCategory =
    coerceString(o.category) ?? (action === 'login' ? 'authentication' : 'audit');
  event.severity = normalizeSeverity(o.severity ?? o.level) ?? (outcome === 'failure' ? 6 : 2);

  event.userName = coerceString(o.user ?? o.username ?? o.user_name ?? o.account);
  event.host = coerceString(o.host ?? o.hostname);
  event.srcIp =
    coerceIp(o.ip ?? o.src_ip ?? o.source_ip ?? o.client_ip ?? o.remote_addr) ??
    input.peerIp ??
    null;
  event.srcPort = coerceInt(o.src_port);
  event.dstIp = coerceIp(o.dst_ip ?? o.dest_ip);
  event.dstPort = coerceInt(o.dst_port);
  event.protocol = coerceString(o.protocol ?? o.proto);
  event.url = coerceString(o.url ?? o.path);
  event.httpMethod = coerceString(o.http_method ?? o.method);
  event.statusCode = coerceInt(o.status_code);
  event.message = coerceString(o.message ?? o.msg) ?? `${action} ${outcome}`;

  const known = new Set([
    'timestamp', 'time', 'ts', '@timestamp', 'outcome', 'result', 'status',
    'event_outcome', 'user', 'username', 'user_name', 'account', 'ip',
    'src_ip', 'source_ip', 'client_ip', 'remote_addr', 'host', 'hostname',
    'message', 'msg', 'action', 'event', 'event_type', 'severity', 'level',
    'category', 'vendor', 'product', 'app', 'application', 'src_port',
    'dst_ip', 'dest_ip', 'dst_port', 'protocol', 'proto', 'url', 'path',
    'http_method', 'method', 'status_code',
  ]);
  for (const [k, v] of Object.entries(o)) {
    if (!known.has(k.toLowerCase())) event.attrs[k] = v;
  }

  return event;
}

export const parseGeneric: Parser = (input): CanonicalEvent => {
  const json = input.json ?? tryJson(input.raw);

  // The half-normalized shape from the assignment's API sample.
  if (looksLikeEnvelope(json)) {
    const event = parseEnvelope('generic', input, json as Record<string, unknown>);
    event.source ??= 'api';
    return event;
  }
  if (isPlainObject(json)) return fromJson(json, input);

  const frame = stripSyslogHeader(input.raw);
  const event = blankEvent('generic', input);
  const hint = sniffLogin(frame.message);
  const kv = parseKeyValue(frame.message);

  event.ts = frame.ts ?? input.receivedAt;
  event.host = frame.host;
  event.severity = fromSyslogSeverity(frame.severity) ?? (hint?.outcome === 'failure' ? 6 : 2);

  if (hint) {
    // sshd and friends: this is the login story on a plain syslog channel.
    event.source = 'network';
    event.eventCategory = 'authentication';
    event.eventType = hint.outcome === 'failure' ? 'login_failed' : 'login_succeeded';
    event.action = 'login';
    event.eventAction = 'login';
    event.eventOutcome = hint.outcome;
    event.userName = hint.user;
    event.srcIp = hint.ip ?? input.peerIp ?? null;
    event.srcPort = hint.port;
  } else {
    // Device syslog such as the router sample: if=ge-0/0/1 event=link-down
    event.source = 'network';
    event.eventCategory = 'system';
    event.eventType = coerceString(kv.event) ?? frame.tag ?? 'log';
    event.action = null;
    event.eventAction = event.eventType;
    event.srcIp = coerceIp(kv.src) ?? input.peerIp ?? null;
    event.dstIp = coerceIp(kv.dst);
    event.protocol = coerceString(kv.proto ?? kv.protocol);
    if (kv.reason) event.attrs.reason = kv.reason;
    if (kv.if) event.attrs.interface = kv.if;
    if (kv.mac) event.attrs.mac = kv.mac;
  }

  if (frame.tag) event.attrs.program = frame.tag;
  if (frame.facility !== null) event.attrs.syslog_facility = frame.facility;
  if (frame.severity !== null) event.attrs.syslog_severity = frame.severity;

  event.message = frame.message.slice(0, 1000);
  return event;
};
