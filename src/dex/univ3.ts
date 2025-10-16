import { decodeEventLog } from 'viem';
import { DexLog, SwapEvent } from '../core/types.js';
import { OCEAN_TOKEN } from '../config/constants.js';
import { getPoolByAddress } from '../config/pools.js';
import univ3PoolAbi from '../abis/univ3pool.json' with { type: 'json' };
import { logger } from '../utils/logger.js';

export function decodeUniswapV3Swap(log: DexLog): SwapEvent | null {
  try {
    const pool = getPoolByAddress(log.address);
    if (!pool || pool.type !== 'uniswap-v3') {
      return null;
    }

    const decoded = decodeEventLog({
      abi: univ3PoolAbi,
      data: log.data as `0x${string}`,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    });

    if (decoded.eventName !== 'Swap') {
      return null;
    }

    const args = decoded.args as unknown as {
      sender: string;
      recipient: string;
      amount0: bigint;
      amount1: bigint;
    };
    const { amount0, amount1, recipient } = args;

    const oceanIsToken0 = pool.token0.toLowerCase() === OCEAN_TOKEN.address;
    const oceanAmount = oceanIsToken0 ? amount0 : amount1;

    const isBuy = oceanAmount < 0n;
    const absOceanAmount = oceanAmount < 0n ? -oceanAmount : oceanAmount;

    logger.debug({
      txHash: log.transactionHash,
      pool: pool.label,
      oceanIsToken0,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
      isBuy,
      absOceanAmount: absOceanAmount.toString(),
    }, 'Decoded Uniswap v3 Swap');

    return {
      dex: 'uniswap-v3',
      chainId: pool.chainId,
      chainName: pool.chainName,
      poolLabel: pool.label,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      oceanAmount: absOceanAmount,
      isBuy,
      buyerAddress: isBuy ? recipient.toLowerCase() : undefined,
      removed: log.removed,
    };
  } catch (error) {
    logger.error({ error, log }, 'Failed to decode Uniswap v3 swap');
    return null;
  }
}
