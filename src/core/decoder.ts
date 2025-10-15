import { DexLog, SwapEvent } from './types.js';
import { decodeUniswapV2Swap } from '../dex/univ2.js';
import { decodeUniswapV3Swap } from '../dex/univ3.js';
import { decodeBalancerV2Swap } from '../dex/balancer.js';
import { UNISWAP_V2_SWAP_TOPIC, UNISWAP_V3_SWAP_TOPIC, BALANCER_SWAP_TOPIC } from '../config/constants.js';

export function decodeLogs(logs: DexLog[]): SwapEvent[] {
  const events: SwapEvent[] = [];

  for (const log of logs) {
    const topic = log.topics[0]?.toLowerCase();

    if (topic === UNISWAP_V2_SWAP_TOPIC.toLowerCase()) {
      const event = decodeUniswapV2Swap(log);
      if (event) events.push(event);
    } else if (topic === UNISWAP_V3_SWAP_TOPIC.toLowerCase()) {
      const event = decodeUniswapV3Swap(log);
      if (event) events.push(event);
    } else if (topic === BALANCER_SWAP_TOPIC.toLowerCase()) {
      const event = decodeBalancerV2Swap(log);
      if (event) events.push(event);
    }
  }

  return events;
}
