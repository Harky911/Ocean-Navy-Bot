import { DexLog, SwapEvent } from './types.js';
import { decodeUniswapV2Swap } from '../dex/univ2.js';
import { decodeUniswapV3Swap } from '../dex/univ3.js';
import { decodeBalancerV2Swap } from '../dex/balancer.js';
import { UNISWAP_V2_SWAP_TOPIC, UNISWAP_V3_SWAP_TOPIC, BALANCER_SWAP_TOPIC } from '../config/constants.js';
import { extractTransferEvents, findOceanRecipient } from './transfer-matcher.js';
import { getPoolByAddress } from '../config/pools.js';

export function decodeLogs(logs: DexLog[]): SwapEvent[] {
  const events: SwapEvent[] = [];

  // First, extract all Transfer events from the logs
  // Try to determine chainId from the first log's context (we'll need to infer it)
  const chainIds = new Set<number>();
  for (const log of logs) {
    const pool = getPoolByAddress(log.address);
    if (pool) {
      chainIds.add(pool.chainId);
    }
  }

  // Extract transfers for all detected chain IDs
  const allTransfers = Array.from(chainIds).flatMap(chainId =>
    extractTransferEvents(logs, chainId)
  );

  // Now decode Swap events and match with Transfer events
  for (const log of logs) {
    const topic = log.topics[0]?.toLowerCase();
    const pool = getPoolByAddress(log.address);

    if (topic === UNISWAP_V2_SWAP_TOPIC.toLowerCase()) {
      const event = decodeUniswapV2Swap(log);
      if (event && pool) {
        // Try to find actual recipient from Transfer events
        const actualRecipient = findOceanRecipient(
          event.transactionHash,
          event.logIndex,
          allTransfers,
          pool.address
        );
        if (actualRecipient) {
          event.buyerAddress = actualRecipient;
        }
        events.push(event);
      }
    } else if (topic === UNISWAP_V3_SWAP_TOPIC.toLowerCase()) {
      const event = decodeUniswapV3Swap(log);
      if (event && pool) {
        const actualRecipient = findOceanRecipient(
          event.transactionHash,
          event.logIndex,
          allTransfers,
          pool.address
        );
        if (actualRecipient) {
          event.buyerAddress = actualRecipient;
        }
        events.push(event);
      }
    } else if (topic === BALANCER_SWAP_TOPIC.toLowerCase()) {
      const event = decodeBalancerV2Swap(log);
      if (event && pool) {
        const actualRecipient = findOceanRecipient(
          event.transactionHash,
          event.logIndex,
          allTransfers,
          pool.address
        );
        if (actualRecipient) {
          event.buyerAddress = actualRecipient;
        }
        events.push(event);
      }
    }
  }

  return events;
}
