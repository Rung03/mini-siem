// ส่วนประกอบใช้ซ้ำ: เลือกช่วงเวลา, เลือก tenant, การ์ดตัวเลขแบบเอียง 3D, จัดรูปแบบเวลา

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ApiUser, type Tenant } from '../api/client.js';

export const RANGES = [
  { key: '1h', label: 'Last hour', ms: 60 * 60 * 1000, bucket: 'minute' as const },
  { key: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000, bucket: 'hour' as const },
  { key: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000, bucket: 'day' as const },
];

export type RangeKey = (typeof RANGES)[number]['key'];

export function useTimeRange(initial: RangeKey = '24h') {
  const [key, setKey] = useState<RangeKey>(initial);
  const range = RANGES.find((r) => r.key === key) ?? RANGES[1]!;

  const now = Math.floor(Date.now() / 60_000) * 60_000;
  const from = new Date(now - range.ms).toISOString();
  const to = new Date(now).toISOString();

  return { key, setKey, from, to, bucket: range.bucket };
}

export function RangePicker({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (key: RangeKey) => void;
}) {
  return (
    <div className="field">
      <label htmlFor="range">Time range</label>
      <select id="range" value={value} onChange={(e) => onChange(e.target.value)}>
        {RANGES.map((r) => (
          <option key={r.key} value={r.key}>{r.label}</option>
        ))}
      </select>
    </div>
  );
}

export function useTenants(enabled: boolean) {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.get<{ tenants: Tenant[] }>('/tenants'),
    enabled,
    refetchInterval: false,
  });
}

export function TenantSelect({
  user,
  value,
  onChange,
}: {
  user: ApiUser;
  value: string;
  onChange: (id: string) => void;
}) {
  const { data } = useTenants(user.role === 'admin');
  if (user.role !== 'admin') return null;

  return (
    <div className="field">
      <label htmlFor="tenant">Tenant</label>
      <select id="tenant" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All tenants</option>
        {data?.tenants.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}

export function useTenantNames(): Map<string, string> {
  const { data } = useTenants(true);
  return new Map((data?.tenants ?? []).map((t) => [t.id, t.name]));
}

export function Outcome({ value }: { value: string }) {
  const cls = value === 'success' ? 'success' : value === 'failure' ? 'failure' : 'unknown';
  return <span className={`pill ${cls}`}>{value}</span>;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useCountUp(target: number, durationMs = 750): number {
  const [shown, setShown] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      current.current = target;
      setShown(target);
      return;
    }
    const origin = current.current;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      const value = Math.round(origin + (target - origin) * (1 - Math.pow(1 - t, 3)));
      current.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return shown;
}

export function Tilt({
  children,
  className,
  max = 7,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  max?: number;
} & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${((0.5 - y) * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * max).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  };

  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  return (
    <div
      {...rest}
      ref={ref}
      className={`tilt${className ? ` ${className}` : ''}`}
      onPointerMove={move}
      onPointerLeave={reset}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = 'accent',
  sub,
  icon,
  index = 0,
  active = false,
  hint,
  onClick,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'failure' | 'accent' | 'info';
  sub?: string;
  icon?: ReactNode;
  index?: number;
  active?: boolean;
  hint?: string;
  onClick?: () => void;
}) {
  const shown = useCountUp(value);
  const interactive = onClick !== undefined;

  return (
    <Tilt
      className={`card stat tone-${tone} enter${interactive ? ' clickable' : ''}${active ? ' active' : ''}`}
      style={{ '--i': index } as CSSProperties}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? active : undefined}
      title={hint}
      onClick={onClick}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="stat-top">
        <span className="label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <span className="value">{shown.toLocaleString()}</span>
      {sub && <span className="sub">{sub}</span>}
      {active && <span className="stat-flag">Filtering</span>}
      <span className="stat-bar" aria-hidden="true" />
    </Tilt>
  );
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatBucket(iso: string, bucket: 'minute' | 'hour' | 'day'): string {
  const d = new Date(iso);
  if (bucket === 'day') {
    return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
  }
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error">{error instanceof Error ? error.message : 'request failed'}</div>;
}
