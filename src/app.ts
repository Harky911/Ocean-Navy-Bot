import express from 'express';
import { handleWebhook } from './providers/webhook.js';
import { validateWebhookSecret, validateIpAllowlist } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { logger } from './utils/logger.js';

export function createApp(): express.Application {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use((req, _res, next) => {
    logger.debug({
      method: req.method,
      path: req.path,
      ip: req.ip,
    }, 'Incoming request');
    next();
  });

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/', (_req, res) => {
    res.status(200).json({
      name: 'Ocean Navy Bot',
      version: '1.0.0',
      status: 'running',
    });
  });

  app.post('/webhook',
    validateIpAllowlist,
    validateWebhookSecret,
    handleWebhook
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
