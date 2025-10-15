import { SwapEvent, BuyAlert } from './types.js';
import { getExplorerUrl } from '../config/constants.js';
import { formatOcean } from '../utils/bigint.js';

export function classifyBuys(events: SwapEvent[], minOceanAlert: number): BuyAlert[] {
  const buys: BuyAlert[] = [];

  for (const event of events) {
    if (!event.isBuy) continue;

    const formatted = formatOcean(event.oceanAmount);
    const amount = parseFloat(formatted);

    if (amount < minOceanAlert) continue;

    buys.push({
      oceanAmount: event.oceanAmount,
      oceanFormatted: formatted,
      chainName: event.chainName,
      dex: event.dex,
      poolLabel: event.poolLabel,
      txHash: event.transactionHash,
      txUrl: getExplorerUrl(event.chainId, event.transactionHash),
    });
  }

  return buys;
}
