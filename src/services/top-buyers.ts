import { ethers } from 'ethers';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Etherscan API response types
interface EtherscanLog {
  blockNumber: string;
  topics: string[];
  data: string;
  timeStamp: string;
  transactionHash: string;
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
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const WHALE_USD_THRESHOLD = 5000;
const UNI_V2_PAIR = '0x9b7dad79fc16106b47a3dab791f389c167e15eb0'; // OCEAN/WETH

// Known router/aggregator addresses to exclude as buyers
const EXCLUDED_ADDRESSES = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'.toLowerCase(), // Uniswap V2 Router
  '0xe592427a0aece92de3edee1f18e0157c05861564'.toLowerCase(), // Uniswap V3 Router
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'.toLowerCase(), // Uniswap V3 Router 2
  '0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b'.toLowerCase(), // Uniswap Universal Router
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad'.toLowerCase(), // Uniswap Universal Router 2
  '0xeff6cb8b614999d130e537751ee99724d01aa167'.toLowerCase(), // Uniswap V4 Position Manager
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff'.toLowerCase(), // 0x Protocol
  '0x1111111254eeb25477b68fb85ed929f73a960582'.toLowerCase(), // 1inch V5 Router
  '0x1111111254fb6c44bac0bed2854e76f90643097d'.toLowerCase(), // 1inch V4 Router
  '0x11111112542d85b3ef69ae05771c2dccff4faa26'.toLowerCase(), // 1inch V3 Router
  '0x216b4b4ba9f3e719726886d34a177484278bfcae'.toLowerCase(), // ParaSwap
  '0xdef171fe48cf0115b1d80b88dc8eab59176fee57'.toLowerCase(), // ParaSwap Augustus V6
  '0x6352a56caadc4f1e25cd6c75970fa768a3304e64'.toLowerCase(), // OpenOcean
  '0x99a58482bd75cbab83b27ec03ca68ff489b5788f'.toLowerCase(), // Cowswap
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
 * Fetch top OCEAN buyers by tracking NET OCEAN balance changes across ALL transactions
 */
export class TopBuyersService {
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      `https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`
    );
  }

  /**
   * Get top OCEAN buyers for a time period
   */
  async getTopBuyers(timePeriod: string): Promise<TopBuyersResult | null> {
    try {
      const hours = parseTimePeriod(timePeriod);
      logger.info({ timePeriod, hours }, 'Fetching top buyers');

      // Get OCEAN/USD price
      const oceanUsdPrice = await this.getOceanUsdPrice();
      if (!oceanUsdPrice) {
        logger.error('Failed to get OCEAN/USD price');
        return null;
      }
      logger.debug({ oceanUsdPrice }, 'OCEAN/USD price');

      // Get time range
      const latestBlock = await this.provider.getBlockNumber();
      const latest = await this.provider.getBlock(latestBlock);
      if (!latest) {
        logger.error('Failed to get latest block');
        return null;
      }

      const fromTs = latest.timestamp - hours * 3600;
      const estBlocks = Math.ceil((hours * 3600) / 12);
      const fromBlock = Math.max(0, latestBlock - estBlocks - 2000);

      logger.debug({ fromBlock, toBlock: latestBlock, hours }, 'Block range');

      // Get OCEAN decimals
      const oceanContract = new ethers.Contract(OCEAN, ERC20_ABI, this.provider);
      const oceanDecimals = Number(await oceanContract.decimals());

      // Fetch ALL OCEAN Transfer events
      const oceanLogs = await this.fetchLogsViaEtherscan(
        OCEAN,
        fromBlock,
        latestBlock,
        'Transfer'
      );

      if (!oceanLogs) {
        logger.error('Failed to fetch OCEAN transfer logs');
        return null;
      }

      logger.info({ oceanLogCount: oceanLogs.length }, 'Fetched OCEAN transfer logs');

      // Fetch WETH transfers involving the OCEAN/WETH pair to identify swap transactions
      const wethLogs = await this.fetchWethPairLogs(fromBlock, latestBlock);
      const wethTxSet = new Set(wethLogs.map(log => log.transactionHash.toLowerCase()));

      logger.info({ wethTxCount: wethTxSet.size }, 'Fetched WETH swap transactions');

      // Step 1: Group OCEAN transfers by transaction
      const iface = new ethers.Interface(ERC20_ABI);
      const oceanByTx = new Map<string, Array<{ from: string; to: string; amount: number }>>();

      for (const log of oceanLogs) {
        const ts = parseInt(log.timeStamp, 16);
        if (ts < fromTs) continue;

        const txHash = log.transactionHash?.toLowerCase();
        if (!txHash) continue;

        if (!oceanByTx.has(txHash)) {
          oceanByTx.set(txHash, []);
        }

        const parsed = iface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (!parsed) continue;

        oceanByTx.get(txHash)!.push({
          from: ethers.getAddress(parsed.args.from),
          to: ethers.getAddress(parsed.args.to),
          amount: Number(ethers.formatUnits(parsed.args.value, oceanDecimals)),
        });
      }

      logger.info({ uniqueTxCount: oceanByTx.size }, 'Grouped OCEAN transfers by transaction');

      // Step 2: Calculate NET OCEAN movement for each address across ALL transactions
      const netOceanByAddress = new Map<string, number>();

      for (const [, oceanTransfers] of oceanByTx) {
        for (const transfer of oceanTransfers) {
          const { from, to, amount } = transfer;

          // Track all receives
          if (to !== ethers.ZeroAddress) {
            const toNet = netOceanByAddress.get(to) || 0;
            netOceanByAddress.set(to, toNet + amount);
          }

          // Track all sends
          if (from !== ethers.ZeroAddress) {
            const fromNet = netOceanByAddress.get(from) || 0;
            netOceanByAddress.set(from, fromNet - amount);
          }
        }
      }

      // Step 3: Filter to only addresses involved in swap-like transactions
      const swapAddresses = new Set<string>();

      for (const [txHash, oceanTransfers] of oceanByTx) {
        // A transaction is likely a swap if:
        const hasWeth = wethTxSet.has(txHash);
        const multipleOceanMoves = oceanTransfers.length >= 2;
        const largeAmount = oceanTransfers.some(t => t.amount > 100);

        if (!hasWeth && !multipleOceanMoves && !largeAmount) continue;

        // Mark all addresses in this swap transaction
        for (const transfer of oceanTransfers) {
          swapAddresses.add(transfer.to);
        }
      }

      logger.info({ swapAddressCount: swapAddresses.size }, 'Identified swap participants');

      // Step 4: Build final buyer list with NET positive addresses
      const byBuyer = new Map<string, number>();

      for (const [address, netAmount] of netOceanByAddress) {
        // Must have been involved in a swap transaction
        if (!swapAddresses.has(address)) continue;

        // Must have NET positive OCEAN (bought more than sold)
        if (netAmount <= 10) continue;

        // Skip routers
        if (EXCLUDED_ADDRESSES.has(address.toLowerCase())) continue;

        // Skip pools
        if (address.toLowerCase() === UNI_V2_PAIR.toLowerCase()) continue;

        // Count as buyer
        byBuyer.set(address, netAmount);
      }

      logger.info({ uniqueBuyers: byBuyer.size }, 'Processed buyers with NET positive OCEAN');

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

      logger.debug({ topBuyers: topBuyers.map(b => ({ addr: b.address, ocean: b.oceanAmount.toFixed(2) })) }, 'Top 5 buyers');

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
   * Fetch WETH transfer logs involving the OCEAN/WETH pair
   */
  private async fetchWethPairLogs(fromBlock: number, toBlock: number): Promise<EtherscanLog[]> {
    const allLogs: EtherscanLog[] = [];
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    const pairAddrPadded = ethers.zeroPadValue(UNI_V2_PAIR, 32);

    // Split into 6-hour chunks
    const CHUNK_HOURS = 6;
    const totalHours = Math.ceil(((toBlock - fromBlock) * 12) / 3600);
    const numChunks = Math.ceil(totalHours / CHUNK_HOURS);

    for (let i = 0; i < numChunks; i++) {
      const chunkFromBlock = Math.max(fromBlock, toBlock - Math.ceil(((i + 1) * CHUNK_HOURS * 3600) / 12) - 2000);
      const chunkToBlock = i === 0 ? toBlock : toBlock - Math.ceil((i * CHUNK_HOURS * 3600) / 12);

      // WETH transfers FROM pair (OCEAN buys)
      const fromUrl = `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs&fromBlock=${chunkFromBlock}&toBlock=${chunkToBlock}&address=${WETH}&topic0=${transferTopic}&topic1=${pairAddrPadded}&apikey=${env.ETHERSCAN_API_KEY}`;

      const fromResponse = await fetch(fromUrl);
      const fromData = (await fromResponse.json()) as EtherscanResponse;

      if (fromData.status === '1' && Array.isArray(fromData.result)) {
        allLogs.push(...(fromData.result as EtherscanLog[]));
      }

      await new Promise(r => setTimeout(r, 250));

      // WETH transfers TO pair (OCEAN sells)
      const toUrl = `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs&fromBlock=${chunkFromBlock}&toBlock=${chunkToBlock}&address=${WETH}&topic0=${transferTopic}&topic2=${pairAddrPadded}&apikey=${env.ETHERSCAN_API_KEY}`;

      const toResponse = await fetch(toUrl);
      const toData = (await toResponse.json()) as EtherscanResponse;

      if (toData.status === '1' && Array.isArray(toData.result)) {
        allLogs.push(...(toData.result as EtherscanLog[]));
      }

      if (i < numChunks - 1) await new Promise(r => setTimeout(r, 250));
    }

    return allLogs;
  }

  /**
   * Fetch logs via Etherscan API (handles large block ranges)
   */
  private async fetchLogsViaEtherscan(
    tokenAddress: string,
    fromBlock: number,
    toBlock: number,
    eventName: string
  ): Promise<EtherscanLog[] | null> {
    try {
      const allLogs: EtherscanLog[] = [];
      const eventTopic = ethers.id(`${eventName}(address,address,uint256)`);

      // Split into 6-hour chunks to avoid 1000-event limit
      const CHUNK_HOURS = 6;
      const totalHours = Math.ceil(((toBlock - fromBlock) * 12) / 3600);
      const numChunks = Math.ceil(totalHours / CHUNK_HOURS);

      for (let i = 0; i < numChunks; i++) {
        const chunkFromBlock = Math.max(fromBlock, toBlock - Math.ceil(((i + 1) * CHUNK_HOURS * 3600) / 12) - 2000);
        const chunkToBlock = i === 0 ? toBlock : toBlock - Math.ceil((i * CHUNK_HOURS * 3600) / 12);

        const url = `https://api.etherscan.io/v2/api?chainid=1&module=logs&action=getLogs&fromBlock=${chunkFromBlock}&toBlock=${chunkToBlock}&address=${tokenAddress}&topic0=${eventTopic}&apikey=${env.ETHERSCAN_API_KEY}`;

        logger.debug({ chunk: i + 1, total: numChunks, fromBlock: chunkFromBlock, toBlock: chunkToBlock }, 'Fetching chunk');

        const response = await fetch(url);
        const data = (await response.json()) as EtherscanResponse;

        if (data.status === '1' && Array.isArray(data.result)) {
          allLogs.push(...(data.result as EtherscanLog[]));
        } else if (data.message) {
          logger.warn({ message: data.message, chunk: i + 1 }, 'Etherscan API warning');
        }

        // Respect rate limits (5 calls/sec)
        if (i < numChunks - 1) await new Promise(r => setTimeout(r, 250));
      }

      return allLogs;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch logs via Etherscan');
      return null;
    }
  }
}

export const topBuyersService = new TopBuyersService();
