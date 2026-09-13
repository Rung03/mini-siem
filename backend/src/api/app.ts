// ประกอบ Express app: header ความปลอดภัย, ingest, route ทั้งหมด และ error handler

import { timingSafeEqual } from 'node:crypto';
import express, { type Express, type Request } from 'express';
import { config } from '../config.js';
import { attachActor, clientIp, requireAuth, requireJsonMutation } from '../auth/rbac.js';
import { ingestRouter } from '../ingest/http.js';
import { handleUpload } from '../ingest/upload.js';
import { registerGauge, renderMetrics } from '../observability/metrics.js';
import { batcher } from '../pipeline/batcher.js';
import { FixedWindowLimiter, limitRequests } from './ratelimit.js';
import { adminRouter } from './routes/admin.js';
import { alertsRouter } from './routes/alerts.js';
import { authRouter } from './routes/auth.js';
import { collectorsRouter } from './routes/collectors.js';
import { eventsRouter } from './routes/events.js';
import { rulesRouter } from './routes/rules.js';
import { statsRouter } from './routes/stats.js';
import { errorMiddleware } from './util.js';

registerGauge('siem_batcher_queue_depth', 'Syslog events waiting to be written', () =>
  batcher.queueDepth,
);

function metricsTokenMatches(req: Request, expected: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization?.trim() ?? '');
  if (!m) return false;
  const given = Buffer.from(m[1]!.trim());
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.api.trustProxyHops);

  const byClientIp = (req: Request) => req.clientIp ?? null;
  const loginLimiter = new FixedWindowLimiter(config.security.loginRatePerMinute, 60_000);
  const ingestLimiter = new FixedWindowLimiter(config.security.ingestRatePerMinute, 60_000);

  app.use((req, res, next) => {
    req.clientIp = clientIp(req) ?? undefined;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      profile: config.profile,
      queue_depth: batcher.queueDepth,
    });
  });

  app.post('/ingest', limitRequests(ingestLimiter, 'ingest', byClientIp));
  app.use('/', ingestRouter());

  app.use(express.json({ limit: '1mb' }));
  app.use(attachActor);

  const api = express.Router();
  api.use(requireJsonMutation);
  api.post('/auth/login', limitRequests(loginLimiter, 'login', byClientIp));
  api.use(authRouter());

  api.get('/metrics', (req, res) => {
    const token = config.api.metricsToken;
    const allowed = token ? metricsTokenMatches(req, token) : req.actor?.role === 'admin';
    if (!allowed) {
      res.status(token ? 401 : 403).json({
        error: token ? 'metrics token required' : 'administrator role required',
      });
      return;
    }
    res.type('text/plain; version=0.0.4').send(renderMetrics());
  });

  api.use(eventsRouter());
  api.use(statsRouter());
  api.use(alertsRouter());
  api.use(rulesRouter());
  api.use(collectorsRouter());
  api.use(adminRouter());

  api.post('/ingest/file', requireAuth, (req, res) => {
    void handleUpload(req, res);
  });

  app.use('/api', api);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'no such endpoint' });
  });

  app.use(errorMiddleware);

  return app;
}
