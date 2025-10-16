import { createPublicClient, http, formatUnits, Address } from 'viem';
import { mainnet, polygon } from 'viem/chains';
import { OCEAN_TOKEN, OCEAN_TOKEN_BY_CHAIN } from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import erc20Abi from '../abis/erc20.json' with { type: 'json' };

const clients = {
  1: createPublicClient({
    chain: mainnet,
    transport: http(`https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`),
  }),
  137: createPublicClient({
    chain: polygon,
    transport: http(`https://polygon-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`),
  }),
};

interface WalletStatus {
  previousBalance: bigint;
  newBalance: bigint;
  isNewHolder: boolean;
}

class BalanceService {
  async getWalletStatus(
    walletAddress: string,
    swapAmount: bigint,
    chainId: number,
    blockNumber: number
  ): Promise<WalletStatus | null> {
    try {
      const client = clients[chainId as keyof typeof clients];
      if (!client) {
        logger.warn({ chainId }, 'Unsupported chain for balance queries');
        return null;
      }

      // Get the correct OCEAN token address for this chain
      const oceanToken = OCEAN_TOKEN_BY_CHAIN[chainId] || OCEAN_TOKEN;

      // Get balance BEFORE the swap (at block - 1)
      const previousBalance = await client.readContract({
        address: oceanToken.address as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress as Address],
        blockNumber: BigInt(blockNumber - 1),
      }) as bigint;

      // Get balance AFTER the swap (at the swap block)
      const newBalance = await client.readContract({
        address: oceanToken.address as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [walletAddress as Address],
        blockNumber: BigInt(blockNumber),
      }) as bigint;

      // New holder if previous balance was 0
      const isNewHolder = previousBalance === 0n;

      logger.debug({
        walletAddress,
        chainId,
        previousBalance: formatUnits(previousBalance, OCEAN_TOKEN.decimals),
        newBalance: formatUnits(newBalance, OCEAN_TOKEN.decimals),
        swapAmount: formatUnits(swapAmount, OCEAN_TOKEN.decimals),
        isNewHolder,
      }, 'Wallet status fetched');

      return { previousBalance, newBalance, isNewHolder };
    } catch (error) {
      logger.error({ 
        error: error instanceof Error ? error.message : String(error), 
        walletAddress, 
        chainId,
        blockNumber 
      }, 'Failed to fetch wallet status');
      return null;
    }
  }

  formatBalance(balance: bigint): string {
    return parseFloat(formatUnits(balance, OCEAN_TOKEN.decimals)).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  shortenAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}

export const balanceService = new BalanceService();

