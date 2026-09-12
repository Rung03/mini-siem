import express, { type Express } from 'express';
import { config } from '../config.js';
import { attachActor, requireAuth, requireJsonMutation } from '../auth/rbac.js';
import { ingestRouter } from '../ingest/http.js';
import { handleUpload } from '../ingest/upload.js';
import { batcher } from '../pipeline/batcher.js';
import { adminRouter } from './routes/admin.js';
import { alertsRouter } from './routes/alerts.js';
import { authRouter } from './routes/auth.js';
import { collectorsRouter } from './routes/collectors.js';
import { eventsRouter } from './routes/events.js';
import { rulesRouter } from './routes/rules.js';
import { statsRouter } from './routes/stats.js';
import { errorMiddleware } from './util.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.api.trustProxyHops);

  app.use((_req, res, next) => {
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

  app.use('/', ingestRouter());

  app.use(express.json({ limit: '1mb' }));
  app.use(attachActor);

  const api = express.Router();
  api.use(requireJsonMutation);
  api.use(authRouter());
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
