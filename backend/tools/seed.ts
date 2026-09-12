import { hashPassword } from '../src/auth/password.js';
import { withAdmin, withOwner } from '../src/db/tenant.js';
import { closeAllPools } from '../src/db/pool.js';
import { generateToken, hashToken } from '../src/ingest/collectors.js';
import { normalize } from '../src/normalize/index.js';
import type { CanonicalEvent, SourceType } from '../src/normalize/schema.js';
import { insertEvents } from '../src/pipeline/writer.js';

/**
 * Demo data.
 *
 * Every event below is generated as the raw payload its source would actually
 * emit — a FortiGate key=value line, a Windows 4625 record, an M365 audit
 * entry — and then pushed through the real parsers and the real writer. Nothing
 * is inserted pre-normalized. If a parser is wrong, this seed shows it.
 *
 * It builds 24 hours of ordinary login traffic for two tenants, and then one
 * brute force: a single address producing failure after failure inside a few
 * minutes, which is exactly what the seeded alert rule is watching for.
 *
 * Safe to run more than once; it will not duplicate tenants, users or
 * collectors, though it does add another day of events each time.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface TenantSpec {
  slug: string;
  name: string;
  viewerEmail: string;
  subnet: string;
  users: string[];
  hosts: string[];
  domain: string;
  volume: number;
}

const TENANTS: TenantSpec[] = [
  {
    slug: 'northwind',
    name: 'Northwind Traders',
    viewerEmail: 'viewer@northwind.local',
    subnet: '10.10.0',
    domain: 'northwind.local',
    users: [
      'jsmith', 'apatel', 'mchen', 'lgarcia', 'twilliams',
      'nsuzuki', 'rkumar', 'svance', 'administrator',
    ],
    hosts: ['DC-01', 'DC-02', 'FILE-01', 'VPN-01', 'WEB-01'],
    volume: 3200,
  },
  {
    slug: 'contoso',
    name: 'Contoso Ltd',
    viewerEmail: 'viewer@contoso.local',
    subnet: '10.20.0',
    domain: 'contoso.com',
    users: ['bmiller', 'kdavis', 'ythompson', 'deploy-bot', 'svc_backup'],
    hosts: ['CON-DC-01', 'CON-APP-01'],
    volume: 1400,
  },
];

const DEFAULT_PASSWORD = 'demo-password-change-me';

// ---------------------------------------------------------------------------
// Raw payload generators — one per source type
// ---------------------------------------------------------------------------

function iso(d: Date): string {
  return d.toISOString();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fortigateLine(ts: Date, user: string, ip: string, ok: boolean, device: string): string {
  const date = ts.toISOString().slice(0, 10);
  const time = ts.toISOString().slice(11, 19);
  const status = ok ? 'success' : 'failed';
  const level = ok ? 'notice' : 'alert';
  const desc = ok ? 'Admin login successful' : 'Admin login failed';
  const reason = ok ? '' : ' reason="name_invalid"';
  return (
    `<190>date=${date} time=${time} devname="${device}" devid="FG100ETK18001234" ` +
    `logid="0100032002" type="event" subtype="system" level="${level}" vd="root" ` +
    `logdesc="${desc}" user="${user}" ui="https(${ip})" method="https" ` +
    `srcip=${ip} dstip=10.0.0.1 action="login" status="${status}"${reason} ` +
    `msg="Administrator ${user} login ${ok ? 'succeeded' : 'failed'} from https(${ip})"`
  );
}

function windowsAdJson(
  ts: Date,
  user: string,
  ip: string,
  ok: boolean,
  host: string,
  domain: string,
): string {
  return JSON.stringify({
    EventID: ok ? 4624 : 4625,
    TimeCreated: iso(ts),
    Computer: `${host}.${domain}`,
    Channel: 'Security',
    TargetUserName: user,
    TargetDomainName: domain.split('.')[0]!.toUpperCase(),
    SubjectUserName: '-',
    IpAddress: ip,
    IpPort: String(40000 + Math.floor(Math.random() * 20000)),
    LogonType: Math.random() < 0.6 ? 3 : 10,
    LogonProcessName: 'NtLmSsp',
    WorkstationName: host,
    ...(ok ? {} : { Status: '0xc000006d', SubStatus: '0xc000006a' }),
  });
}

function m365Json(ts: Date, user: string, ip: string, ok: boolean, domain: string): string {
  return JSON.stringify({
    CreationTime: iso(ts).slice(0, 19),
    Id: crypto.randomUUID(),
    Operation: ok ? 'UserLoggedIn' : 'UserLoginFailed',
    OrganizationId: '8f2b1a4c-0000-4000-8000-1a2b3c4d5e6f',
    RecordType: 15,
    ResultStatus: ok ? 'Success' : 'Failed',
    UserKey: `${user}@${domain}`,
    UserType: 0,
    Workload: 'AzureActiveDirectory',
    ClientIP: ip,
    UserId: `${user}@${domain}`,
    UserAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    ...(ok ? {} : { LogonError: 'InvalidUserNameOrPassword' }),
  });
}

function cloudtrailJson(ts: Date, user: string, ip: string, ok: boolean): string {
  return JSON.stringify({
    eventVersion: '1.08',
    eventTime: iso(ts),
    eventSource: 'signin.amazonaws.com',
    eventName: 'ConsoleLogin',
    awsRegion: 'ap-southeast-1',
    sourceIPAddress: ip,
    userAgent: 'Mozilla/5.0',
    userIdentity: {
      type: 'IAMUser',
      principalId: 'AIDAEXAMPLEID',
      arn: `arn:aws:iam::123456789012:user/${user}`,
      accountId: '123456789012',
      userName: user,
    },
    responseElements: { ConsoleLogin: ok ? 'Success' : 'Failure' },
    additionalEventData: { MFAUsed: ok ? 'Yes' : 'No' },
    ...(ok ? {} : { errorMessage: 'Failed authentication' }),
  });
}

function crowdstrikeJson(ts: Date, user: string, ip: string, ok: boolean, domain: string): string {
  return JSON.stringify({
    metadata: {
      customerIDString: 'abc123',
      offset: Math.floor(Math.random() * 100000),
      eventType: 'UserActivityAuditEvent',
      eventCreationTime: ts.getTime(),
    },
    event: {
      UserId: `${user}@${domain}`,
      UserIp: ip,
      OperationName: 'user_authenticate',
      ServiceName: 'CrowdStrike Authentication',
      Success: ok,
      UTCTimestamp: Math.floor(ts.getTime() / 1000),
      AuditKeyValues: [{ Key: 'trace_id', ValueString: crypto.randomUUID().slice(0, 8) }],
    },
  });
}

function sshdLine(ts: Date, user: string, ip: string, ok: boolean, host: string): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const stamp =
    `${months[ts.getUTCMonth()]} ${String(ts.getUTCDate()).padStart(2, ' ')} ` +
    `${pad(ts.getUTCHours())}:${pad(ts.getUTCMinutes())}:${pad(ts.getUTCSeconds())}`;
  const port = 40000 + Math.floor(Math.random() * 20000);
  const body = ok
    ? `Accepted password for ${user} from ${ip} port ${port} ssh2`
    : `Failed password for ${Math.random() < 0.4 ? 'invalid user ' : ''}${user} from ${ip} port ${port} ssh2`;
  return `<38>${stamp} ${host} sshd[${1000 + Math.floor(Math.random() * 9000)}]: ${body}`;
}

type Generator = (ts: Date, user: string, ip: string, ok: boolean, spec: TenantSpec) => string;

const GENERATORS: Record<SourceType, Generator> = {
  fortigate: (ts, u, ip, ok, s) => fortigateLine(ts, u, ip, ok, `FG-${s.slug.toUpperCase()}`),
  windows_ad: (ts, u, ip, ok, s) =>
    windowsAdJson(ts, u, ip, ok, pickFrom(s.hosts), s.domain),
  m365: (ts, u, ip, ok, s) => m365Json(ts, u, ip, ok, s.domain),
  aws_cloudtrail: (ts, u, ip, ok) => cloudtrailJson(ts, u, ip, ok),
  crowdstrike: (ts, u, ip, ok, s) => crowdstrikeJson(ts, u, ip, ok, s.domain),
  generic: (ts, u, ip, ok, s) => sshdLine(ts, u, ip, ok, pickFrom(s.hosts)),
};

// ---------------------------------------------------------------------------
// Traffic shaping
// ---------------------------------------------------------------------------

function pickFrom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/**
 * Logins cluster around the start of the working day and thin out overnight.
 * Without this the chart is a flat line and "which period was unusually dense"
 * has no answer.
 */
function officeHoursWeight(hourUtc: number): number {
  const local = (hourUtc + 7) % 24; // demo tenants sit in UTC+7
  if (local >= 8 && local <= 10) return 3.0;
  if (local >= 11 && local <= 17) return 1.6;
  if (local >= 18 && local <= 21) return 0.6;
  return 0.12;
}

function randomTimestamp(now: Date): Date {
  for (;;) {
    const candidate = new Date(now.getTime() - Math.random() * DAY_MS);
    if (Math.random() < officeHoursWeight(candidate.getUTCHours()) / 3) return candidate;
  }
}

function internalIp(spec: TenantSpec): string {
  return `${spec.subnet}.${2 + Math.floor(Math.random() * 250)}`;
}

/**
 * Addresses the "external" failures come from.
 *
 * The RFC5737 documentation ranges are the correct thing to put in synthetic
 * logs, but they deliberately geolocate to nothing and resolve to nothing —
 * which left the enrichment columns empty for the entire demo dataset and made
 * a working feature look broken.
 *
 * So the list mixes both: documentation ranges for most of the noise, and a
 * handful of well-known public resolvers, which are public infrastructure
 * rather than anybody's private estate, and which do carry geo and PTR data.
 */
const EXTERNAL_IPS = [
  // Documentation ranges — no geo, no PTR, by design.
  '203.0.113.12', '203.0.113.44', '198.51.100.23',
  '198.51.100.77', '192.0.2.31', '192.0.2.155',
  // Public resolvers — these light up the geo and hostname columns.
  '8.8.8.8',          // dns.google, US
  '1.1.1.1',          // one.one.one.one, AU
  '9.9.9.9',          // dns9.quad9.net, CH
  '208.67.222.222',   // resolver1.opendns.com, US
  '77.88.8.8',        // Yandex, RU
  '168.95.1.1',       // HiNet, TW
  '114.114.114.114',  // 114DNS, CN
];

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

interface SeededCollector {
  id: string;
  sourceType: SourceType;
  token: string | null;
}

async function ensureTenant(spec: TenantSpec): Promise<string> {
  return withAdmin(async (db) => {
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM tenants WHERE slug = $1',
      [spec.slug],
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const created = await db.query<{ id: string }>(
      'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id',
      [spec.slug, spec.name],
    );
    return created.rows[0]!.id;
  });
}

async function ensureUser(
  email: string,
  role: 'admin' | 'viewer',
  tenantId: string | null,
): Promise<void> {
  const hash = await hashPassword(DEFAULT_PASSWORD);
  await withAdmin(async (db) => {
    await db.query(
      `INSERT INTO users (email, password_hash, role, tenant_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [email, hash, role, tenantId],
    );
  });
}

async function ensureCollector(
  tenantId: string,
  name: string,
  kind: 'http' | 'syslog' | 'file',
  sourceType: SourceType,
  cidr: string | null,
): Promise<SeededCollector> {
  const token = kind === 'http' ? generateToken() : null;

  return withAdmin(async (db) => {
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM collectors WHERE tenant_id = $1 AND name = $2',
      [tenantId, name],
    );
    if (existing.rows[0]) {
      return { id: existing.rows[0].id, sourceType, token: null };
    }

    const created = await db.query<{ id: string }>(
      `INSERT INTO collectors (tenant_id, name, kind, source_type, token_hash, source_cidr)
       VALUES ($1, $2, $3, $4, $5, $6::cidr) RETURNING id`,
      [tenantId, name, kind, sourceType, token ? hashToken(token) : null, cidr],
    );
    return { id: created.rows[0]!.id, sourceType, token };
  });
}

async function ensureBruteForceRule(tenantId: string): Promise<void> {
  await withAdmin(async (db) => {
    await db.query(
      `INSERT INTO alert_rules
         (tenant_id, name, match_category, match_outcome, group_by,
          window_seconds, threshold, severity, suppress_seconds)
       VALUES ($1, $2, 'authentication', 'failure', 'src_ip', 300, 5, 2, 900)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, 'Brute force: repeated login failures from one address'],
    );
  });
}

/** Events span the last 24 hours, so yesterday's partitions have to exist. */
async function ensurePartitionsForWindow(tenantId: string, now: Date): Promise<void> {
  await withOwner(async (db) => {
    for (const offset of [-1, 0, 1]) {
      const day = new Date(now.getTime() + offset * DAY_MS);
      await db.query('SELECT ensure_tenant_partition($1::date, $2::uuid)', [
        day.toISOString().slice(0, 10),
        tenantId,
      ]);
    }
  });
}

async function seedTenant(
  spec: TenantSpec,
  now: Date,
  isFirstTenant: boolean,
): Promise<void> {
  const tenantId = await ensureTenant(spec);
  await ensureUser(spec.viewerEmail, 'viewer', tenantId);
  await ensureBruteForceRule(tenantId);
  await ensurePartitionsForWindow(tenantId, now);

  // Syslog collectors are identified by sender address, so each one needs its
  // own range: the firewall sits on the tenant's first /24, the Linux estate
  // on the next one along.
  const octets = spec.subnet.split('.');
  const serverSubnet = `${octets[0]}.${octets[1]}.${Number(octets[2]) + 1}`;

  const collectors: SeededCollector[] = [
    await ensureCollector(tenantId, 'edge-firewall', 'syslog', 'fortigate', `${spec.subnet}.0/24`),
    await ensureCollector(tenantId, 'domain-controllers', 'http', 'windows_ad', null),
    await ensureCollector(tenantId, 'microsoft-365', 'http', 'm365', null),
    await ensureCollector(tenantId, 'aws-cloudtrail', 'file', 'aws_cloudtrail', null),
    await ensureCollector(tenantId, 'crowdstrike-falcon', 'file', 'crowdstrike', null),
    await ensureCollector(tenantId, 'linux-servers', 'syslog', 'generic', `${serverSubnet}.0/24`),
  ];

  if (isFirstTenant) {
    // Syslog sent from the host arrives from Docker's bridge, which matches
    // none of the ranges above, so the run-book's `logger` example would be
    // dropped as an unknown sender. This collector exists so that example
    // works out of the box; disable it on the Collectors screen if you want
    // to see the unknown-sender path instead.
    collectors.push(
      await ensureCollector(tenantId, 'local-test-syslog', 'syslog', 'generic', '172.16.0.0/12'),
    );
  }

  const issued = collectors.filter((c) => c.token);
  if (issued.length > 0) {
    console.log(`\n  ${spec.name} — collector tokens (shown once):`);
    for (const c of issued) console.log(`    ${c.sourceType.padEnd(16)} ${c.token}`);
  }

  // --- ordinary traffic --------------------------------------------------
  const byCollector = new Map<string, { sourceType: SourceType; events: CanonicalEvent[] }>();
  const queue = (collector: SeededCollector, event: CanonicalEvent) => {
    let entry = byCollector.get(collector.id);
    if (!entry) {
      entry = { sourceType: collector.sourceType, events: [] };
      byCollector.set(collector.id, entry);
    }
    entry.events.push(event);
  };

  for (let i = 0; i < spec.volume; i++) {
    const collector = pickFrom(collectors);
    const ts = randomTimestamp(now);
    const user = pickFrom(spec.users);

    // Roughly one login in eight fails, which is about what a real estate of
    // this size looks like once you count fat fingers and expired passwords.
    const ok = Math.random() > 0.13;
    const external = !ok && Math.random() < 0.35;
    const ip = external ? pickFrom(EXTERNAL_IPS) : internalIp(spec);

    const raw = GENERATORS[collector.sourceType](ts, user, ip, ok, spec);
    queue(collector, normalize(collector.sourceType, { raw, receivedAt: ts, peerIp: ip }));
  }

  // --- the brute force ---------------------------------------------------
  // Twelve failures from one address, ending half a minute ago and spanning
  // about a minute. The rule looks back five minutes for five failures, so
  // the burst has to sit *inside* that window — put it further back and the
  // evaluator will never see it, however obvious the attack looks to a human.
  // The next cycle (within 30s) raises the alert with nobody doing anything.
  const attacker = '203.0.113.66';
  const burstEnd = now.getTime() - 30 * 1000;
  const target = collectors.find((c) => c.sourceType === 'windows_ad') ?? collectors[0]!;
  const guesses = ['administrator', 'admin', 'root', 'backup', spec.users[0]!];

  for (let i = 0; i < 12; i++) {
    const ts = new Date(burstEnd - (12 - i) * 5_000);
    const raw = GENERATORS[target.sourceType](ts, pickFrom(guesses), attacker, false, spec);
    queue(target, normalize(target.sourceType, { raw, receivedAt: ts, peerIp: attacker }));
  }

  // --- write -------------------------------------------------------------
  let total = 0;
  for (const [collectorId, entry] of byCollector) {
    for (let i = 0; i < entry.events.length; i += 500) {
      total += await insertEvents({
        tenantId,
        collectorId,
        events: entry.events.slice(i, i + 500),
      });
    }
  }

  const failures = [...byCollector.values()]
    .flatMap((e) => e.events)
    .filter((e) => e.eventOutcome === 'failure').length;
  const unparsed = [...byCollector.values()]
    .flatMap((e) => e.events)
    .filter((e) => !e.parseOk).length;

  console.log(
    `  ${spec.name}: ${total} events (${failures} failures, ${unparsed} unparsed) ` +
      `across ${byCollector.size} collectors`,
  );
}

async function main(): Promise<void> {
  const now = new Date();
  console.log('Seeding demo data…');

  await ensureUser('admin@siem.local', 'admin', null);

  for (const [index, spec] of TENANTS.entries()) {
    await seedTenant(spec, now, index === 0);
  }

  console.log('\nSign in with:');
  console.log(`  admin@siem.local        / ${DEFAULT_PASSWORD}   (Admin, all tenants)`);
  for (const t of TENANTS) {
    console.log(`  ${t.viewerEmail.padEnd(24)}/ ${DEFAULT_PASSWORD}   (Viewer, ${t.name})`);
  }
  console.log(
    '\nAn alert should appear within one evaluation cycle (30s) for 203.0.113.66.',
  );
}

main()
  .then(() => closeAllPools())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await closeAllPools();
    process.exit(1);
  });
