import { ethers } from 'ethers';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Etherscan API response types
interface EtherscanLog {
  blockNumber: string;
  topics: string[];
  data: string;
  timeStamp: string;
}

interface EtherscanResponse {
  status: string;
  message?: string;
  result?: EtherscanLog[] | string;
}

// ABIs (minimal)
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
];

// Constants
const OCEAN = '0x967da4048cd07ab37855c090aaf366e4ce1b9f48';
const WHALE_USD_THRESHOLD = 5000;

// Known OCEAN pool addresses (transfers FROM these are buys)
const KNOWN_OCEAN_POOLS = new Set([
  // Ethereum
  '0x9b7dad79fc16106b47a3dab791f389c167e15eb0'.toLowerCase(), // Uniswap V2 OCEAN/WETH
  '0x283e2e83b7f3e297c4b7c02114ab0196b001a109'.toLowerCase(), // Uniswap V3 OCEAN/WETH 0.3%
  '0x98785fda382725d2d6b5022bf78b30eeaefdc387'.toLowerCase(), // Uniswap V3 OCEAN/USDT 0.3%
  '0xba12222222228d8ba445958a75a0704d566bf2c8'.toLowerCase(), // Balancer V2 Vault
  // Polygon
  '0x5a94f81d25c73eddbdd84b84e8f6d36c58270510'.toLowerCase(), // QuickSwap OCEAN/WMATIC
]);

export interface TopBuyer {
  address: string;
  oceanAmount: number;
  usdValue: number;
}

export interface TopBuyersResult {
  topBuyers: TopBuyer[];
  whaleCount: number;
  totalBuyers: number;
  timePeriod: string;
  oceanUsdPrice: number;
}

/**
 * Parse time period string to hours
 */
function parseTimePeriod(period: string): number {
  const match = period.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid time format: ${period}`);
  }

  const [, amount, unit] = match;
  const num = parseInt(amount);

  switch (unit) {
    case 'm':
      return num / 60; // minutes to hours
    case 'h':
      return num;
    case 'd':
      return num * 24;
    default:
      return 24;
  }
}

/**
 * Fetch top OCEAN buyers by tracking Transfer events across ALL DEXs
 */
export class TopBuyersService {
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      `https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
    );
  }

  /**
   * Get top buyers for a time period
   * @param timePeriod - Time period string (e.g., "5m", "1h", "1d")
   */
  async getTopBuyers(timePeriod: string): Promise<TopBuyersResult | null> {
    try {
      const hours = parseTimePeriod(timePeriod);
      logger.info({ timePeriod, hours }, 'Fetching top buyers');

      // Get OCEAN decimals
      const oceanContract = new ethers.Contract(OCEAN, ERC20_ABI, this.provider);
      const oceanDecimals = await oceanContract.decimals();

      // Get OCEAN/USD price via CoinGecko (simpler than ETH/USD + calculation)
      const oceanUsdPrice = await this.getOceanUsdPrice();
      if (!oceanUsdPrice) {
        logger.error('Failed to fetch OCEAN price');
        return null;
      }

      logger.debug({ oceanUsdPrice }, 'OCEAN/USD price');

      // Calculate block range
      const latestBlock = await this.provider.getBlockNumber();
      const latest = await this.provider.getBlock(latestBlock);
      if (!latest) {
        logger.error('Failed to get latest block');
        return null;
      }

      const fromTs = latest.timestamp - hours * 3600;
      const estBlocks = Math.ceil((hours * 3600) / 12);
      const fromBlock = Math.max(0, latestBlock - estBlocks - 2000);

      logger.debug({ fromBlock, latestBlock, fromTs }, 'Block range');

      // Fetch ALL OCEAN Transfer events (no sender filter)
      const transferTopic = ethers.id('Transfer(address,address,uint256)');
      const logs = await this.fetchLogsViaEtherscan(
        OCEAN,
        transferTopic,
        fromBlock,
        latestBlock,
        hours
      );

      if (!logs) {
        logger.error('Failed to fetch logs');
        return null;
      }

      logger.info({ logCount: logs.length }, 'Fetched transfer logs');

      // Process transfers and aggregate by buyer
      const iface = new ethers.Interface(ERC20_ABI);
      const byBuyer = new Map<string, number>();

      for (const log of logs) {
        // Filter by timestamp
        const ts = log.timeStamp || (await this.provider.getBlock(log.blockNumber))?.timestamp || 0;
        if (ts < fromTs) continue;

        const parsed = iface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (!parsed) continue;

        const { from: sender, to: recipient, value } = parsed.args;
        const oceanAmount = Number(ethers.formatUnits(value, oceanDecimals));

        // Only count transfers FROM known OCEAN pools (these are actual DEX buys)
        if (!KNOWN_OCEAN_POOLS.has(sender.toLowerCase())) {
          continue;
        }

        // Skip if recipient is zero address (burn)
        if (recipient.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
          continue;
        }

        // This is a buy from a pool! Count it
        const key = ethers.getAddress(recipient);
        const prev = byBuyer.get(key) || 0;
        byBuyer.set(key, prev + oceanAmount);
      }

      logger.info({ uniqueBuyers: byBuyer.size }, 'Processed transfers');

      // Calculate whale count
      let whaleCount = 0;
      for (const [, oceanAmount] of byBuyer) {
        const usd = oceanAmount * oceanUsdPrice;
        if (usd >= WHALE_USD_THRESHOLD) whaleCount++;
      }

      // Get top 5 buyers
      const topBuyers = [...byBuyer.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([address, oceanAmount]) => ({
          address,
          oceanAmount,
          usdValue: oceanAmount * oceanUsdPrice,
        }));

      return {
        topBuyers,
        whaleCount,
        totalBuyers: byBuyer.size,
        timePeriod,
        oceanUsdPrice,
      };
    } catch (error) {
      logger.error({ error, timePeriod }, 'Failed to get top buyers');
      return null;
    }
  }

  /**
   * Get OCEAN/USD price from CoinGecko
   */
  private async getOceanUsdPrice(): Promise<number | null> {
    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ocean-protocol&vs_currencies=usd'
      );

      if (!response.ok) {
        logger.error({ status: response.status }, 'CoinGecko API error');
        return null;
      }

      const data = (await response.json()) as { 'ocean-protocol'?: { usd?: number } };
      return data['ocean-protocol']?.usd || null;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch OCEAN price');
      return null;
    }
  }

  /**
   * Fetch logs via Etherscan API (handles large block ranges)
   */
  private async fetchLogsViaEtherscan(
    tokenAddress: string,
    transferTopic: string,
    fromBlock: number,
    toBlock: number,
    hours: number
  ): Promise<
    Array<{
      blockNumber: number;
      topics: string[];
      data: string;
      timeStamp?: number;
    }>
    | null
  > {
    try {
      // Split into 6-hour chunks to avoid 1000-event limit
      const CHUNK_HOURS = 6;
      const numChunks = Math.ceil(hours / CHUNK_HOURS);
      const allLogs: Array<{
        blockNumber: number;
        topics: string[];
        data: string;
        timeStamp?: number;
      }> = [];

      for (let i = 0; i < numChunks; i++) {
        const chunkFromBlock = Math.max(
          fromBlock,
          toBlock - Math.ceil(((i + 1) * CHUNK_HOURS * 3600) / 12) - 2000
        );
        const chunkToBlock = i === 0 ? toBlock : toBlock - Math.ceil((i * CHUNK_HOURS * 3600) / 12);

        // Use Etherscan V2 API - fetch ALL OCEAN transfers (no topic1 filter)
        const url = `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs&fromBlock=${chunkFromBlock}&toBlock=${chunkToBlock}&address=${tokenAddress}&topic0=${transferTopic}&apikey=${env.ETHERSCAN_API_KEY}`;

        logger.debug({ chunk: i + 1, numChunks, chunkFromBlock, chunkToBlock }, 'Fetching chunk');

        const response = await fetch(url);
        const data = (await response.json()) as EtherscanResponse;

        if (data.status === '1' && Array.isArray(data.result)) {
          const chunkLogs = data.result.map((log) => ({
            blockNumber: parseInt(log.blockNumber, 16),
            topics: log.topics,
            data: log.data,
            timeStamp: parseInt(log.timeStamp, 16),
          }));

          logger.debug({ chunkLogs: chunkLogs.length }, 'Chunk fetched');
          allLogs.push(...chunkLogs);
        } else {
          logger.error({ message: data.message, result: data.result }, 'Etherscan API error');
          return null;
        }

        // Respect rate limits (5 calls/sec)
        if (i < numChunks - 1) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      return allLogs;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch logs via Etherscan');
      return null;
    }
  }
}

export const topBuyersService = new TopBuyersService();
