import { DexLog } from './types.js';
import { logger } from '../utils/logger.js';

export function normalizeLogs(payload: any): DexLog[] {
  try {
    // Support multiple webhook providers:
    // - Moralis: payload.logs or payload.txs[0].logs
    // - Alchemy GraphQL: payload.event.data.block.logs
    const logs = payload.logs || payload.txs?.[0]?.logs || payload.event?.data?.block?.logs || [];
    
    // For Alchemy GraphQL, blockNumber is in the parent block object
    const alchemyBlockNumber = payload.event?.data?.block?.number;
    
    return logs.map((log: any) => {
      // Moralis sends topics as topic0, topic1, topic2, topic3
      // Convert to topics array
      let topics = log.topics;
      if (!topics && log.topic0) {
        topics = [log.topic0, log.topic1, log.topic2, log.topic3].filter(t => t !== null && t !== undefined);
      }

      // Get blockNumber from log or parent block (Alchemy GraphQL)
      let blockNumber = log.blockNumber;
      if (!blockNumber && alchemyBlockNumber) {
        blockNumber = alchemyBlockNumber;
      }
      
      // Parse blockNumber
      const parsedBlockNumber = typeof blockNumber === 'string' 
        ? parseInt(blockNumber, 16) 
        : (typeof blockNumber === 'number' ? blockNumber : 0);

      return {
        address: (log.address || log.account?.address || '').toLowerCase(),
        topics: topics || [],
        data: log.data,
        transactionHash: log.transactionHash || log.transaction?.hash,
        transactionFrom: (log.transaction?.from?.address || log.transaction?.from || '').toLowerCase() || undefined,
        logIndex: typeof log.logIndex === 'string' ? parseInt(log.logIndex, 16) : (typeof log.index === 'number' ? log.index : parseInt(log.index || '0', 16)),
        blockNumber: parsedBlockNumber,
        removed: log.removed || false,
      };
    });
  } catch (error) {
    logger.error({ error, payload }, 'Failed to normalize logs');
    return [];
  }
}
