// นิยามโครงสร้างกลางของ event (CanonicalEvent) และค่าเริ่มต้น

export const SOURCE_TYPES = [
  'fortigate',
  'm365',
  'crowdstrike',
  'generic',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCES = [
  'firewall',
  'network',
  'api',
  'crowdstrike',
  'm365',
] as const;

export type Source = (typeof SOURCES)[number];

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
  sourceType: SourceType;
  source: Source | null;
  vendor: string | null;
  product: string | null;

  eventType: string | null;
  eventSubtype: string | null;
  eventCategory: string | null;
  eventAction: string | null;
  action: Action | null;
  eventOutcome: Outcome;

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
  parseOk: boolean;

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
  raw: string;
  json?: unknown;
  receivedAt: Date;
  peerIp?: string | null;
}

export type Parser = (input: ParserInput) => CanonicalEvent;

export function isSourceType(v: unknown): v is SourceType {
  return typeof v === 'string' && (SOURCE_TYPES as readonly string[]).includes(v);
}

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
