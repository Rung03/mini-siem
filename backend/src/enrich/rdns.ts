import dns from 'node:dns';
import { config } from '../config.js';

/**
 * Reverse DNS that never blocks the write path.
 *
 * This is the part of enrichment worth getting right. dns.reverse() against an
 * unreachable resolver can sit there for seconds, and the syslog listener sees
 * thousands of events a second. Waiting on it would turn a nameserver problem
 * into an ingest outage — for a field that is decoration.
 *
 * So the enricher reads the cache and nothing else. On a miss it returns null
 * and schedules a lookup in the background, which means:
 *
 *   the first event from a new address has no hostname
 *   every later event from that address has one
 *
 * That is the right trade for a log pipeline, and it is written down in
 * docs/architecture.md rather than left as a surprise.
 */

type Resolver = (ip: string) => Promise<string[]>;

interface Entry {
  hostname: string | null;
  expires: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Set<string>();
const queue: string[] = [];
let active = 0;
// Bumped by resetRdnsCache(). A lookup started before a reset must not write
// its answer into the cache afterwards, or decrement a counter that has since
// been zeroed — it belongs to a state that no longer exists.
let generation = 0;

/**
 * Uses the configured nameservers when there are any, and the host's own
 * resolver otherwise. Built lazily so that config is read at first use rather
 * than at import time.
 */
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

/** Tests inject their own resolver so nothing touches the network. */
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

/** Map ordered by insertion, so the oldest key is the first one out. */
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
        // dns.promises.reverse takes neither a timeout nor an AbortSignal, so
        // the race is the only way to bound it. The losing promise is left to
        // settle on its own; it holds nothing but memory.
        setTimeout(() => reject(new Error('timeout')), config.enrich.rdnsTimeoutMs).unref(),
      ),
    ]);
    if (gen === generation) remember(ip, names[0] ?? null);
  } catch {
    // ENOTFOUND, SERVFAIL, timeout — all mean "no name", and all get cached
    // so that a non-resolving address is not retried on every single packet.
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
  // A flood of unique addresses must not spawn unbounded work. Past the
  // ceiling the lookups are simply skipped; the events still store.
  if (queue.length >= config.enrich.rdnsQueueMax) return;

  inFlight.add(ip);
  queue.push(ip);
  pump();
}

/**
 * The cached hostname, or null. Never performs I/O; never throws.
 * A miss schedules the lookup for next time.
 */
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

/**
 * Resolves and waits. Only for tests and one-off tooling — the ingest path
 * uses hostnameFor() and accepts the first-miss null.
 */
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
