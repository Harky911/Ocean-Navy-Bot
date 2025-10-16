import { env } from './env.js';

export const OCEAN_TOKEN = {
  address: env.OCEAN_ADDRESS.toLowerCase() as `0x${string}`,
  decimals: 18,
  symbol: 'OCEAN',
} as const;

// OCEAN token addresses by chain ID
export const OCEAN_TOKEN_BY_CHAIN: Record<number, { address: `0x${string}`; decimals: number; symbol: string }> = {
  1: {
    address: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48' as `0x${string}`,
    decimals: 18,
    symbol: 'OCEAN',
  },
  137: {
    address: '0x282d8efce846a88b159800bd4130ad77443fa1a1' as `0x${string}`, // mOCEAN on Polygon
    decimals: 18,
    symbol: 'mOCEAN',
  },
};

export const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'.toLowerCase() as `0x${string}`;

export const UNISWAP_V2_SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
export const UNISWAP_V3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
export const BALANCER_SWAP_TOPIC = '0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b';

// Block explorer URLs by chain ID
export const BLOCK_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',           // Ethereum
  137: 'https://polygonscan.com/tx/',      // Polygon
  10: 'https://optimistic.etherscan.io/tx/', // Optimism
  56: 'https://bscscan.com/tx/',           // BNB Chain
  1285: 'https://moonriver.moonscan.io/tx/', // Moonriver
  246: 'https://explorer.energyweb.org/tx/', // Energy Web Chain
  23294: 'https://explorer.sapphire.oasis.io/tx/', // Oasis Sapphire
};

export function getExplorerUrl(chainId: number, txHash: string): string {
  const base = BLOCK_EXPLORERS[chainId];
  if (!base) {
    // Fallback to Etherscan if chain not found
    return `https://etherscan.io/tx/${txHash}`;
  }
  return `${base}${txHash}`;
}
