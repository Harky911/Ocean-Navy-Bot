import { DexLog } from './types.js';
import { logger } from '../utils/logger.js';

export function normalizeLogs(payload: any): DexLog[] {
  try {
    const logs = payload.logs || payload.txs?.[0]?.logs || [];
    return logs.map((log: any) => {
      // Moralis sends topics as topic0, topic1, topic2, topic3
      // Convert to topics array
      let topics = log.topics;
      if (!topics && log.topic0) {
        topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(t => t !== null && t !== undefined);
      }

      return {
        address: log.address.toLowerCase(),
        topics: topics || [],
        data: log.data,
        transactionHash: log.transactionHash,
        logIndex: typeof log.logIndex === 'string' ? parseInt(log.logIndex, 16) : log.logIndex,
        blockNumber: typeof log.blockNumber === 'string' ? parseInt(log.blockNumber, 16) : log.blockNumber,
        removed: log.removed || false,
      };
    });
  } catch (error) {
    logger.error({ error, payload }, 'Failed to normalize logs');
    return [];
  }
}
