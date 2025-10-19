import { decodeEventLog } from 'viem';
import { DexLog, SwapEvent } from '../core/types.js';
import { OCEAN_TOKEN } from '../config/constants.js';
import { getPoolByAddress } from '../config/pools.js';
import univ2PoolAbi from '../abis/univ2pool.json' assert { type: 'json' };
import { logger } from '../utils/logger.js';

export function decodeUniswapV2Swap(log: DexLog): SwapEvent | null {
  try {
    const pool = getPoolByAddress(log.address);
    if (!pool || pool.type !== 'uniswap-v2') {
      return null;
    }

    const decoded = decodeEventLog({
      abi: univ2PoolAbi,
      data: log.data as `0x${string}`,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    });

    if (decoded.eventName !== 'Swap') {
      return null;
    }

    const args = decoded.args as unknown as {
      sender: string;
      amount0In: bigint;
      amount1In: bigint;
      amount0Out: bigint;
      amount1Out: bigint;
      to: string;
    };

    const { amount0In, amount1In, amount0Out, amount1Out, to } = args;

    // In Uniswap V2:
    // - If OCEAN is token0: amount0Out > 0 = OCEAN leaving pool = BUY
    // - If OCEAN is token1: amount1Out > 0 = OCEAN leaving pool = BUY
    const oceanIsToken0 = pool.token0.toLowerCase() === OCEAN_TOKEN.address;
    const oceanOut = oceanIsToken0 ? amount0Out : amount1Out;
    const oceanIn = oceanIsToken0 ? amount0In : amount1In;

    const isBuy = oceanOut > 0n;
    const oceanAmount = isBuy ? oceanOut : oceanIn;

    logger.debug({
      txHash: log.transactionHash,
      pool: pool.label,
      oceanIsToken0,
      amount0In: amount0In.toString(),
      amount1In: amount1In.toString(),
      amount0Out: amount0Out.toString(),
      amount1Out: amount1Out.toString(),
      isBuy,
      oceanAmount: oceanAmount.toString(),
    }, 'Decoded Uniswap v2 Swap');

    return {
      dex: 'uniswap-v2',
      chainId: pool.chainId,
      chainName: pool.chainName,
      poolLabel: pool.label,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      oceanAmount,
      isBuy,
      buyerAddress: isBuy ? to.toLowerCase() : undefined,
      removed: log.removed,
    };
  } catch (error) {
    logger.error({ error, log }, 'Failed to decode Uniswap v2 swap');
    return null;
  }
}
