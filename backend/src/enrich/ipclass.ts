// แยกประเภท IP: public, private, loopback, link-local, reserved

import { isIP } from 'node:net';

export type IpClass = 'public' | 'private' | 'loopback' | 'link-local' | 'reserved';

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

  if (a === 100 && b >= 64 && b <= 127) return 'reserved';

  if (a === 0) return 'reserved';
  if (a >= 224) return 'reserved';
  if (a === 192 && b === 0 && parts[2] === 2) return 'reserved';
  if (a === 198 && b === 51 && parts[2] === 100) return 'reserved';
  if (a === 203 && b === 0 && parts[2] === 113) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';

  return 'public';
}

function classifyV6(ip: string): IpClass {
  const lower = ip.toLowerCase();

  if (lower === '::1') return 'loopback';
  if (lower === '::') return 'reserved';
  if (lower.startsWith('fe80')) return 'link-local';
  if (/^f[cd]/.test(lower)) return 'private';
  if (lower.startsWith('ff')) return 'reserved';
  if (lower.startsWith('2001:db8')) return 'reserved';

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
