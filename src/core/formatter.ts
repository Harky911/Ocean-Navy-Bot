import { BuyAlert } from './types.js';

export function formatBuyAlert(buy: BuyAlert): string {
  const lines = [`🚀 *OCEAN BUY*`, ``];

  // Amount with USD value on separate line for mobile readability
  lines.push(`💰 Amount: *${buy.oceanFormatted} OCEAN*`);
  if (buy.usdValue) {
    lines.push(`💵 Value: ${buy.usdValue}`);
  }

  // Buyer wallet info
  if (buy.buyerShort) {
    lines.push(`👤 Buyer: \`${buy.buyerShort}\``);
    if (buy.isNewHolder) {
      lines.push(`🆕 *NEW HOLDER*`);
      lines.push(`📊 Balance Increase: +${buy.oceanFormatted} OCEAN`);
    } else if (buy.previousBalance && buy.newBalance) {
      lines.push(`📊 Balance: ${buy.previousBalance} → *${buy.newBalance} OCEAN*`);
    }
  }

  lines.push(`⛓️  Chain: ${buy.chainName}`);
  lines.push(`🏦 DEX: ${buy.poolLabel}`);
  lines.push(`🔗 [View Transaction](${buy.txUrl})`);

  return lines.join('\n');
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
