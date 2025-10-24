import TelegramBot from 'node-telegram-bot-api';
import { env } from '../config/env.js';
import { BuyAlert } from '../core/types.js';
import { formatBuyAlert, formatBatchAlert } from '../core/formatter.js';
import { configManager } from './config.js';
import { registerCommands } from './commands.js';
import { logger } from '../utils/logger.js';
import { oceanToNumber } from '../utils/bigint.js';
import { blacklistService } from '../services/blacklist.js';
import { XMonitorService } from '../services/x-monitor.js';

class TelegramClient {
  private bot: TelegramBot;
  private batchQueue: Map<string, BuyAlert[]> = new Map();
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private xMonitor: XMonitorService;

  constructor() {
    this.bot = new TelegramBot(env.TELEGRAM_BOT_TOKEN, {
      polling: env.TELEGRAM_POLLING,
    });

    registerCommands(this.bot);

    this.bot.on('polling_error', (error) => {
      logger.error({ error }, 'Telegram polling error');
    });

    // Initialize and start X account monitor
    this.xMonitor = new XMonitorService(this.bot);
    this.xMonitor.start().catch(error => {
      logger.error({ error }, 'Failed to start X monitor');
    });

    logger.info({ polling: env.TELEGRAM_POLLING }, 'Telegram bot initialized');
  }

  async sendBuyAlert(buy: BuyAlert, chatId?: string): Promise<void> {
    const targetChatId = chatId || env.TELEGRAM_CHAT_ID;
    const config = configManager.getConfig(targetChatId);

    if (!config.enabled) {
      logger.debug({ chatId: targetChatId }, 'Alerts disabled for chat, skipping');
      return;
    }

    const amount = oceanToNumber(buy.oceanAmount);
    if (amount < config.minOceanAlert) {
      logger.debug({ chatId: targetChatId, amount, minAmount: config.minOceanAlert }, 'Below min threshold, skipping');
      return;
    }

    // Check if buyer address is blacklisted
    if (buy.buyerAddress && await blacklistService.isBlacklisted(buy.buyerAddress)) {
      logger.debug({ chatId: targetChatId, address: buy.buyerAddress }, 'Address is blacklisted, skipping');
      return;
    }

    if (env.DEBOUNCE_MS > 0) {
      this.addToBatch(targetChatId, buy);
    } else {
      await this.sendImmediate(targetChatId, buy);
    }
  }

  async broadcastBuyAlert(buy: BuyAlert): Promise<void> {
    const configs = configManager.getAllConfigs();

    for (const config of configs) {
      if (config.enabled) {
        await this.sendBuyAlert(buy, config.chatId);
        // Small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (configs.length === 0) {
      await this.sendBuyAlert(buy);
    }
  }

  private async sendImmediate(chatId: string, buy: BuyAlert): Promise<void> {
    try {
      const message = formatBuyAlert(buy);
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
      logger.info({ chatId, txHash: buy.txHash, amount: buy.oceanFormatted }, 'Sent buy alert');
    } catch (error) {
      logger.error({ error, chatId, buy }, 'Failed to send buy alert');
    }
  }

  private addToBatch(chatId: string, buy: BuyAlert): void {
    if (!this.batchQueue.has(chatId)) {
      this.batchQueue.set(chatId, []);
    }

    this.batchQueue.get(chatId)!.push(buy);

    if (this.batchTimers.has(chatId)) {
      clearTimeout(this.batchTimers.get(chatId)!);
    }

    const timer = setTimeout(() => {
      this.flushBatch(chatId);
    }, env.DEBOUNCE_MS);

    this.batchTimers.set(chatId, timer);
  }

  private async flushBatch(chatId: string): Promise<void> {
    const buys = this.batchQueue.get(chatId);
    if (!buys || buys.length === 0) return;

    this.batchQueue.delete(chatId);
    this.batchTimers.delete(chatId);

    try {
      const message = buys.length === 1 ? formatBuyAlert(buys[0]) : formatBatchAlert(buys);
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
      logger.info({ chatId, count: buys.length }, 'Sent batch alert');
    } catch (error) {
      logger.error({ error, chatId, count: buys.length }, 'Failed to send batch alert');
    }
  }

  getBot(): TelegramBot {
    return this.bot;
  }
}

export const telegramClient = new TelegramClient();
