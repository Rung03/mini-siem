// ค้นหาประเทศ เมือง และ ASN จากไฟล์ GeoIP ในเครื่อง

import { existsSync } from 'node:fs';
import { config } from '../config.js';

export interface GeoResult {
  countryIso: string | null;
  country: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  asn: number | null;
  asOrg: string | null;
}

export interface GeoProvider {
  lookup(ip: string): GeoResult | null;
  readonly available: boolean;
  readonly description: string;
}

interface CityRecord {
  country?: { iso_code?: string; names?: Record<string, string> };
  registered_country?: { iso_code?: string; names?: Record<string, string> };
  city?: { names?: Record<string, string> };
  location?: { latitude?: number; longitude?: number };
}

interface AsnRecord {
  autonomous_system_number?: number;
  autonomous_system_organization?: number | string;
}

interface Reader<T> {
  get(ip: string): T | null;
}

const EMPTY: GeoProvider = {
  lookup: () => null,
  available: false,
  description: 'disabled',
};

let provider: GeoProvider | null = null;

export async function initGeoip(): Promise<GeoProvider> {
  if (provider) return provider;

  if (!config.enrich.enabled || !config.enrich.geoipCityDb) {
    provider = EMPTY;
    return provider;
  }

  const cityPath = config.enrich.geoipCityDb;
  const asnPath = config.enrich.geoipAsnDb;

  if (!existsSync(cityPath)) {
    console.log(
      `[enrich] no GeoIP database at ${cityPath} — geo fields stay empty. ` +
        'Run `make geoip` to download DB-IP Lite.',
    );
    provider = EMPTY;
    return provider;
  }

  try {
    const maxmind = await import('maxmind');
    const city = (await maxmind.open(cityPath)) as unknown as Reader<CityRecord>;
    const asn =
      asnPath && existsSync(asnPath)
        ? ((await maxmind.open(asnPath)) as unknown as Reader<AsnRecord>)
        : null;

    provider = {
      available: true,
      description: asn ? `${cityPath} + ${asnPath}` : cityPath,
      lookup(ip: string): GeoResult | null {
        let cityRecord: CityRecord | null = null;
        let asnRecord: AsnRecord | null = null;

        try {
          cityRecord = city.get(ip);
        } catch {
        }
        if (asn) {
          try {
            asnRecord = asn.get(ip);
          } catch {
            asnRecord = null;
          }
        }

        if (!cityRecord && !asnRecord) return null;

        const country = cityRecord?.country ?? cityRecord?.registered_country;
        const org = asnRecord?.autonomous_system_organization;

        return {
          countryIso: country?.iso_code ?? null,
          country: country?.names?.en ?? null,
          city: cityRecord?.city?.names?.en ?? null,
          latitude: cityRecord?.location?.latitude ?? null,
          longitude: cityRecord?.location?.longitude ?? null,
          asn: asnRecord?.autonomous_system_number ?? null,
          asOrg: org === undefined ? null : String(org),
        };
      },
    };

    console.log(`[enrich] GeoIP ready — ${provider.description}`);
    return provider;
  } catch (err) {
    console.warn(`[enrich] GeoIP unavailable: ${(err as Error).message}`);
    provider = EMPTY;
    return provider;
  }
}

export function geoProvider(): GeoProvider {
  return provider ?? EMPTY;
}

export function setGeoProvider(next: GeoProvider | null): void {
  provider = next;
}
