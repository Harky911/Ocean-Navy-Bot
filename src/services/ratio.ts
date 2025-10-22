import { logger } from '../utils/logger.js';

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000; // Start with 2 seconds to avoid rate limits

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

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  delayMs: number = RETRY_DELAY_MS,
  context: string = 'operation'
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'Unknown';
      
      if (attempt < maxRetries) {
        const backoffDelay = delayMs * Math.pow(2, attempt - 1);
        logger.warn(
          { attempt, maxRetries, backoffDelay, errorMessage, errorName, context },
          `Retry attempt ${attempt}/${maxRetries} failed, retrying in ${backoffDelay}ms`
        );
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }
  
  const finalErrorMsg = lastError instanceof Error ? lastError.message : String(lastError);
  const finalErrorStack = lastError instanceof Error ? lastError.stack : undefined;
  logger.error(
    { errorMessage: finalErrorMsg, errorStack: finalErrorStack, context, maxRetries },
    `All ${maxRetries} retry attempts failed`
  );
  throw lastError;
}

class RatioService {
  private cache: { 
    data: RatioData; 
    timestamp: number;
    currentPrices?: { fet: number; ocean: number };
  } | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minute cache (reduce CoinGecko API calls)
  private readonly COINGECKO_SIMPLE = 'https://api.coingecko.com/api/v3/simple/price';
  private readonly COINGECKO_HISTORY = 'https://api.coingecko.com/api/v3/coins';

  /**
   * Get current prices for FET and OCEAN (with retry)
   */
  private async getCurrentPrices(): Promise<{ fet: number; ocean: number } | null> {
    try {
      return await retryWithBackoff(
        async () => {
          const response = await fetch(
            `${this.COINGECKO_SIMPLE}?ids=fetch-ai,ocean-protocol&vs_currencies=usd`
          );

          if (!response.ok) {
            throw new Error(`CoinGecko API returned ${response.status}: ${response.statusText}`);
          }

          const data = await response.json() as CoinGeckoSimpleResponse;
          
          if (!data['fetch-ai']?.usd || !data['ocean-protocol']?.usd) {
            throw new Error('Missing price data from CoinGecko response');
          }

          return {
            fet: data['fetch-ai'].usd,
            ocean: data['ocean-protocol'].usd,
          };
        },
        MAX_RETRIES,
        RETRY_DELAY_MS,
        'CoinGecko current prices'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to fetch current prices after retries');
      return null;
    }
  }

  /**
   * Get historical prices for a coin (with retry)
   * @param coinId - 'fetch-ai' or 'ocean-protocol'
   * @param days - Number of days (1 = 5min intervals, 30 = hourly intervals)
   */
  private async getHistoricalPrices(coinId: string, days: number): Promise<Map<number, number> | null> {
    try {
      return await retryWithBackoff(
        async () => {
          const url = `${this.COINGECKO_HISTORY}/${coinId}/market_chart?vs_currency=usd&days=${days}`;
          
          logger.debug({ url, coinId, days }, 'Fetching historical prices from CoinGecko');
          
          const response = await fetch(url);

          if (!response.ok) {
            const errorText = await response.text();
            logger.error(
              { status: response.status, statusText: response.statusText, errorText, url },
              'CoinGecko API error response'
            );
            throw new Error(`CoinGecko API returned ${response.status}: ${response.statusText} - ${errorText}`);
          }

          const data = await response.json() as CoinGeckoHistoryResponse;
          
          logger.debug({ coinId, days, hasData: !!data.prices, priceCount: data.prices?.length }, 'Parsed CoinGecko response');
          
          if (!data.prices || data.prices.length === 0) {
            logger.error({ data, coinId, days }, 'Empty or missing prices in CoinGecko response');
            throw new Error('No historical price data in response');
          }

          // Create a map of all price data points
          const priceMap = new Map<number, number>();
          for (const [timestamp, price] of data.prices) {
            priceMap.set(timestamp, price);
          }

          logger.debug({ coinId, days, dataPoints: priceMap.size }, 'Fetched historical prices');
          return priceMap;
        },
        MAX_RETRIES,
        RETRY_DELAY_MS,
        `CoinGecko historical ${coinId} (${days}d)`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        { errorMessage, errorStack, coinId, days },
        'Failed to fetch historical prices after retries'
      );
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
   * Uses different price maps for short (1-day) vs long (30-day) intervals
   * Handles null price maps gracefully
   */
  private getHistoricalRatios(
    fetPricesShort: Map<number, number> | null,
    oceanPricesShort: Map<number, number> | null,
    fetPricesLong: Map<number, number> | null,
    oceanPricesLong: Map<number, number> | null
  ): {
    m5: number | null;
    m30: number | null;
    h1: number | null;
    h4: number | null;
    d1: number | null;
    w1: number | null;
    month: number | null;
  } {
    // Short intervals use 1-day data (5-minute granularity)
    const shortIntervals = [
      { key: 'm5', minutes: 5 },
      { key: 'm30', minutes: 30 },
      { key: 'h1', minutes: 60 },
      { key: 'h4', minutes: 240 },
    ];

    // Long intervals use 30-day data (hourly granularity)
    const longIntervals = [
      { key: 'd1', minutes: 1440 },
      { key: 'w1', minutes: 10080 },
      { key: 'month', minutes: 43200 },
    ];

    const ratios: any = {};

    // Process short intervals (only if we have short-term data)
    if (fetPricesShort && oceanPricesShort) {
      for (const { key, minutes } of shortIntervals) {
        const fetPrice = this.findClosestPrice(fetPricesShort, minutes);
        const oceanPrice = this.findClosestPrice(oceanPricesShort, minutes);

        if (fetPrice && oceanPrice) {
          ratios[key] = this.calculateRatio(oceanPrice, fetPrice);
        } else {
          ratios[key] = null;
        }
      }
    } else {
      // Mark all short intervals as null if data unavailable
      for (const { key } of shortIntervals) {
        ratios[key] = null;
      }
    }

    // Process long intervals (only if we have long-term data)
    if (fetPricesLong && oceanPricesLong) {
      for (const { key, minutes } of longIntervals) {
        const fetPrice = this.findClosestPrice(fetPricesLong, minutes);
        const oceanPrice = this.findClosestPrice(oceanPricesLong, minutes);

        if (fetPrice && oceanPrice) {
          ratios[key] = this.calculateRatio(oceanPrice, fetPrice);
        } else {
          ratios[key] = null;
        }
      }
    } else {
      // Mark all long intervals as null if data unavailable
      for (const { key } of longIntervals) {
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

      // Fetch historical data: 1-day for short intervals, 30-day for long intervals
      // This gives us 5-minute granularity for recent data and hourly for longer periods
      // Fetch in parallel - if all 4 calls happen within same rate limit window, they all succeed
      logger.info('Fetching historical price data from CoinGecko...');
      const [fetPricesShort, oceanPricesShort, fetPricesLong, oceanPricesLong] = await Promise.all([
        this.getHistoricalPrices('fetch-ai', 1),      // 1 day = 5min intervals
        this.getHistoricalPrices('ocean-protocol', 1), // 1 day = 5min intervals
        this.getHistoricalPrices('fetch-ai', 30),     // 30 days = hourly intervals
        this.getHistoricalPrices('ocean-protocol', 30), // 30 days = hourly intervals
      ]);

      // Log which data sets were successfully fetched
      logger.info({
        fetShort: !!fetPricesShort,
        oceanShort: !!oceanPricesShort,
        fetLong: !!fetPricesLong,
        oceanLong: !!oceanPricesLong,
      }, 'Historical data fetch results');

      // If ALL historical data failed, fall back to current price for everything
      if (!fetPricesShort && !oceanPricesShort && !fetPricesLong && !oceanPricesLong) {
        logger.warn('ALL historical price fetches failed, using current price for all intervals');
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
      const historical = this.getHistoricalRatios(
        fetPricesShort,
        oceanPricesShort,
        fetPricesLong,
        oceanPricesLong
      );

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

      // Log which values fell back to current price
      const fallbackIntervals = [];
      if (historical.m5 === null) fallbackIntervals.push('5m');
      if (historical.m30 === null) fallbackIntervals.push('30m');
      if (historical.h1 === null) fallbackIntervals.push('1hr');
      if (historical.h4 === null) fallbackIntervals.push('4hr');
      if (historical.d1 === null) fallbackIntervals.push('1day');
      if (historical.w1 === null) fallbackIntervals.push('week');
      if (historical.month === null) fallbackIntervals.push('month');

      if (fallbackIntervals.length > 0) {
        logger.warn(
          { fallbackIntervals: fallbackIntervals.join(', ') },
          'Some historical intervals unavailable, using current price as fallback'
        );
      }

      // Update cache with data and prices
      this.cache = {
        data: ratioData,
        timestamp: Date.now(),
        currentPrices: currentPrices,
      };

      logger.info({ ratioData, currentPrices }, 'Fetched ratio data with prices');
      
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
    if (this.cache?.currentPrices) {
      return this.cache.currentPrices;
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

