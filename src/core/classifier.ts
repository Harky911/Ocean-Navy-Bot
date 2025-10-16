import { SwapEvent, BuyAlert } from './types.js';
import { getExplorerUrl } from '../config/constants.js';
import { formatOcean, oceanToNumber } from '../utils/bigint.js';
import { priceService } from '../services/price.js';
import { balanceService } from '../services/balance.js';

export async function classifyBuys(events: SwapEvent[], minOceanAlert: number): Promise<BuyAlert[]> {
  const buys: BuyAlert[] = [];

  // Fetch price once for all buys (cached for 1 minute)
  const oceanPrice = await priceService.getOceanUsdPrice();

  for (const event of events) {
    if (!event.isBuy) continue;

    const formatted = formatOcean(event.oceanAmount);
    const amount = oceanToNumber(event.oceanAmount);

    if (amount < minOceanAlert) continue;

    const buyAlert: BuyAlert = {
      oceanAmount: event.oceanAmount,
      oceanFormatted: formatted,
      chainName: event.chainName,
      dex: event.dex,
      poolLabel: event.poolLabel,
      txHash: event.transactionHash,
      txUrl: getExplorerUrl(event.chainId, event.transactionHash),
    };

    // Add USD value if price is available
    if (oceanPrice !== null) {
      const formattedUsd = priceService.formatUsdValue(amount, oceanPrice);
      if (formattedUsd !== null) {
        buyAlert.usdValue = formattedUsd;
      }
    }

    // Add wallet status if buyer address is available
    if (event.buyerAddress) {
      buyAlert.buyerAddress = event.buyerAddress;
      buyAlert.buyerShort = balanceService.shortenAddress(event.buyerAddress);

      const walletStatus = await balanceService.getWalletStatus(
        event.buyerAddress,
        event.oceanAmount,
        event.chainId,
        event.blockNumber
      );

      if (walletStatus) {
        buyAlert.isNewHolder = walletStatus.isNewHolder;
        buyAlert.previousBalance = balanceService.formatBalance(walletStatus.previousBalance);
        buyAlert.newBalance = balanceService.formatBalance(walletStatus.newBalance);
      }
    }

    buys.push(buyAlert);
  }

  return buys;
}
