export interface DexLog {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
  removed?: boolean;
}

export interface SwapEvent {
  dex: 'uniswap-v2' | 'uniswap-v3' | 'balancer-v2';
  chainId: number;
  chainName: string;
  poolLabel: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
  oceanAmount: bigint;
  isBuy: boolean;
  removed?: boolean;
}

export interface BuyAlert {
  oceanAmount: bigint;
  oceanFormatted: string;
  chainName: string;
  dex: string;
  poolLabel: string;
  txHash: string;
  txUrl: string;
}

export interface ChatConfig {
  chatId: string;
  enabled: boolean;
  minOceanAlert: number;
  createdAt: string;
  updatedAt: string;
}
