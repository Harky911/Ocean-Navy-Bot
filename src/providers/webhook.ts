import { Request, Response } from 'express';
import { normalizeLogs } from '../core/normalizer.js';
import { decodeLogs } from '../core/decoder.js';
import { classifyBuys } from '../core/classifier.js';
import { DedupeManager } from '../core/dedupe.js';
import { telegramClient } from '../telegram/client.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

const dedupeManager = new DedupeManager();

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    logger.info({ body: req.body }, 'Received webhook');

    const logs = normalizeLogs(req.body);
    logger.debug({ count: logs.length }, 'Normalized logs');

    if (logs.length === 0) {
      res.status(200).json({ success: true, processed: 0 });
      return;
    }

    const events = decodeLogs(logs);
    logger.debug({ count: events.length }, 'Decoded swap events');

    // Filter out duplicates and reorgs
    const uniqueEvents = [];
    for (const event of events) {
      if (event.removed) {
        dedupeManager.handleReorg(event.transactionHash, event.logIndex);
        continue;
      }

      if (dedupeManager.isDuplicate(event.transactionHash, event.logIndex)) {
        logger.debug({ txHash: event.transactionHash, logIndex: event.logIndex }, 'Skipping duplicate');
        continue;
      }

      dedupeManager.markSeen(event.transactionHash, event.logIndex);
      uniqueEvents.push(event);
    }

    const buys = await classifyBuys(uniqueEvents, env.MIN_OCEAN_ALERT);
    logger.info({ count: buys.length }, 'Classified buys');

    for (const buy of buys) {
      await telegramClient.broadcastBuyAlert(buy);
    }

    res.status(200).json({ success: true, processed: buys.length });
  } catch (error) {
    logger.error({ error }, 'Error processing webhook');
    res.status(500).json({ error: 'Internal server error' });
  }
}
