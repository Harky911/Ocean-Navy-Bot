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
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

const PAIR_ABI = [
  'event Swap(address indexed sender,uint amount0In,uint amount1In,uint amount0Out,uint amount1Out,address indexed to)',
];

const ERC20_ABI = ['function decimals() view returns (uint8)'];

const CHAINLINK_ABI = [
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
];

// Constants
const OCEAN = '0x967da4048cd07ab37855c090aaf366e4ce1b9f48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const UNI_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const CHAINLINK_ETH_USD = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
const WHALE_USD_THRESHOLD = 5000;

export interface TopBuyer {
  address: string;
  oceanAmount: number;
  wethSpent: number;
  usdValue: number;
}

export interface TopBuyersResult {
  topBuyers: TopBuyer[];
  whaleCount: number;
  totalBuyers: number;
  timePeriod: string;
  ethUsdPrice: number;
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
 * Fetch top OCEAN buyers from Uniswap V2 OCEAN/WETH pool
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

      // Get pair address
      const factory = new ethers.Contract(UNI_FACTORY, FACTORY_ABI, this.provider);
      const [tokenA, tokenB] = [OCEAN.toLowerCase(), WETH.toLowerCase()].sort();
      const pairAddr = await factory.getPair(tokenA, tokenB);

      if (pairAddr === ethers.ZeroAddress) {
        logger.error('OCEAN/WETH pair not found');
        return null;
      }

      logger.debug({ pairAddr }, 'Found pair');

      // Get token order
      const token0Slot = await this.provider.call({ to: pairAddr, data: '0x0dfe1681' });
      const token1Slot = await this.provider.call({ to: pairAddr, data: '0xd21220a7' });
      const token0 = ethers.getAddress('0x' + token0Slot.slice(26));
      const token1 = ethers.getAddress('0x' + token1Slot.slice(26));
      const oceanIsToken0 = token0.toLowerCase() === OCEAN.toLowerCase();

      logger.debug({ token0, token1, oceanIsToken0 }, 'Token order');

      // Get decimals
      const oceanContract = new ethers.Contract(OCEAN, ERC20_ABI, this.provider);
      const wethContract = new ethers.Contract(WETH, ERC20_ABI, this.provider);
      const [oceanDec, wethDec] = await Promise.all([
        oceanContract.decimals(),
        wethContract.decimals(),
      ]);

      // Get ETH/USD price from Chainlink
      const feed = new ethers.Contract(CHAINLINK_ETH_USD, CHAINLINK_ABI, this.provider);
      const [, answer] = await feed.latestRoundData();
      const ethUsd = Number(answer) / 1e8;

      logger.debug({ ethUsd }, 'ETH/USD price');

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

      // Fetch swap logs using Etherscan API
      const swapTopic = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)');
      const logs = await this.fetchLogsViaEtherscan(
        pairAddr,
        swapTopic,
        fromBlock,
        latestBlock,
        hours
      );

      if (!logs) {
        logger.error('Failed to fetch logs');
        return null;
      }

      logger.info({ logCount: logs.length }, 'Fetched swap logs');

      // Process swaps and aggregate by buyer
      const iface = new ethers.Interface(PAIR_ABI);
      const byBuyer = new Map<string, { oceanOut: number; wethIn: number }>();

      for (const log of logs) {
        // Filter by timestamp
        const ts = log.timeStamp || (await this.provider.getBlock(log.blockNumber))?.timestamp || 0;
        if (ts < fromTs) continue;

        const parsed = iface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (!parsed) continue;

        const { amount0In, amount1In, amount0Out, amount1Out, to } = parsed.args;

        // Normalize amounts
        const a0in = Number(
          ethers.formatUnits(amount0In, oceanIsToken0 ? oceanDec : wethDec)
        );
        const a1in = Number(
          ethers.formatUnits(amount1In, oceanIsToken0 ? wethDec : oceanDec)
        );
        const a0out = Number(
          ethers.formatUnits(amount0Out, oceanIsToken0 ? oceanDec : wethDec)
        );
        const a1out = Number(
          ethers.formatUnits(amount1Out, oceanIsToken0 ? wethDec : oceanDec)
        );

        let oceanOut = 0,
          wethIn = 0;

        if (oceanIsToken0) {
          oceanOut = a0out;
          wethIn = a1in;
        } else {
          oceanOut = a1out;
          wethIn = a0in;
        }

        if (oceanOut > 0) {
          const key = ethers.getAddress(to);
          const prev = byBuyer.get(key) || { oceanOut: 0, wethIn: 0 };
          prev.oceanOut += oceanOut;
          prev.wethIn += wethIn;
          byBuyer.set(key, prev);
        }
      }

      logger.info({ uniqueBuyers: byBuyer.size }, 'Processed swaps');

      // Calculate whale count
      let whaleCount = 0;
      for (const [, v] of byBuyer) {
        const usd = v.wethIn * ethUsd;
        if (usd >= WHALE_USD_THRESHOLD) whaleCount++;
      }

      // Get top 5 buyers
      const topBuyers = [...byBuyer.entries()]
        .sort((a, b) => b[1].oceanOut - a[1].oceanOut)
        .slice(0, 5)
        .map(([address, v]) => ({
          address,
          oceanAmount: v.oceanOut,
          wethSpent: v.wethIn,
          usdValue: v.wethIn * ethUsd,
        }));

      return {
        topBuyers,
        whaleCount,
        totalBuyers: byBuyer.size,
        timePeriod,
        ethUsdPrice: ethUsd,
      };
    } catch (error) {
      logger.error({ error, timePeriod }, 'Failed to get top buyers');
      return null;
    }
  }

  /**
   * Fetch logs via Etherscan API (handles large block ranges)
   */
  private async fetchLogsViaEtherscan(
    pairAddr: string,
    swapTopic: string,
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

        const url = `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs&fromBlock=${chunkFromBlock}&toBlock=${chunkToBlock}&address=${pairAddr}&topic0=${swapTopic}&apikey=${env.ETHERSCAN_API_KEY}`;

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

