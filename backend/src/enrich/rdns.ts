import dns from 'node:dns';
import { config } from '../config.js';

type Resolver = (ip: string) => Promise<string[]>;

interface Entry {
  hostname: string | null;
  expires: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Set<string>();
const queue: string[] = [];
let active = 0;
let generation = 0;

let configured: Resolver | null = null;

function defaultResolver(): Resolver {
  if (configured) return configured;

  const servers = config.enrich.rdnsServers;
  if (servers.length === 0) {
    configured = (ip) => dns.promises.reverse(ip);
  } else {
    const r = new dns.promises.Resolver();
    r.setServers(servers);
    configured = (ip) => r.reverse(ip);
  }
  return configured;
}

let resolver: Resolver = (ip) => defaultResolver()(ip);

export function setResolver(next: Resolver | null): void {
  resolver = next ?? ((ip) => defaultResolver()(ip));
}

export function resetRdnsCache(): void {
  generation++;
  cache.clear();
  inFlight.clear();
  queue.length = 0;
  active = 0;
}

export function rdnsStats() {
  return { cached: cache.size, inFlight: inFlight.size, queued: queue.length };
}

function remember(ip: string, hostname: string | null): void {
  const ttl = hostname ? config.enrich.rdnsPositiveTtlMs : config.enrich.rdnsNegativeTtlMs;
  cache.set(ip, { hostname, expires: Date.now() + ttl });

  while (cache.size > config.enrich.rdnsCacheMax) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

async function resolveOne(ip: string, gen: number): Promise<void> {
  try {
    const names = await Promise.race([
      resolver(ip),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), config.enrich.rdnsTimeoutMs).unref(),
      ),
    ]);
    if (gen === generation) remember(ip, names[0] ?? null);
  } catch {
    if (gen === generation) remember(ip, null);
  } finally {
    if (gen === generation) {
      inFlight.delete(ip);
      active--;
      pump();
    }
  }
}

function pump(): void {
  while (active < config.enrich.rdnsConcurrency && queue.length > 0) {
    const ip = queue.shift()!;
    if (cache.has(ip)) {
      inFlight.delete(ip);
      continue;
    }
    active++;
    void resolveOne(ip, generation);
  }
}

function schedule(ip: string): void {
  if (inFlight.has(ip)) return;
  if (queue.length >= config.enrich.rdnsQueueMax) return;

  inFlight.add(ip);
  queue.push(ip);
  pump();
}

export function hostnameFor(ip: string): string | null {
  if (!config.enrich.enabled || !config.enrich.rdnsEnabled) return null;

  const hit = cache.get(ip);
  if (hit) {
    if (hit.expires > Date.now()) return hit.hostname;
    cache.delete(ip);
  }

  schedule(ip);
  return null;
}

export async function hostnameForAwait(ip: string): Promise<string | null> {
  const hit = cache.get(ip);
  if (hit && hit.expires > Date.now()) return hit.hostname;

  try {
    const names = await resolver(ip);
    remember(ip, names[0] ?? null);
  } catch {
    remember(ip, null);
  }
  return cache.get(ip)?.hostname ?? null;
}
