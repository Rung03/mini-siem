// checksum ของ migration และ checksum เดิมที่ยอมรับได้หลังแก้เฉพาะ comment

import { createHash } from 'node:crypto';

export const EQUIVALENT_EARLIER_CHECKSUMS: Readonly<Record<string, readonly string[]>> = {
  '001_schema.sql': ['64fb3a1d9601104c30392e5bd687bf96d12b0d2a644cf064adca9d025b2fa99b', '19b27b08a6de7d43019cff66441feb1364288ead9121bf43e4f75a4cb1887a2c'],
  '002_rls.sql': ['e48520dc9f722d802a860b3a13e3dc6c41903817c838bc51c6fc2e8209deb68b', 'a7ba1521e0b2e973e1208a403d8e75b59382b38793e688ec4d051d1acde1b34e'],
  '003_functions.sql': ['09061b2416a927b8cb3b332b54455a14587cc82de3605a598ea27afe4159e3e0', '12ed07a485ebdb68a2592c339d08d17119d523139a6edd46678f8c102e2ef746'],
  '004_schema_alignment.sql': ['bd96bf34a0193248d651f64a76002f309f4eff75db9261f9077390f574aac6cf', '79f9d2a91316ef5515b4242a1a948c0d78a5c3403f082cbfd5e11c8fe44a4367'],
  '005_default_partition.sql': ['0d7f477940bffd8a1330e0c9406e84575363b114cadd47eb3f4107353b1e8bce', 'df00563c2779eb10d6ead1bb6f19a64359e8422c388094b27058cc161530fb53'],
  '006_enrichment.sql': ['6731290e0b69271a01f901654f62f1d64f965fd2324a6c8f2b6497918a986cf8', 'f6b9428e61995204184a27baf63a607606b8f02b3157c9c075b16a945fac5e8d'],
};

export type ChecksumVerdict = 'match' | 'earlier-equivalent' | 'mismatch';

export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function compareChecksum(file: string, recorded: string, current: string): ChecksumVerdict {
  if (recorded === current) return 'match';
  if (EQUIVALENT_EARLIER_CHECKSUMS[file]?.includes(recorded)) return 'earlier-equivalent';
  return 'mismatch';
}
