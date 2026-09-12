/**
 * Thin API client.
 *
 * Authentication is an httpOnly cookie, so there is no token to attach here and
 * nothing for a script on the page to steal — every request just needs
 * credentials: 'include'.
 */

export interface ApiUser {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
  tenant_id: string | null;
}

/**
 * Called when the API reports that we are not signed in. A session lasts 12
 * hours, so it will expire while a tab is open; without this the page just
 * fills with "authentication required" boxes and the user has no way back to
 * the sign-in form.
 */
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
  // The API rejects any mutation that does not declare JSON — that check is
  // what closes the CSRF hole a cookie-authenticated API would otherwise have.
  // The header therefore depends on the method, not on whether we happen to
  // have a body: POSTs with no body (sign out, acknowledge, rotate token) need
  // it just as much.
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
      // Response had no JSON body; the status line is all we get.
    }
    // /auth/me answers 401 as its normal signed-out reply, so it handles its
    // own result rather than triggering a sign-out here.
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

/**
 * Multipart upload. Cannot go through request(), which declares JSON — the
 * browser has to set its own multipart boundary.
 */
export async function uploadFile(
  collectorId: string,
  file: File,
): Promise<{ filename: string; accepted: number; unparsed: number }> {
  const form = new FormData();
  form.append('collector_id', collectorId);
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
      // No JSON body to read.
    }
    throw new ApiError(response.status, message);
  }

  return (await response.json()) as { filename: string; accepted: number; unparsed: number };
}

/** Turns a filter object into a query string, dropping empty values. */
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

// --- shapes returned by the API ------------------------------------------

/** The central schema from section 3 of the assignment. */
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
  /** 0-10, 10 loudest */
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
  // Added by ingest-time enrichment; null when no GeoIP database is installed.
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

/** Section 3's source taxonomy. */
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
