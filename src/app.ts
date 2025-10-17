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

  // Website routes for https://autobotocean.com/asi
  app.get('/ASI', (_req, res) => {
    res.sendFile('/var/www/html/asi_landing.html');
  });

  app.get('/ASI_Alliance_MASTER_FET_Analysis.csv', (_req, res) => {
    res.download('/var/www/html/ASI_Alliance_MASTER_FET_Analysis.csv', 'ASI_Alliance_MASTER_FET_Analysis.csv');
  });

  app.get('/ASI_Alliance_Summary_Pivot.csv', (_req, res) => {
    res.download('/var/www/html/ASI_Alliance_Summary_Pivot.csv', 'ASI_Alliance_Summary_Pivot.csv');
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
