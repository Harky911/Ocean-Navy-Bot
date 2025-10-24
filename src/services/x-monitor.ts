import Parser from 'rss-parser';
import { logger } from '../utils/logger.js';
import { xAccountsService } from './x-accounts.js';
import TelegramBot from 'node-telegram-bot-api';
import { configManager } from '../telegram/config.js';

// Multiple Nitter instances for fallback reliability
const NITTER_INSTANCES = [
  'nitter.poast.org',
  'nitter.privacydev.net',
  'nitter.net',
  'nitter.unixfox.eu',
];

const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

interface Tweet {
  id: string;
  url: string;
  text: string;
  author: string;
  pubDate: Date;
  isRetweet: boolean;
  isReply: boolean;
}

/**
 * Service for monitoring X (Twitter) accounts via RSS
 */
export class XMonitorService {
  private parser: Parser;
  private bot: TelegramBot;
  private pollInterval: NodeJS.Timeout | null = null;
  private currentNitterIndex = 0;

  constructor(bot: TelegramBot) {
    this.parser = new Parser({
      customFields: {
        item: [
          ['description', 'text'],
        ],
      },
    });
    this.bot = bot;
  }

  /**
   * Start monitoring X accounts
   */
  async start(): Promise<void> {
    logger.info('Starting X account monitor');
    
    // Initialize services
    await xAccountsService.initialize();

    // Do initial check
    await this.checkAllAccounts();

    // Setup polling interval
    this.pollInterval = setInterval(async () => {
      try {
        await this.checkAllAccounts();
      } catch (error) {
        logger.error({ error }, 'Error in X monitor poll interval');
      }
    }, POLL_INTERVAL_MS);

    logger.info({ intervalMs: POLL_INTERVAL_MS }, 'X account monitor started');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      logger.info('X account monitor stopped');
    }
  }

  /**
   * Check all monitored accounts for new tweets
   */
  private async checkAllAccounts(): Promise<void> {
    const accounts = await xAccountsService.getAll();
    
    if (accounts.length === 0) {
      logger.debug('No X accounts to monitor');
      return;
    }

    logger.debug({ count: accounts.length }, 'Checking X accounts for new tweets');

    for (const username of accounts) {
      try {
        await this.checkAccount(username);
        // Small delay between accounts to be nice to Nitter
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        logger.error({ error, username }, 'Failed to check X account');
      }
    }
  }

  /**
   * Check a single account for new tweets
   */
  private async checkAccount(username: string): Promise<void> {
    const tweets = await this.fetchTweets(username);
    
    if (!tweets || tweets.length === 0) {
      logger.debug({ username }, 'No tweets found');
      return;
    }

    const lastSeenId = await xAccountsService.getLastSeen(username);
    
    // Filter to only original tweets (not retweets or replies)
    const originalTweets = tweets.filter(t => !t.isRetweet && !t.isReply);
    
    if (originalTweets.length === 0) {
      logger.debug({ username }, 'No original tweets found');
      return;
    }

    // Sort by date (oldest first) to post in chronological order
    originalTweets.sort((a, b) => a.pubDate.getTime() - b.pubDate.getTime());

    // Find new tweets
    const newTweets: Tweet[] = [];
    for (const tweet of originalTweets) {
      if (lastSeenId && tweet.id <= lastSeenId) {
        continue; // Already seen
      }
      newTweets.push(tweet);
    }

    if (newTweets.length === 0) {
      logger.debug({ username }, 'No new tweets');
      return;
    }

    logger.info({ username, count: newTweets.length }, 'Found new tweets');

    // Post new tweets to Telegram
    for (const tweet of newTweets) {
      await this.postTweet(tweet);
      await xAccountsService.setLastSeen(username, tweet.id);
      // Small delay between posts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Fetch tweets from RSS feed with fallback instances
   */
  private async fetchTweets(username: string): Promise<Tweet[] | null> {
    // Try each Nitter instance
    for (let i = 0; i < NITTER_INSTANCES.length; i++) {
      const instanceIndex = (this.currentNitterIndex + i) % NITTER_INSTANCES.length;
      const instance = NITTER_INSTANCES[instanceIndex];
      
      try {
        const url = `https://${instance}/${username}/rss`;
        logger.debug({ username, instance, url }, 'Fetching RSS feed');
        
        const feed = await this.parser.parseURL(url);
        
        if (!feed.items || feed.items.length === 0) {
          logger.debug({ username, instance }, 'RSS feed is empty');
          continue;
        }

        const tweets: Tweet[] = feed.items.map(item => {
          // Extract tweet ID from URL (e.g., https://nitter.net/user/status/123456)
          const urlMatch = item.link?.match(/\/status\/(\d+)/);
          const tweetId = urlMatch ? urlMatch[1] : '';
          
          // Check if it's a retweet
          const isRetweet = item.title?.startsWith('RT @') || item.title?.startsWith('RT by @') || false;
          
          // Check if it's a reply (usually has "R to @" in title or link contains "/status/" twice)
          const isReply = item.title?.includes('R to @') || false;

          // Convert X.com URLs to twitter.com for better compatibility
          const tweetUrl = item.link?.replace('nitter.net', 'x.com').replace('nitter.poast.org', 'x.com').replace('nitter.privacydev.net', 'x.com').replace('nitter.unixfox.eu', 'x.com') || '';

          return {
            id: tweetId,
            url: tweetUrl,
            text: item.title || '',
            author: username,
            pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
            isRetweet,
            isReply,
          };
        });

        // Successfully fetched, update current instance for next time
        this.currentNitterIndex = instanceIndex;
        
        logger.debug({ username, instance, count: tweets.length }, 'Successfully fetched tweets');
        return tweets;

      } catch (error) {
        logger.warn({ error, username, instance }, 'Failed to fetch from Nitter instance, trying next');
        continue;
      }
    }

    // All instances failed
    logger.error({ username, instances: NITTER_INSTANCES.length }, 'All Nitter instances failed');
    return null;
  }

  /**
   * Post tweet to all enabled Telegram chats
   */
  private async postTweet(tweet: Tweet): Promise<void> {
    const message = this.formatTweetMessage(tweet);
    
    const configs = configManager.getAllConfigs();

    for (const config of configs) {
      if (config.enabled) {
        try {
          await this.bot.sendMessage(config.chatId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: false, // Show preview for tweet link
          });
          logger.info({ chatId: config.chatId, username: tweet.author }, 'Posted tweet to Telegram');
          
          // Small delay between groups
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error({ error, chatId: config.chatId }, 'Failed to post tweet to Telegram');
        }
      }
    }
  }

  /**
   * Format tweet for Telegram message
   */
  private formatTweetMessage(tweet: Tweet): string {
    const lines = [
      `🐦 *New Tweet from @${tweet.author}*`,
      '',
      tweet.url,
      '',
      '🔁 *Retweet Navy!*',
    ];

    return lines.join('\n');
  }
}

