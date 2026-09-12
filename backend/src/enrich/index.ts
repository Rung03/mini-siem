import { config } from '../config.js';
import type { CanonicalEvent } from '../normalize/schema.js';
import { geoProvider } from './geoip.js';
import { classifyIp, isLocatable } from './ipclass.js';
import { hostnameFor } from './rdns.js';

/**
 * Ingest-time enrichment: where the source address is, and what it resolves to.
 *
 * Called from pipeline/writer.ts, which is the one place every ingest path
 * converges. It runs *before* the database transaction opens — holding a
 * pooled connection across a lookup would be a poor trade even with the
 * bounds in rdns.ts.
 *
 * Enrichment is decoration, so the contract is narrow: this function never
 * throws and never removes an event. Everything it adds is optional, and an
 * event that comes out untouched is a perfectly good event.
 */

export { initGeoip, geoProvider, setGeoProvider } from './geoip.js';
export { classifyIp, isLocatable } from './ipclass.js';
export { hostnameFor, resetRdnsCache, rdnsStats, setResolver } from './rdns.js';

function addTag(event: CanonicalEvent, tag: string): void {
  if (!event.tags) event.tags = [];
  if (!event.tags.includes(tag)) event.tags.push(tag);
}

function enrichOne(event: CanonicalEvent): void {
  const ip = event.srcIp;
  if (!ip) return;

  const cls = classifyIp(ip);
  if (!cls) return;

  addTag(event, cls === 'public' ? 'public-ip' : `${cls}-ip`);

  // Reverse DNS applies to private addresses too — an internal PTR record is
  // how 10.0.0.44 becomes WS-114.corp.local, which is more useful to an
  // analyst than the address itself.
  const hostname = hostnameFor(ip);
  if (hostname) event.srcHostname = hostname;

  // Geo only makes sense for addresses that are actually routable. Asking a
  // database where 10.0.0.5 is wastes a lookup per event to learn "nowhere".
  if (!isLocatable(cls)) return;

  const geo = geoProvider().lookup(ip);
  if (!geo) return;

  event.geoCountryIso = geo.countryIso;
  event.geoCountry = geo.country;
  event.geoCity = geo.city;
  event.geoLat = geo.latitude;
  event.geoLon = geo.longitude;
  event.asn = geo.asn;
  event.asOrg = geo.asOrg;

  if (geo.countryIso) addTag(event, `geo:${geo.countryIso}`);
}

export function enrichBatch(events: CanonicalEvent[]): CanonicalEvent[] {
  if (!config.enrich.enabled) return events;

  for (const event of events) {
    try {
      enrichOne(event);
    } catch (err) {
      // Whatever went wrong, the event is still a log line and still gets
      // stored. Losing one because a lookup misbehaved would be absurd.
      console.error('[enrich] failed for one event:', (err as Error).message);
    }
  }

  return events;
}
