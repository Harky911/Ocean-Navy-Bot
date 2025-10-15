import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.ENV === 'development' ? 'debug' : 'info',
  transport: env.ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});
