export interface UniV2Pool {
  type: 'uniswap-v2';
  chainId: number;
  chainName: string;
  address: string;
  token0: string;
  token1: string;
  label: string;
}

export interface UniV3Pool {
  type: 'uniswap-v3';
  chainId: number;
  chainName: string;
  address: string;
  token0: string;
  token1: string;
  fee: number;
  label: string;
}

export interface BalancerV2Pool {
  type: 'balancer-v2';
  chainId: number;
  chainName: string;
  poolId: string;
  address: string;
  tokens: string[];
  label: string;
}

export type Pool = UniV2Pool | UniV3Pool | BalancerV2Pool;

export const KNOWN_POOLS: Pool[] = [
  // ===== ETHEREUM MAINNET (Chain ID: 1) =====
  {
    type: 'uniswap-v2',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x9b7dad79fc16106b47a3dab791f389c167e15eb0',
    token0: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48',
    token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    label: 'Uniswap v2 OCEAN/WETH',
  },
  {
    type: 'uniswap-v3',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x283e2e83b7f3e297c4b7c02114ab0196b001a109',
    token0: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48',
    token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    fee: 3000,
    label: 'Uniswap v3 OCEAN/WETH 0.3%',
  },
  {
    type: 'uniswap-v3',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x98785fda382725d2d6b5022bf78b30eeaefdc387',
    token0: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48',
    token1: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    fee: 3000,
    label: 'Uniswap v3 OCEAN/USDT 0.3%',
  },
  {
    type: 'balancer-v2',
    chainId: 1,
    chainName: 'Ethereum',
    poolId: '0xf8c4cd95c7496cb7c8d97202cf7e5b8da2204c2b000200000000000000000000',
    address: '0xf8c4cd95c7496cb7c8d97202cf7e5b8da2204c2b',
    tokens: ['0x967da4048cd07ab37855c090aaf366e4ce1b9f48'],
    label: 'Balancer v2 psdnOCEAN/OCEAN',
  },

  // ===== POLYGON (Chain ID: 137) =====
  {
    type: 'uniswap-v2',
    chainId: 137,
    chainName: 'Polygon',
    address: '0x5a94f81d25c73eddbdd84b84e8f6d36c58270510',
    token0: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
    token1: '0x282d8efce846a88b159800bd4130ad77443fa1a1', // mOCEAN
    label: 'QuickSwap OCEAN/WMATIC',
  },

  // ===== OPTIMISM (Chain ID: 10) =====
  // To be added once we find actual pool addresses on Optimism

  // ===== BNB CHAIN (Chain ID: 56) =====
  // To be added once we find actual pool addresses on BNB Chain
];

export function getPoolByAddress(address: string): Pool | undefined {
  return KNOWN_POOLS.find(p => p.address.toLowerCase() === address.toLowerCase());
}
