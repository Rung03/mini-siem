import { Router } from 'express';
import express from 'express';
import { config } from '../config.js';
import { normalize } from '../normalize/index.js';
import type { CanonicalEvent, SourceType } from '../normalize/schema.js';
import { insertEvents } from '../pipeline/writer.js';
import { recordDrop } from '../pipeline/writer.js';
import { resolveByToken } from './collectors.js';

export interface ExtractedPayload {
  raw: string;
  json?: unknown;
}

export function extractPayloads(body: string): ExtractedPayload[] {
  const text = body.trim();
  if (!text) return [];

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);

      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({ raw: JSON.stringify(item), json: item }));
      }

      if (parsed && typeof parsed === 'object') {
        const records = (parsed as Record<string, unknown>).Records;
        if (Array.isArray(records)) {
          return records.map((item) => ({ raw: JSON.stringify(item), json: item }));
        }
        return [{ raw: text, json: parsed }];
      }
    } catch {
    }
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith('{')) {
        try {
          return { raw: line, json: JSON.parse(line) as unknown };
        } catch {
          return { raw: line };
        }
      }
      return { raw: line };
    });
}

export function normalizePayloads(
  sourceType: SourceType,
  payloads: ExtractedPayload[],
  peerIp: string | null,
): CanonicalEvent[] {
  const receivedAt = new Date();
  return payloads.map((p) =>
    normalize(sourceType, {
      raw: p.raw,
      json: p.json,
      receivedAt,
      peerIp,
    }),
  );
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

export function ingestRouter(): Router {
  const router = Router();

  const asText = express.text({
    type: () => true,
    limit: config.ingest.maxBodyBytes,
    defaultCharset: 'utf-8',
  });

  router.post('/ingest', asText, async (req, res) => {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }

    const collector = await resolveByToken(token);
    if (!collector) {
      res.status(401).json({ error: 'unknown collector token' });
      return;
    }

    const body = typeof req.body === 'string' ? req.body : '';
    const payloads = extractPayloads(body);

    if (payloads.length === 0) {
      res.status(400).json({ error: 'empty payload' });
      return;
    }

    if (payloads.length > config.ingest.maxBatch) {
      await recordDrop(
        collector.tenantId,
        'http',
        `batch of ${payloads.length} exceeds limit ${config.ingest.maxBatch}`,
        req.clientIp ?? null,
        null,
      );
      res.status(413).json({
        error: `batch too large: ${payloads.length} events, limit is ${config.ingest.maxBatch}`,
      });
      return;
    }

    const events = normalizePayloads(collector.sourceType, payloads, req.clientIp ?? null);

    try {
      const written = await insertEvents({
        tenantId: collector.tenantId,
        collectorId: collector.collectorId,
        events,
      });

      res.status(200).json({
        accepted: written,
        unparsed: events.filter((e) => !e.parseOk).length,
        source_type: collector.sourceType,
      });
    } catch (err) {
      console.error('[ingest/http] write failed', err);
      res.status(500).json({ error: 'could not store events' });
    }
  });

  return router;
}
