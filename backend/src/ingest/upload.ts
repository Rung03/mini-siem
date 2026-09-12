import Busboy from 'busboy';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { auditIn } from '../audit/log.js';
import { withActor } from '../db/tenant.js';
import { normalize } from '../normalize/index.js';
import type { CanonicalEvent } from '../normalize/schema.js';
import { insertEvents } from '../pipeline/writer.js';
import { resolveById } from './collectors.js';
import { extractPayloads, type ExtractedPayload } from './http.js';

/**
 * POST /api/ingest/file — the batch channel, for historical exports from AWS,
 * Active Directory or CrowdStrike.
 *
 * This one is authenticated as a signed-in user rather than by collector token,
 * because a person is doing it by hand. The collector still decides the tenant
 * and the parser; resolveById refuses a collector the caller's tenant does not
 * own, so a Viewer cannot upload into another customer's channel.
 */

interface UploadResult {
  filename: string;
  accepted: number;
  unparsed: number;
}

/** A CSV export, header row and all, turned into per-row JSON objects. */
function parseCsv(text: string): ExtractedPayload[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headerLine = lines.shift();
  if (!headerLine) return [];

  const split = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else quoted = false;
        } else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  };

  const headers = split(headerLine);
  return lines.map((line) => {
    const cells = split(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = cells[i] ?? '';
    });
    return { raw: line, json: obj };
  });
}

function payloadsFor(filename: string, text: string): ExtractedPayload[] {
  if (/\.csv$/i.test(filename) || /\.tsv$/i.test(filename)) {
    const rows = parseCsv(text);
    if (rows.length > 0) return rows;
  }
  return extractPayloads(text);
}

export async function handleUpload(req: Request, res: Response): Promise<void> {
  const actor = req.actor!;

  let busboy: Busboy.Busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: config.ingest.uploadMaxBytes, fields: 5 },
    });
  } catch {
    res.status(400).json({ error: 'expected a multipart/form-data upload' });
    return;
  }

  let collectorId = '';
  let filename = 'upload';
  let truncated = false;
  const chunks: Buffer[] = [];
  let finished = false;

  const fail = (status: number, message: string) => {
    if (finished) return;
    finished = true;
    req.unpipe(busboy);
    res.status(status).json({ error: message });
  };

  busboy.on('field', (name, value) => {
    if (name === 'collector_id') collectorId = value.trim();
  });

  busboy.on('file', (_name, stream, info) => {
    filename = info.filename || filename;
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('limit', () => {
      truncated = true;
      stream.resume();
    });
  });

  busboy.on('error', () => fail(400, 'could not read the upload'));

  busboy.on('close', () => {
    void (async () => {
      if (finished) return;

      if (truncated) {
        fail(413, `file exceeds the ${config.ingest.uploadMaxBytes} byte limit`);
        return;
      }
      if (!collectorId) {
        fail(400, 'collector_id is required');
        return;
      }
      if (chunks.length === 0) {
        fail(400, 'no file in the request');
        return;
      }

      const collector = await resolveById(collectorId, actor.tenantId);
      if (!collector) {
        fail(404, 'unknown collector');
        return;
      }

      const text = Buffer.concat(chunks).toString('utf8');
      const payloads = payloadsFor(filename, text);
      if (payloads.length === 0) {
        fail(400, 'no events found in the file');
        return;
      }

      const receivedAt = new Date();
      const events: CanonicalEvent[] = payloads.map((p) =>
        normalize(collector.sourceType, {
          raw: p.raw,
          json: p.json,
          receivedAt,
          peerIp: null,
        }),
      );

      // Write in slices so one oversized file does not become one enormous
      // transaction holding locks on every partition it touches.
      const size = config.ingest.writeBatchSize;
      let accepted = 0;
      for (let i = 0; i < events.length; i += size) {
        accepted += await insertEvents({
          tenantId: collector.tenantId,
          collectorId: collector.collectorId,
          events: events.slice(i, i + size),
        });
      }

      const result: UploadResult = {
        filename,
        accepted,
        unparsed: events.filter((e) => !e.parseOk).length,
      };

      await withActor(actor, (db) =>
        auditIn(db, actor, {
          action: 'ingest.file_upload',
          targetType: 'collector',
          targetId: collector.collectorId,
          tenantId: collector.tenantId,
          details: { ...result },
          srcIp: req.clientIp ?? null,
        }),
      );

      finished = true;
      res.status(200).json(result);
    })().catch((err) => {
      console.error('[ingest/file] upload failed', err);
      fail(500, 'could not store the uploaded events');
    });
  });

  req.pipe(busboy);
}
