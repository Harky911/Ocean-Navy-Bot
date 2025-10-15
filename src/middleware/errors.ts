import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error({
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
  }, 'Unhandled error');

  res.status(500).json({ error: 'Internal server error' });
}

export function notFoundHandler(req: Request, res: Response): void {
  logger.warn({ method: req.method, path: req.path }, 'Route not found');
  res.status(404).json({ error: 'Not found' });
}
