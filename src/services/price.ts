import { logger } from '../utils/logger.js';

interface CoinGeckoPrice {
  'ocean-protocol': {
    usd: number;
  };
}

class PriceService {
  private cache: { price: number; timestamp: number } | null = null;
  private readonly CACHE_TTL = 60 * 1000; // 1 minute cache
  private readonly COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ocean-protocol&vs_currencies=usd';

  async getOceanUsdPrice(): Promise<number | null> {
    try {
      // Return cached price if still valid
      if (this.cache && Date.now() - this.cache.timestamp < this.CACHE_TTL) {
        logger.debug({ price: this.cache.price, cached: true }, 'Using cached OCEAN price');
        return this.cache.price;
      }

      const response = await fetch(this.COINGECKO_URL);
      if (!response.ok) {
        logger.error({ status: response.status }, 'CoinGecko API error');
        return this.cache?.price || null;
      }

      const data = await response.json() as CoinGeckoPrice;
      const price = data['ocean-protocol']?.usd;

      if (typeof price !== 'number') {
        logger.error({ data }, 'Invalid price data from CoinGecko');
        return this.cache?.price || null;
      }

      this.cache = { price, timestamp: Date.now() };
      logger.debug({ price, cached: false }, 'Fetched fresh OCEAN price');
      return price;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch OCEAN price');
      return this.cache?.price || null;
    }
  }

  formatUsdValue(oceanAmount: number, price: number | null): string | null {
    if (price === null) return null;
    const usdValue = oceanAmount * price;
    return usdValue.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}

export const priceService = new PriceService();

