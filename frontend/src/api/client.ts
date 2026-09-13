// ตัวเรียก API ของ backend และ type ของข้อมูลที่รับส่ง

export interface ApiUser {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
  tenant_id: string | null;
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const needsJsonHeader = method !== 'GET' && method !== 'HEAD';

  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(needsJsonHeader ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    let message = `request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
    }
    if (response.status === 401 && !path.startsWith('/auth/')) {
      onUnauthorized?.();
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export interface UploadResult {
  filename: string;
  accepted: number;
  unparsed: number;
  timestamps_shifted_seconds: number;
  first_ts: string | null;
  last_ts: string | null;
}

export async function uploadFile(
  collectorId: string,
  file: File,
  keepTimestamps = false,
): Promise<UploadResult> {
  const form = new FormData();
  form.append('collector_id', collectorId);
  if (keepTimestamps) form.append('keep_timestamps', 'true');
  form.append('file', file);

  const response = await fetch('/api/ingest/file', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });

  if (!response.ok) {
    let message = `upload failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
    }
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as UploadResult;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export interface SiemEvent {
  id: string;
  tenant_id: string;
  ts: string;
  received_at: string;
  source_type: string;
  source: string | null;
  vendor: string | null;
  product: string | null;
  event_type: string | null;
  event_subtype: string | null;
  event_category: string | null;
  event_action: string | null;
  action: string | null;
  event_outcome: 'success' | 'failure' | 'unknown';
  severity: number | null;
  user_name: string | null;
  host: string | null;
  process: string | null;
  src_ip: string | null;
  src_port: number | null;
  dst_ip: string | null;
  dst_port: number | null;
  protocol: string | null;
  url: string | null;
  http_method: string | null;
  status_code: number | null;
  rule_name: string | null;
  rule_id: string | null;
  cloud_account_id: string | null;
  cloud_region: string | null;
  cloud_service: string | null;
  src_hostname: string | null;
  geo_country_iso: string | null;
  geo_country: string | null;
  geo_city: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  asn: number | null;
  as_org: string | null;
  message: string | null;
  attrs: Record<string, unknown>;
  tags: string[] | null;
  parse_ok: boolean;
}

export const SOURCES = [
  'firewall', 'network', 'api', 'crowdstrike', 'aws', 'm365', 'ad',
] as const;

export interface Summary {
  from: string;
  to: string;
  total: number;
  success: number;
  failure: number;
  unique_users: number;
  unique_ips: number;
  unparsed: number;
}

export interface Bucket {
  bucket: string;
  success: number;
  failure: number;
  total: number;
}

export interface TopRow {
  value: string;
  total: number;
  success: number;
  failure: number;
}

export interface Alert {
  id: string;
  tenant_id: string;
  rule_id: string;
  rule_name: string | null;
  created_at: string;
  first_seen: string;
  last_seen: string;
  status: 'open' | 'acknowledged';
  severity: number;
  group_by: string;
  group_value: string;
  event_count: number;
  title: string;
  details: Record<string, unknown>;
  acked_at: string | null;
  webhook_status: string;
  webhook_error: string | null;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface Collector {
  id: string;
  tenant_id: string;
  name: string;
  kind: 'http' | 'syslog' | 'file';
  source_type: string;
  cidr: string | null;
  enabled: boolean;
  has_token: boolean;
  created_at: string;
}

export interface Rule {
  id: string;
  tenant_id: string;
  name: string;
  enabled: boolean;
  match_category: string | null;
  match_outcome: string | null;
  group_by: string;
  window_seconds: number;
  threshold: number;
  severity: number;
  webhook_url: string | null;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor_email: string | null;
  actor_role: string | null;
  tenant_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  src_ip: string | null;
}
