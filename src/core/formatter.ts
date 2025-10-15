import { BuyAlert } from './types.js';

export function formatBuyAlert(buy: BuyAlert): string {
  return [
    `🚀 *OCEAN BUY*`,
    ``,
    `💰 Amount: *${buy.oceanFormatted} OCEAN*`,
    `⛓️  Chain: ${buy.chainName}`,
    `🏦 DEX: ${buy.poolLabel}`,
    `🔗 [View Transaction](${buy.txUrl})`,
  ].join('\n');
}

export function formatBatchAlert(buys: BuyAlert[]): string {
  const totalFormatted = buys.reduce((sum, buy) => sum + parseFloat(buy.oceanFormatted), 0);

  const lines = [
    `🚀 *${buys.length} OCEAN BUYS*`,
    ``,
    `💰 Total: *${totalFormatted.toFixed(2)} OCEAN*`,
    ``,
  ];

  for (const buy of buys) {
    lines.push(`• ${buy.oceanFormatted} OCEAN on ${buy.poolLabel}`);
    lines.push(`  [TX](${buy.txUrl})`);
  }

  return lines.join('\n');
}
