import { DexLog } from './types.js';
import { OCEAN_TOKEN_BY_CHAIN } from '../config/constants.js';
import { decodeEventLog } from 'viem';
import { logger } from '../utils/logger.js';

// ERC20 Transfer event signature
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const erc20TransferAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: false, name: 'value', type: 'uint256' },
    ],
    name: 'Transfer',
    type: 'event',
  },
] as const;

interface TransferEvent {
  transactionHash: string;
  from: string;
  to: string;
  value: bigint;
  logIndex: number;
}

/**
 * Extracts OCEAN Transfer events from logs
 */
export function extractTransferEvents(logs: DexLog[], chainId: number): TransferEvent[] {
  const oceanToken = OCEAN_TOKEN_BY_CHAIN[chainId];
  if (!oceanToken) {
    return [];
  }

  const transfers: TransferEvent[] = [];

  for (const log of logs) {
    // Check if this is a Transfer event from OCEAN token
    if (
      log.address === oceanToken.address.toLowerCase() &&
      log.topics[0] === TRANSFER_TOPIC
    ) {
      try {
        const decoded = decodeEventLog({
          abi: erc20TransferAbi,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });

        if (decoded.eventName === 'Transfer') {
          const args = decoded.args as { from: string; to: string; value: bigint };
          
          transfers.push({
            transactionHash: log.transactionHash,
            from: args.from.toLowerCase(),
            to: args.to.toLowerCase(),
            value: args.value,
            logIndex: log.logIndex,
          });

          logger.debug({
            txHash: log.transactionHash,
            from: args.from,
            to: args.to,
            value: args.value.toString(),
            logIndex: log.logIndex,
          }, 'Decoded OCEAN Transfer event');
        }
      } catch (error) {
        logger.error({ error, log }, 'Failed to decode Transfer event');
      }
    }
  }

  return transfers;
}

/**
 * Finds the actual OCEAN recipient from Transfer events for a given Swap
 * Returns the 'to' address from the Transfer event that happened after the Swap
 */
export function findOceanRecipient(
  swapTxHash: string,
  swapLogIndex: number,
  transferEvents: TransferEvent[],
  poolAddress: string
): string | undefined {
  // Find all OCEAN transfers in the same transaction
  const txTransfers = transferEvents.filter(t => t.transactionHash === swapTxHash);

  if (txTransfers.length === 0) {
    return undefined;
  }

  // Strategy 1: Find Transfer from pool address that happens after the Swap
  // (Most common case: pool sends OCEAN directly to recipient)
  const poolTransfer = txTransfers.find(
    t => t.from === poolAddress.toLowerCase() && t.logIndex > swapLogIndex
  );

  if (poolTransfer) {
    logger.debug({
      txHash: swapTxHash,
      recipient: poolTransfer.to,
      strategy: 'pool-direct',
    }, 'Found OCEAN recipient via pool transfer');
    return poolTransfer.to;
  }

  // Strategy 2: Find the last Transfer in the transaction
  // (Router/aggregator case: intermediate transfers then final recipient)
  const lastTransfer = txTransfers
    .filter(t => t.logIndex > swapLogIndex)
    .sort((a, b) => b.logIndex - a.logIndex)[0];

  if (lastTransfer) {
    logger.debug({
      txHash: swapTxHash,
      recipient: lastTransfer.to,
      strategy: 'last-transfer',
    }, 'Found OCEAN recipient via last transfer');
    return lastTransfer.to;
  }

  // Strategy 3: Fallback - any Transfer after the Swap
  const anyTransfer = txTransfers.find(t => t.logIndex > swapLogIndex);
  if (anyTransfer) {
    logger.debug({
      txHash: swapTxHash,
      recipient: anyTransfer.to,
      strategy: 'any-transfer',
    }, 'Found OCEAN recipient via any transfer');
    return anyTransfer.to;
  }

  return undefined;
}

