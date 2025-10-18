import { logger } from '../utils/logger.js';

interface RatioData {
  now: number;
  m5: number;
  m30: number;
  h1: number;
  d1: number;
  w1: number;
  month: number;
}

interface CoinGeckoSimpleResponse {
  'fetch-ai'?: { usd?: number };
  'ocean-protocol'?: { usd?: number };
}

interface CoinGeckoHistoryResponse {
  prices?: [number, number][]; // [timestamp, price]
}

class RatioService {
  private cache: { data: RatioData; timestamp: number } | null = null;
  private readonly CACHE_TTL = 2 * 60 * 1000; // 2 minute cache
  private readonly COINGECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price';
  private readonly COINGECKO_HISTORY = 'https://api.coingecko.com/api/v3/coins';

  /**
   * Get current prices for FET and OCEAN
   */
  private async getCurrentPrices(): Promise<{ fet: number; ocean: number } | null> {
    try {
      const response = await fetch(
        `${this.COINGECKO_SIMPLE}?ids=fetch-ai,ocean-protocol&vs_currencies=usd`
      );

      if (!response.ok) {
        logger.error({ status: response.status }, 'CoinGecko API error (current prices)');
        return null;
      }

      const data = await response.json() as CoinGeckoSimpleResponse;
      
      if (!data['fetch-ai']?.usd || !data['ocean-protocol']?.usd) {
        logger.error({ data }, 'Missing price data from CoinGecko');
        return null;
      }

      return {
        fet: data['fetch-ai'].usd,
        ocean: data['ocean-protocol'].usd,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch current prices');
      return null;
    }
  }

  /**
   * Get historical price for a coin at a specific time
   * @param coinId - 'fetch-ai' or 'ocean-protocol'
   * @param minutesAgo - How many minutes ago
   */
  private async getHistoricalPrice(coinId: string, minutesAgo: number): Promise<number | null> {
    try {
      // CoinGecko market_chart returns data points for specified time range
      // We'll request slightly more time to ensure we get the data point we need
      const days = Math.ceil(minutesAgo / 1440) || 1; // Convert minutes to days, minimum 1
      
      const response = await fetch(
        `${this.COINGECKO_HISTORY}/${coinId}/market_chart?vs_currency=usd&days=${days}`
      );

      if (!response.ok) {
        logger.error({ status: response.status, coinId }, 'CoinGecko API error (historical)');
        return null;
      }

      const data = await response.json() as CoinGeckoHistoryResponse;
      
      if (!data.prices || data.prices.length === 0) {
        logger.error({ coinId }, 'No historical price data');
        return null;
      }

      // Find the price closest to the target time
      const targetTime = Date.now() - (minutesAgo * 60 * 1000);
      let closestPrice = data.prices[0];
      let minDiff = Math.abs(data.prices[0][0] - targetTime);

      for (const pricePoint of data.prices) {
        const diff = Math.abs(pricePoint[0] - targetTime);
        if (diff < minDiff) {
          minDiff = diff;
          closestPrice = pricePoint;
        }
      }

      return closestPrice[1]; // [timestamp, price]
    } catch (error) {
      logger.error({ error, coinId, minutesAgo }, 'Failed to fetch historical price');
      return null;
    }
  }

  /**
   * Calculate FET:OCEAN ratio at a specific time
   * Formula: OCEAN_price / FET_price = FET per 1 OCEAN
   */
  private calculateRatio(oceanPrice: number, fetPrice: number): number {
    return oceanPrice / fetPrice;
  }

  /**
   * Get historical ratio for a specific time
   */
  private async getHistoricalRatio(minutesAgo: number): Promise<number | null> {
    const [fetPrice, oceanPrice] = await Promise.all([
      this.getHistoricalPrice('fetch-ai', minutesAgo),
      this.getHistoricalPrice('ocean-protocol', minutesAgo),
    ]);

    if (!fetPrice || !oceanPrice) {
      return null;
    }

    return this.calculateRatio(oceanPrice, fetPrice);
  }

  /**
   * Get all ratio data (current + historical)
   */
  async getRatioData(): Promise<RatioData | null> {
    // Check cache
    if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
      logger.debug('Using cached ratio data');
      return this.cache.data;
    }

    try {
      // Get current prices
      const currentPrices = await this.getCurrentPrices();
      if (!currentPrices) {
        return null;
      }

      const now = this.calculateRatio(currentPrices.ocean, currentPrices.fet);

      // Get historical ratios in parallel
      const [m5, m30, h1, d1, w1, month] = await Promise.all([
        this.getHistoricalRatio(5),
        this.getHistoricalRatio(30),
        this.getHistoricalRatio(60),
        this.getHistoricalRatio(1440),      // 24 hours
        this.getHistoricalRatio(10080),     // 7 days
        this.getHistoricalRatio(43200),     // 30 days
      ]);

      const ratioData: RatioData = {
        now,
        m5: m5 ?? now,      // Fallback to current if historical unavailable
        m30: m30 ?? now,
        h1: h1 ?? now,
        d1: d1 ?? now,
        w1: w1 ?? now,
        month: month ?? now,
      };

      // Update cache
      this.cache = {
        data: ratioData,
        timestamp: Date.now(),
      };

      logger.info({ ratioData }, 'Fetched ratio data');
      return ratioData;
    } catch (error) {
      logger.error({ error }, 'Failed to get ratio data');
      return null;
    }
  }

  /**
   * Format ratio data into a Telegram message
   */
  formatRatioMessage(data: RatioData): string {
    const formatRatio = (ratio: number) => ratio.toFixed(3);

    const lines = [
      '📊 *FET : OCEAN Ratio*',
      '',
      `🔄 now:   ${formatRatio(data.now)} : 1`,
      `⏱️ 5m:    ${formatRatio(data.m5)} : 1`,
      `⏱️ 30m:   ${formatRatio(data.m30)} : 1`,
      `⏱️ 1hr:   ${formatRatio(data.h1)} : 1`,
      `📅 1day:  ${formatRatio(data.d1)} : 1`,
      `📅 week:  ${formatRatio(data.w1)} : 1`,
      `📅 month: ${formatRatio(data.month)} : 1`,
      '',
      `💡 1 OCEAN = ${formatRatio(data.now)} FET`,
    ];

    return lines.join('\n');
  }
}

export const ratioService = new RatioService();

