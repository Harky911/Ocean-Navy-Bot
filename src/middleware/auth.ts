import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function validateWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-webhook-secret'];

  // If no secret provided, allow but log (for webhook provider verification)
  if (!secret) {
    logger.info({ ip: req.ip, path: req.path, body: req.body }, 'Webhook request without secret (verification or test)');
    next();
    return;
  }

  // If secret provided, validate it
  if (secret !== env.WEBHOOK_SECRET) {
    logger.warn({ ip: req.ip, path: req.path }, 'Invalid webhook secret');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

export function validateIpAllowlist(req: Request, res: Response, next: NextFunction): void {
  if (!env.IP_ALLOWLIST) {
    next();
    return;
  }

  const allowedIps = env.IP_ALLOWLIST.split(',').map(ip => ip.trim());
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || '';

  if (!allowedIps.includes(clientIp)) {
    logger.warn({ ip: clientIp, path: req.path }, 'IP not in allowlist');
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}
