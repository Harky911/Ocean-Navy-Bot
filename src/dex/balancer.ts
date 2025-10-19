import { decodeEventLog } from 'viem';
import { DexLog, SwapEvent } from '../core/types.js';
import { OCEAN_TOKEN } from '../config/constants.js';
import { KNOWN_POOLS } from '../config/pools.js';
import balancerVaultAbi from '../abis/balancerVault.json' assert { type: 'json' };
import { logger } from '../utils/logger.js';

export function decodeBalancerV2Swap(log: DexLog): SwapEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: balancerVaultAbi,
      data: log.data as `0x${string}`,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    });

    if (decoded.eventName !== 'Swap') {
      return null;
    }

    const args = decoded.args as unknown as {
      poolId: string;
      tokenIn: string;
      tokenOut: string;
      amountIn: bigint;
      amountOut: bigint;
    };
    const { poolId, tokenOut, amountOut } = args;

    const pool = KNOWN_POOLS.find(
      p => p.type === 'balancer-v2' && p.poolId.toLowerCase() === poolId.toLowerCase()
    );

    if (!pool) {
      return null;
    }

    const isBuy = tokenOut.toLowerCase() === OCEAN_TOKEN.address;

    if (!isBuy) {
      return null;
    }

    logger.debug({
      txHash: log.transactionHash,
      pool: pool.label,
      tokenOut,
      amountOut: amountOut.toString(),
      isBuy,
    }, 'Decoded Balancer v2 Swap');

    return {
      dex: 'balancer-v2',
      chainId: pool.chainId,
      chainName: pool.chainName,
      poolLabel: pool.label,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      oceanAmount: amountOut,
      isBuy,
      buyerAddress: log.transactionFrom,
      removed: log.removed,
    };
  } catch (error) {
    logger.error({ error, log }, 'Failed to decode Balancer v2 swap');
    return null;
  }
}
