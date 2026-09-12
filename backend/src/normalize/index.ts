import { parseAwsCloudtrail } from './parsers/aws-cloudtrail.js';
import { parseCrowdstrike } from './parsers/crowdstrike.js';
import { parseFortigate } from './parsers/fortigate.js';
import { parseGeneric } from './parsers/generic.js';
import { parseM365 } from './parsers/m365.js';
import { parseWindowsAd } from './parsers/windows-ad.js';
import type { CanonicalEvent, Parser, ParserInput, SourceType } from './schema.js';
import { unparsed } from './schema.js';

/**
 * The registry. One parser per source type, selected by the collector the data
 * arrived on — never by anything inside the payload, which would let a sender
 * choose how it gets interpreted.
 */
const PARSERS: Record<SourceType, Parser> = {
  fortigate: parseFortigate,
  windows_ad: parseWindowsAd,
  m365: parseM365,
  aws_cloudtrail: parseAwsCloudtrail,
  crowdstrike: parseCrowdstrike,
  generic: parseGeneric,
};

export function parserFor(sourceType: SourceType): Parser {
  return PARSERS[sourceType];
}

/**
 * Normalize one payload. A parser that throws is contained here: the event is
 * stored raw and flagged rather than taking down the ingest path. Losing a log
 * line because of a bad regex is not an acceptable failure mode for a system
 * whose whole job is keeping log lines.
 */
export function normalize(sourceType: SourceType, input: ParserInput): CanonicalEvent {
  try {
    const event = PARSERS[sourceType](input);
    // A parser is allowed to be wrong about content, but not about shape.
    if (!(event.ts instanceof Date) || Number.isNaN(event.ts.getTime())) {
      event.ts = input.receivedAt;
    }
    return event;
  } catch (err) {
    return unparsed(sourceType, input, `parser threw: ${(err as Error).message}`);
  }
}

export type { CanonicalEvent, ParserInput, SourceType } from './schema.js';
export { SOURCE_TYPES, isSourceType } from './schema.js';
