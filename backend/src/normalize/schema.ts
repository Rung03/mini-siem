/**
 * The canonical event — the central schema from section 3 of the assignment.
 *
 * A Fortigate line, a Windows 4625 record, an M365 audit entry and a CloudTrail
 * ConsoleLogin look nothing alike. Each parser's job is to reduce its source to
 * exactly this shape, so that one query can cross all of them.
 *
 * `raw` is never dropped and never trimmed to fit — the original payload is
 * kept whole for when someone has to go back and check.
 */

/** Which parser read the payload. Chosen by the collector, never by the sender. */
export const SOURCE_TYPES = [
  'fortigate',
  'windows_ad',
  'm365',
  'aws_cloudtrail',
  'crowdstrike',
  'generic',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/** The source family, from section 3's taxonomy. */
export const SOURCES = [
  'firewall',
  'network',
  'api',
  'crowdstrike',
  'aws',
  'm365',
  'ad',
] as const;

export type Source = (typeof SOURCES)[number];

/** Section 3's action vocabulary. */
export type Action =
  | 'allow'
  | 'deny'
  | 'create'
  | 'delete'
  | 'login'
  | 'logout'
  | 'alert'
  | string;

export type Outcome = 'success' | 'failure' | 'unknown';

export interface CanonicalEvent {
  ts: Date;
  /** The parser family that produced this row. */
  sourceType: SourceType;
  /** Section 3 `source`: firewall|network|api|crowdstrike|aws|m365|ad. */
  source: Source | null;
  vendor: string | null;
  product: string | null;

  eventType: string | null;
  eventSubtype: string | null;
  eventCategory: string | null;
  /** Kept alongside `action`: action is the verb, outcome is how it ended. */
  eventAction: string | null;
  action: Action | null;
  eventOutcome: Outcome;

  /** 0 = quietest, 10 = loudest, per section 3. */
  severity: number | null;

  userName: string | null;
  host: string | null;
  process: string | null;

  srcIp: string | null;
  srcPort: number | null;
  dstIp: string | null;
  dstPort: number | null;
  protocol: string | null;

  url: string | null;
  httpMethod: string | null;
  statusCode: number | null;

  ruleName: string | null;
  ruleId: string | null;

  cloudAccountId: string | null;
  cloudRegion: string | null;
  cloudService: string | null;

  message: string | null;
  raw: string;
  attrs: Record<string, unknown>;
  tags: string[] | null;
  /** false when the parser could not make sense of the payload */
  parseOk: boolean;

  // --- filled in later, by the enrichment stage -------------------------
  // Parsers leave these alone; see enrich/index.ts. All optional: an event
  // with every one of them null is a perfectly good event.
  srcHostname: string | null;
  geoCountryIso: string | null;
  geoCountry: string | null;
  geoCity: string | null;
  geoLat: number | null;
  geoLon: number | null;
  asn: number | null;
  asOrg: string | null;
}

export interface ParserInput {
  /** The payload exactly as it arrived. */
  raw: string;
  /** Pre-parsed JSON, when the transport already had an object. */
  json?: unknown;
  /** Fallback event time when the payload carries none. */
  receivedAt: Date;
  /** Transport-level sender address, when known (syslog). */
  peerIp?: string | null;
}

export type Parser = (input: ParserInput) => CanonicalEvent;

export function isSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && (SOURCE_TYPES as readonly string[]).includes(v);
}

/** Every optional field at its empty value, so parsers only set what they know. */
export function blankEvent(
  sourceType: SourceType,
  input: ParserInput,
): CanonicalEvent {
  return {
    ts: input.receivedAt,
    sourceType,
    source: null,
    vendor: null,
    product: null,
    eventType: null,
    eventSubtype: null,
    eventCategory: null,
    eventAction: null,
    action: null,
    eventOutcome: 'unknown',
    severity: null,
    userName: null,
    host: null,
    process: null,
    srcIp: input.peerIp ?? null,
    srcPort: null,
    dstIp: null,
    dstPort: null,
    protocol: null,
    url: null,
    httpMethod: null,
    statusCode: null,
    ruleName: null,
    ruleId: null,
    cloudAccountId: null,
    cloudRegion: null,
    cloudService: null,
    message: null,
    raw: input.raw,
    attrs: {},
    tags: null,
    parseOk: true,
    srcHostname: null,
    geoCountryIso: null,
    geoCountry: null,
    geoCity: null,
    geoLat: null,
    geoLon: null,
    asn: null,
    asOrg: null,
  };
}

/**
 * The shape returned when a parser cannot understand its input. Note that this
 * is still a real, stored event: the raw payload survives, flagged parse_ok
 * false, so nothing silently disappears just because a format changed.
 */
export function unparsed(
  sourceType: SourceType,
  input: ParserInput,
  reason: string,
): CanonicalEvent {
  return {
    ...blankEvent(sourceType, input),
    message: input.raw.slice(0, 500),
    attrs: { parse_error: reason },
    parseOk: false,
  };
}
