// เติม hostname, ตำแหน่ง และ tag ให้ event ก่อนบันทึก

import { config } from '../config.js';
import type { CanonicalEvent } from '../normalize/schema.js';
import { geoProvider } from './geoip.js';
import { classifyIp, isLocatable } from './ipclass.js';
import { hostnameFor } from './rdns.js';

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

  const hostname = hostnameFor(ip);
  if (hostname) event.srcHostname = hostname;

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
      console.error('[enrich] failed for one event:', (err as Error).message);
    }
  }

  return events;
}
