import { logger } from '../utils/logger.js';
import { xAccountsService } from './x-accounts.js';
import TelegramBot from 'node-telegram-bot-api';
import { configManager } from '../telegram/config.js';
import { env } from '../config/env.js';

// X API v2 constants
const X_API_BASE = 'https://api.x.com/2';
const MONTHLY_TWEET_LIMIT = 1500; // Free tier limit
const SAFETY_MARGIN = 0.9; // Use only 90% of limit to be safe

interface XTweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
}

interface XUser {
  id: string;
  username: string;
}

interface RateLimitState {
  tweetsUsedThisMonth: number;
  monthStartDate: string; // ISO date of month start
}

/**
 * Service for monitoring X (Twitter) accounts via official API v2
 */
export class XMonitorService {
  private bot: TelegramBot;
  private pollInterval: NodeJS.Timeout | null = null;
  private rateLimitState: RateLimitState;
  private readonly STATE_FILE = 'data/x-rate-limit.json';

  constructor(bot: TelegramBot) {
    this.bot = bot;
    this.rateLimitState = {
      tweetsUsedThisMonth: 0,
      monthStartDate: this.getMonthStart(),
    };
  }

  /**
   * Start monitoring X accounts
   */
  async start(): Promise<void> {
    if (!env.X_API_BEARER_TOKEN) {
      logger.warn('X_API_BEARER_TOKEN not set, X monitoring disabled');
      return;
    }

    logger.info('Starting X account monitor with API v2');
    
    // Initialize services
    await xAccountsService.initialize();
    await this.loadRateLimitState();

    // Do initial check
    await this.checkAllAccounts();

    // Calculate optimal polling interval based on account count
    const interval = await this.calculatePollingInterval();
    
    // Setup polling interval
    this.pollInterval = setInterval(async () => {
      try {
        await this.checkAllAccounts();
      } catch (error) {
        logger.error({ error }, 'Error in X monitor poll interval');
      }
    }, interval);

    logger.info({ intervalMs: interval, intervalMins: Math.round(interval / 60000) }, 'X account monitor started');
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
   * Calculate optimal polling interval based on number of accounts
   * Stays within monthly tweet limit
   */
  private async calculatePollingInterval(): Promise<number> {
    const accounts = await xAccountsService.getAll();
    const accountCount = Math.max(accounts.length, 1); // At least 1

    // Calculate how many API calls we can make per month per account
    const usableLimit = Math.floor(MONTHLY_TWEET_LIMIT * SAFETY_MARGIN);
    const callsPerAccountPerMonth = Math.floor(usableLimit / accountCount);
    
    // Calculate calls per day
    const callsPerAccountPerDay = callsPerAccountPerMonth / 30;
    
    // Calculate interval in milliseconds
    const intervalMs = Math.floor((24 * 60 * 60 * 1000) / callsPerAccountPerDay);

    logger.info({
      accountCount,
      callsPerAccountPerMonth,
      callsPerAccountPerDay: callsPerAccountPerDay.toFixed(1),
      intervalMs,
      intervalMins: Math.round(intervalMs / 60000),
      intervalHours: (intervalMs / (60 * 60 * 1000)).toFixed(2),
    }, 'Calculated polling interval');

    return intervalMs;
  }

  /**
   * Get start of current month
   */
  private getMonthStart(): string {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }

  /**
   * Load rate limit state from file
   */
  private async loadRateLimitState(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(this.STATE_FILE, 'utf-8');
      this.rateLimitState = JSON.parse(data);
      
      // Reset if new month
      const currentMonthStart = this.getMonthStart();
      if (this.rateLimitState.monthStartDate !== currentMonthStart) {
        logger.info('New month detected, resetting rate limit counter');
        this.rateLimitState = {
          tweetsUsedThisMonth: 0,
          monthStartDate: currentMonthStart,
        };
        await this.saveRateLimitState();
      }

      logger.debug({ rateLimitState: this.rateLimitState }, 'Loaded rate limit state');
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        logger.error({ error }, 'Failed to load rate limit state');
      }
    }
  }

  /**
   * Save rate limit state to file
   */
  private async saveRateLimitState(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      await fs.mkdir(path.dirname(this.STATE_FILE), { recursive: true });
      await fs.writeFile(this.STATE_FILE, JSON.stringify(this.rateLimitState, null, 2));
      logger.debug({ rateLimitState: this.rateLimitState }, 'Saved rate limit state');
    } catch (error) {
      logger.error({ error }, 'Failed to save rate limit state');
    }
  }

  /**
   * Check if we have API budget left
   */
  private canMakeApiCall(): boolean {
    const usableLimit = Math.floor(MONTHLY_TWEET_LIMIT * SAFETY_MARGIN);
    return this.rateLimitState.tweetsUsedThisMonth < usableLimit;
  }

  /**
   * Increment API usage counter
   */
  private async incrementApiUsage(): Promise<void> {
    this.rateLimitState.tweetsUsedThisMonth++;
    await this.saveRateLimitState();
    
    const remaining = Math.floor(MONTHLY_TWEET_LIMIT * SAFETY_MARGIN) - this.rateLimitState.tweetsUsedThisMonth;
    if (remaining < 100) {
      logger.warn({ remaining }, 'API usage approaching monthly limit');
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

    const usedPercent = (this.rateLimitState.tweetsUsedThisMonth / MONTHLY_TWEET_LIMIT * 100).toFixed(1);
    logger.debug({
      count: accounts.length,
      apiUsed: this.rateLimitState.tweetsUsedThisMonth,
      apiLimit: MONTHLY_TWEET_LIMIT,
      usedPercent: `${usedPercent}%`,
    }, 'Checking X accounts for new tweets');

    for (const username of accounts) {
      if (!this.canMakeApiCall()) {
        logger.warn('Monthly API limit reached, skipping remaining accounts');
        break;
      }

      try {
        await this.checkAccount(username);
        // Small delay between accounts
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error({ error, username }, 'Failed to check X account');
      }
    }
  }

  /**
   * Check a single account for new tweets
   */
  private async checkAccount(username: string): Promise<void> {
    // Get user ID
    const user = await this.getUserByUsername(username);
    if (!user) {
      logger.warn({ username }, 'User not found on X');
      return;
    }

    // Get recent tweets
    const tweets = await this.getUserTweets(user.id);
    if (!tweets || tweets.length === 0) {
      logger.debug({ username }, 'No tweets found');
      return;
    }

    const lastSeenId = await xAccountsService.getLastSeen(username);
    
    // Filter to new tweets only
    const newTweets = tweets.filter(t => !lastSeenId || t.id > lastSeenId);

    if (newTweets.length === 0) {
      logger.debug({ username }, 'No new tweets');
      return;
    }

    // Sort oldest first
    newTweets.sort((a, b) => a.id.localeCompare(b.id));

    logger.info({ username, count: newTweets.length }, 'Found new tweets');

    // Post new tweets to Telegram
    for (const tweet of newTweets) {
      await this.postTweet(tweet, username);
      await xAccountsService.setLastSeen(username, tweet.id);
      // Small delay between posts
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Get X user by username
   */
  private async getUserByUsername(username: string): Promise<XUser | null> {
    try {
      const url = `${X_API_BASE}/users/by/username/${username}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${env.X_API_BEARER_TOKEN}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, errorText, username }, 'X API error (get user)');
        return null;
      }

      const data = await response.json() as { data?: XUser };
      return data.data || null;
    } catch (error) {
      logger.error({ error, username }, 'Failed to get X user');
      return null;
    }
  }

  /**
   * Get user's recent tweets
   */
  private async getUserTweets(userId: string): Promise<XTweet[] | null> {
    try {
      const url = `${X_API_BASE}/users/${userId}/tweets?max_results=10&exclude=retweets,replies&tweet.fields=created_at`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${env.X_API_BEARER_TOKEN}`,
        },
      });

      // Increment usage counter
      await this.incrementApiUsage();

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, errorText, userId }, 'X API error (get tweets)');
        return null;
      }

      const data = await response.json() as { data?: XTweet[] };
      return data.data || [];
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get X tweets');
      return null;
    }
  }

  /**
   * Post tweet to all enabled Telegram chats
   */
  private async postTweet(tweet: XTweet, username: string): Promise<void> {
    const tweetUrl = `https://x.com/${username}/status/${tweet.id}`;
    const message = this.formatTweetMessage(username, tweetUrl);
    
    const configs = configManager.getAllConfigs();

    for (const config of configs) {
      if (config.enabled) {
        try {
          await this.bot.sendMessage(config.chatId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: false, // Show preview for tweet link
          });
          logger.info({ chatId: config.chatId, username, tweetId: tweet.id }, 'Posted tweet to Telegram');
          
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
  private formatTweetMessage(username: string, tweetUrl: string): string {
    const lines = [
      `🐦 *New Tweet from @${username}*`,
      '',
      tweetUrl,
      '',
      '🔁 *Retweet Navy!*',
    ];

    return lines.join('\n');
  }
}
