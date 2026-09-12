import { isIP } from 'node:net';

/**
 * Classifies a source address before anything tries to look it up.
 *
 * The point is to avoid asking a GeoIP database where 10.0.0.5 is — the answer
 * is nowhere, and a lookup per event to learn that is waste. Reverse DNS still
 * runs for private addresses, because internal PTR records are precisely how a
 * 10.x address becomes WS-114.corp.local.
 */

export type IpClass = 'public' | 'private' | 'loopback' | 'link-local' | 'reserved';

/** True when a GeoIP lookup could plausibly return something. */
export function isLocatable(cls: IpClass): boolean {
  return cls === 'public';
}

function classifyV4(ip: string): IpClass {
  const parts = ip.split('.').map(Number);
  const [a, b] = parts as [number, number, number, number];

  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local';

  // Carrier-grade NAT: not routable on the public internet, so not locatable,
  // but it is somebody else's network rather than this one.
  if (a === 100 && b >= 64 && b <= 127) return 'reserved';

  if (a === 0) return 'reserved';
  if (a >= 224) return 'reserved'; // multicast and future use
  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 — RFC5737 documentation
  // ranges. They appear all over the sample data and resolve to nothing, so
  // treating them as reserved keeps them out of both lookups.
  if (a === 192 && b === 0 && parts[2] === 2) return 'reserved';
  if (a === 198 && b === 51 && parts[2] === 100) return 'reserved';
  if (a === 203 && b === 0 && parts[2] === 113) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved'; // benchmarking

  return 'public';
}

function classifyV6(ip: string): IpClass {
  const lower = ip.toLowerCase();

  if (lower === '::1') return 'loopback';
  if (lower === '::') return 'reserved';
  if (lower.startsWith('fe80')) return 'link-local';
  // Unique local addresses, fc00::/7
  if (/^f[cd]/.test(lower)) return 'private';
  if (lower.startsWith('ff')) return 'reserved'; // multicast
  if (lower.startsWith('2001:db8')) return 'reserved'; // documentation

  // ::ffff:a.b.c.d — an IPv4 address wearing a v6 hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return classifyV4(mapped[1]!);

  return 'public';
}

export function classifyIp(ip: string | null): IpClass | null {
  if (!ip) return null;
  const version = isIP(ip);
  if (version === 4) return classifyV4(ip);
  if (version === 6) return classifyV6(ip);
  return null;
}
