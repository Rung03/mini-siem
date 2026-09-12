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
  stripSyslogHeader,
  tryJson,
} from '../util.js';

/**
 * Windows Security log, as forwarded by NXLog/WinLogbeat (JSON) or by an agent
 * that ships the rendered text.
 *
 * The three event ids that carry the login story:
 *   4624  an account was successfully logged on
 *   4625  an account failed to log on
 *   4634  an account was logged off
 */

const ACTIONS: Record<number, { action: string; outcome: Outcome; type: string }> = {
  4624: { action: 'login', outcome: 'success', type: 'LogonSuccess' },
  4625: { action: 'login', outcome: 'failure', type: 'LogonFailed' },
  4634: { action: 'logout', outcome: 'success', type: 'Logoff' },
  4647: { action: 'logout', outcome: 'success', type: 'Logoff' },
  4648: { action: 'login', outcome: 'success', type: 'LogonExplicit' },
  4768: { action: 'login', outcome: 'success', type: 'KerberosTGT' },
  4771: { action: 'login', outcome: 'failure', type: 'KerberosPreauthFailed' },
  4720: { action: 'create', outcome: 'success', type: 'UserCreated' },
  4726: { action: 'delete', outcome: 'success', type: 'UserDeleted' },
};

/** The sub-status codes an analyst actually wants to see spelled out. */
const STATUS_REASONS: Record<string, string> = {
  '0xc0000064': 'user name does not exist',
  '0xc000006a': 'wrong password',
  '0xc000006d': 'bad user name or password',
  '0xc000006e': 'account restriction',
  '0xc000006f': 'login outside permitted hours',
  '0xc0000070': 'login from unauthorised workstation',
  '0xc0000071': 'password expired',
  '0xc0000072': 'account disabled',
  '0xc0000234': 'account locked out',
  '0xc0000193': 'account expired',
};

const LOGON_TYPES: Record<number, string> = {
  2: 'interactive',
  3: 'network',
  4: 'batch',
  5: 'service',
  7: 'unlock',
  8: 'network-cleartext',
  10: 'remote-interactive',
  11: 'cached-interactive',
};

/** Pulls "Account Name:  jsmith" style pairs out of a rendered event body. */
function parseRenderedFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^[\t ]*([A-Za-z][A-Za-z ]+?):[\t ]+(.+?)[\t ]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // The rendered form repeats "Account Name" for subject and target; the
    // later occurrence is the account that actually tried to log on.
    out[m[1]!.trim()] = m[2]!.trim();
  }
  return out;
}

export const parseWindowsAd: Parser = (input): CanonicalEvent => {
  const frame = stripSyslogHeader(input.raw);
  const json = input.json ?? tryJson(frame.message) ?? tryJson(input.raw);

  const event = blankEvent('windows_ad', input);
  event.source = 'ad';
  event.vendor = 'Microsoft';
  event.product = 'Windows Security';

  let eventId: number | null = null;
  let logonType: number | null = null;
  let status: string | null = null;

  if (isPlainObject(json)) {
    const o = json;
    eventId = coerceInt(o.EventID ?? o.event_id ?? o.EventId);

    // The assignment's AD sample is the half-normalized shape rather than a
    // Windows event record; take its fields first, then overlay what the
    // event id tells us.
    if (looksLikeEnvelope(o)) {
      const base = parseEnvelope('windows_ad', input, o);
      base.source = 'ad';
      base.vendor = 'Microsoft';
      base.product = 'Windows Security';
      const known = eventId !== null ? ACTIONS[eventId] : undefined;
      if (known) {
        base.action = known.action;
        base.eventAction = known.action;
        base.eventOutcome = known.outcome;
        base.eventCategory = 'authentication';
        base.eventType ??= known.type;
      }
      const lt = coerceInt(o.logon_type);
      if (lt !== null) {
        base.attrs.logon_type = lt;
        base.attrs.logon_type_name = LOGON_TYPES[lt] ?? String(lt);
      }
      if (eventId !== null) base.attrs.event_id = eventId;
      if (base.userName?.includes('\\')) {
        const [domain, name] = base.userName.split('\\');
        base.attrs.domain = domain;
        base.userName = name ?? base.userName;
      }
      return base;
    }

    event.userName = coerceString(o.TargetUserName ?? o.target_user_name ?? o.SubjectUserName);
    event.srcIp =
      coerceIp(o.IpAddress ?? o.ip_address ?? o.SourceNetworkAddress ?? o.ip) ??
      input.peerIp ??
      null;
    event.srcPort = coerceInt(o.IpPort ?? o.ip_port);
    event.host = coerceString(o.Computer ?? o.Hostname ?? o.computer ?? o.host);
    event.ts = coerceDate(o.TimeCreated ?? o.EventTime ?? o['@timestamp']) ?? frame.ts ??
      input.receivedAt;
    logonType = coerceInt(o.LogonType ?? o.logon_type);
    status = coerceString(o.SubStatus ?? o.Status)?.toLowerCase() ?? null;
    event.message = coerceString(o.Message);
    event.process = coerceString(o.ProcessName ?? o.LogonProcessName);
    if (o.WorkstationName) event.attrs.workstation = coerceString(o.WorkstationName);
    if (o.Channel) event.attrs.channel = coerceString(o.Channel);
  } else {
    const text = frame.message;
    const idMatch = /\b(?:EventID|Event ID)[:= ]+(\d{3,5})\b/i.exec(text);
    eventId = idMatch ? Number(idMatch[1]) : null;

    const fields = parseRenderedFields(text);
    event.userName = coerceString(fields['Account Name']);
    event.srcIp = coerceIp(fields['Source Network Address']) ?? input.peerIp ?? null;
    event.srcPort = coerceInt(fields['Source Port']);
    event.host = coerceString(fields['Workstation Name']) ?? frame.host;
    event.process = coerceString(fields['Process Name']);
    logonType = coerceInt(fields['Logon Type']);
    status = coerceString(fields['Sub Status'] ?? fields['Status'])?.toLowerCase() ?? null;
    event.ts = frame.ts ?? input.receivedAt;

    if (eventId === null) {
      if (/an account failed to log on/i.test(text)) eventId = 4625;
      else if (/an account was successfully logged on/i.test(text)) eventId = 4624;
    }
    event.message = text.split('\n')[0]?.trim() ?? null;
  }

  if (eventId === null) {
    return unparsed('windows_ad', input, 'no Windows event id in payload');
  }

  const known = ACTIONS[eventId];
  event.eventCategory = 'authentication';
  event.eventType = known?.type ?? `event-${eventId}`;
  event.action = known?.action ?? null;
  event.eventAction = known?.action ?? `event-${eventId}`;
  event.eventOutcome = known?.outcome ?? 'unknown';
  event.severity = known?.outcome === 'failure' ? 6 : 2;
  event.attrs.event_id = eventId;

  if (logonType !== null) {
    event.attrs.logon_type = logonType;
    event.attrs.logon_type_name = LOGON_TYPES[logonType] ?? String(logonType);
  }
  if (status) {
    event.attrs.status_code = status;
    const reason = STATUS_REASONS[status];
    if (reason) event.attrs.reason = reason;
  }

  // "jsmith" out of "CORP\jsmith", keeping the domain separately.
  if (event.userName?.includes('\\')) {
    const [domain, name] = event.userName.split('\\');
    event.attrs.domain = domain;
    event.userName = name ?? event.userName;
  }
  // Machine accounts end in $ and are noise in a login dashboard.
  if (event.userName?.endsWith('$')) event.attrs.machine_account = true;
  if (event.userName === '-') event.userName = null;

  event.message ??=
    known?.outcome === 'failure'
      ? `An account failed to log on (${eventId})`
      : `Windows security event ${eventId}`;

  return event;
};
