import { logger } from '../utils/logger.js';

interface RatioData {
  now: number;
  m5: number;
  m30: number;
  h1: number;
  h4: number;
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
   * Get all historical prices for a coin in one call
   * Fetches 30 days of data and extracts all needed time points
   * @param coinId - 'fetch-ai' or 'ocean-protocol'
   */
  private async getHistoricalPrices(coinId: string): Promise<Map<number, number> | null> {
    try {
      // Fetch 30 days of data in one call (covers all our time ranges)
      const response = await fetch(
        `${this.COINGECKO_HISTORY}/${coinId}/market_chart?vs_currency=usd&days=30`
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

      // Create a map of all price data points
      const priceMap = new Map<number, number>();
      for (const [timestamp, price] of data.prices) {
        priceMap.set(timestamp, price);
      }

      return priceMap;
    } catch (error) {
      logger.error({ error, coinId }, 'Failed to fetch historical prices');
      return null;
    }
  }

  /**
   * Find price closest to a target time from a price map
   */
  private findClosestPrice(priceMap: Map<number, number>, minutesAgo: number): number | null {
    const targetTime = Date.now() - (minutesAgo * 60 * 1000);
    let closestPrice: number | null = null;
    let minDiff = Infinity;

    for (const [timestamp, price] of priceMap) {
      const diff = Math.abs(timestamp - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestPrice = price;
      }
    }

    return closestPrice;
  }

  /**
   * Calculate FET:OCEAN ratio at a specific time
   * Formula: OCEAN_price / FET_price = FET per 1 OCEAN
   */
  private calculateRatio(oceanPrice: number, fetPrice: number): number {
    return oceanPrice / fetPrice;
  }

  /**
   * Get historical ratios from price maps
   */
  private getHistoricalRatios(fetPrices: Map<number, number>, oceanPrices: Map<number, number>): {
    m5: number | null;
    m30: number | null;
    h1: number | null;
    h4: number | null;
    d1: number | null;
    w1: number | null;
    month: number | null;
  } {
    const intervals = [
      { key: 'm5', minutes: 5 },
      { key: 'm30', minutes: 30 },
      { key: 'h1', minutes: 60 },
      { key: 'h4', minutes: 240 },
      { key: 'd1', minutes: 1440 },
      { key: 'w1', minutes: 10080 },
      { key: 'month', minutes: 43200 },
    ];

    const ratios: any = {};

    for (const { key, minutes } of intervals) {
      const fetPrice = this.findClosestPrice(fetPrices, minutes);
      const oceanPrice = this.findClosestPrice(oceanPrices, minutes);

      if (fetPrice && oceanPrice) {
        ratios[key] = this.calculateRatio(oceanPrice, fetPrice);
      } else {
        ratios[key] = null;
      }
    }

    return ratios;
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

      // Fetch all historical data in just 2 API calls (one per coin)
      const [fetPrices, oceanPrices] = await Promise.all([
        this.getHistoricalPrices('fetch-ai'),
        this.getHistoricalPrices('ocean-protocol'),
      ]);

      if (!fetPrices || !oceanPrices) {
        logger.warn('Failed to fetch historical prices, using current price for all intervals');
        return {
          now,
          m5: now,
          m30: now,
          h1: now,
          h4: now,
          d1: now,
          w1: now,
          month: now,
        };
      }

      // Extract all historical ratios from the fetched data
      const historical = this.getHistoricalRatios(fetPrices, oceanPrices);

      const ratioData: RatioData = {
        now,
        m5: historical.m5 ?? now,      // Fallback to current if historical unavailable
        m30: historical.m30 ?? now,
        h1: historical.h1 ?? now,
        h4: historical.h4 ?? now,
        d1: historical.d1 ?? now,
        w1: historical.w1 ?? now,
        month: historical.month ?? now,
      };

      // Update cache
      this.cache = {
        data: ratioData,
        timestamp: Date.now(),
      };

      logger.info({ ratioData }, 'Fetched ratio data');
      
      // Store current prices in cache for formatting
      (this.cache as any).currentPrices = currentPrices;
      
      return ratioData;
    } catch (error) {
      logger.error({ error }, 'Failed to get ratio data');
      return null;
    }
  }

  /**
   * Get current prices from cache (used for formatting)
   */
  getCurrentPricesFromCache(): { fet: number; ocean: number } | null {
    if (this.cache && (this.cache as any).currentPrices) {
      return (this.cache as any).currentPrices;
    }
    return null;
  }

  /**
   * Format ratio data into a Telegram message
   */
  formatRatioMessage(data: RatioData, fetPrice?: number, oceanPrice?: number): string {
    const formatRatio = (ratio: number) => ratio.toFixed(3);
    const formatPrice = (price: number) => `$${price.toFixed(4)}`;

    const lines = [
      '📊 *FET : OCEAN Ratio*',
      '',
      `🔄 now:   ${formatRatio(data.now)} : 1`,
      `⏱️ 5m:    ${formatRatio(data.m5)} : 1`,
      `⏱️ 30m:   ${formatRatio(data.m30)} : 1`,
      `⏱️ 1hr:   ${formatRatio(data.h1)} : 1`,
      `⏱️ 4hr:   ${formatRatio(data.h4)} : 1`,
      `📅 1day:  ${formatRatio(data.d1)} : 1`,
      `📅 week:  ${formatRatio(data.w1)} : 1`,
      `📅 month: ${formatRatio(data.month)} : 1`,
      '',
    ];

    // Add current prices if available
    if (fetPrice && oceanPrice) {
      lines.push(`FET: ${formatPrice(fetPrice)}`);
      lines.push(`OCEAN: ${formatPrice(oceanPrice)}`);
      lines.push('');
    }

    lines.push(`💡 1 OCEAN = ${formatRatio(data.now)} FET`);

    return lines.join('\n');
  }
}

export const ratioService = new RatioService();

