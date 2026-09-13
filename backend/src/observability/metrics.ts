// ตัวนับและค่าวัดของระบบในรูปแบบ Prometheus text สำหรับ GET /api/metrics

type Labels = Record<string, string>;

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labelSet(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabel(labels[k]!)}"`).join(',')}}`;
}

const counters: Counter[] = [];
const gauges = new Map<string, { help: string; read: () => number }>();

export class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {
    counters.push(this);
  }

  inc(labels: Labels = {}, by = 1): void {
    if (!(by > 0)) return;
    const key = labelSet(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  value(labels: Labels = {}): number {
    return this.values.get(labelSet(labels)) ?? 0;
  }

  render(): string[] {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const [labels, v] of this.values) lines.push(`${this.name}${labels} ${v}`);
    return lines;
  }
}

export function registerGauge(name: string, help: string, read: () => number): void {
  gauges.set(name, { help, read });
}

export const eventsWritten = new Counter('siem_events_written_total', 'Events written to storage');
export const eventsUnparsed = new Counter(
  'siem_events_unparsed_total',
  'Stored events that no parser could read',
);
export const ingestDrops = new Counter(
  'siem_ingest_drops_total',
  'Payloads rejected at ingest, by channel',
);
export const alertsRaised = new Counter(
  'siem_alerts_raised_total',
  'New alerts raised by the rule evaluator',
);
export const rateLimited = new Counter(
  'siem_rate_limited_total',
  'Requests refused by a rate limit, by scope',
);
export const loginAttempts = new Counter(
  'siem_login_attempts_total',
  'Web login attempts, by outcome',
);

registerGauge('process_uptime_seconds', 'Seconds since the process started', () =>
  Math.round(process.uptime()),
);
registerGauge('process_resident_memory_bytes', 'Resident memory size', () =>
  process.memoryUsage().rss,
);
registerGauge('nodejs_heap_used_bytes', 'V8 heap in use', () => process.memoryUsage().heapUsed);

export function renderMetrics(): string {
  const lines: string[] = [];
  for (const c of counters) lines.push(...c.render());
  for (const [name, g] of gauges) {
    let v: number;
    try {
      v = g.read();
    } catch {
      continue;
    }
    lines.push(`# HELP ${name} ${g.help}`, `# TYPE ${name} gauge`, `${name} ${v}`);
  }
  return `${lines.join('\n')}\n`;
}
