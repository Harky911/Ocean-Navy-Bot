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

// Known pool addresses (transfers TO these are sells, not buys)
const KNOWN_POOLS = new Set([
  '0x9b7d8b6c0a8d6e1f5a5e7f8b5c6d3e4f5a6b7c8d'.toLowerCase(), // Uniswap V2 OCEAN/WETH
  '0x1b84765de8b7566e4ceaf4d0fd3c5af52d3dde4f'.toLowerCase(), // Uniswap V3 OCEAN/WETH (0.3%)
  // Add more pools as needed
]);

// Excluded addresses (routers, aggregators, contracts that shouldn't count as "buyers")
const EXCLUDED_ADDRESSES = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'.toLowerCase(), // Uniswap V2 Router
  '0xe592427a0aece92de3edee1f18e0157c05861564'.toLowerCase(), // Uniswap V3 Router
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'.toLowerCase(), // Uniswap V3 Router 2
  '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b'.toLowerCase(), // Uniswap Universal Router
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad'.toLowerCase(), // Uniswap Universal Router 2
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff'.toLowerCase(), // 0x Protocol
  '0x1111111254eeb25477b68fb85ed929f73a960582'.toLowerCase(), // 1inch V5 Router
  '0x1111111254fb6c44bac0bed2854e76f90643097d'.toLowerCase(), // 1inch V4 Router
  '0x11111112542d85b3ef69ae05771c2dccff4faa26'.toLowerCase(), // 1inch V3 Router
  '0x216b4b4ba9f3e719726886d34a177484278bfcae'.toLowerCase(), // ParaSwap
  '0xdef171fe48cf0115b1d80b88dc8eab59176fee57'.toLowerCase(), // ParaSwap Augustus V6
  '0x6352a56caadc4f1e25cd6c75970fa768a3304e64'.toLowerCase(), // OpenOcean
  '0x99a58482bd75cbab83b27ec03ca68ff489b5788f'.toLowerCase(), // Cowswap
  ethers.ZeroAddress.toLowerCase(), // Burn/mint address
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

        // Skip mints/burns (zero address)
        if (
          sender.toLowerCase() === ethers.ZeroAddress.toLowerCase() ||
          recipient.toLowerCase() === ethers.ZeroAddress.toLowerCase()
        ) {
          continue;
        }

        // Skip if recipient is an excluded router/aggregator
        if (EXCLUDED_ADDRESSES.has(recipient.toLowerCase())) {
          continue;
        }

        // Skip if recipient is a known pool (this is a sell, not a buy)
        if (KNOWN_POOLS.has(recipient.toLowerCase())) {
          continue;
        }

        // This is a buy! Count it
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
