import TelegramBot from 'node-telegram-bot-api';
import { configManager } from './config.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { ratioService } from '../services/ratio.js';
import { topBuyersService } from '../services/top-buyers.js';
import { blacklistService } from '../services/blacklist.js';
import { xAccountsService } from '../services/x-accounts.js';

function isAllowedChat(chatId: string): boolean {
  // If no whitelist is configured, allow all chats (backward compatible)
  if (!env.TELEGRAM_ALLOWED_CHATS) {
    return true;
  }
  
  const allowedChats = env.TELEGRAM_ALLOWED_CHATS.split(',').map(id => id.trim());
  return allowedChats.includes(chatId);
}

export async function isUserAdmin(bot: TelegramBot, chatId: number, userId: number): Promise<boolean> {
  try {
    const member = await bot.getChatMember(chatId, userId);
    return member.status === 'creator' || member.status === 'administrator';
  } catch (error) {
    logger.error({ error, chatId, userId }, 'Failed to check admin status');
    return false;
  }
}

export function registerCommands(bot: TelegramBot): void {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    
    // Check if chat is allowed
    if (!isAllowedChat(chatId)) {
      logger.warn({ chatId }, 'Unauthorized chat attempted to use bot');
      await bot.sendMessage(msg.chat.id,
        `⚠️ This bot is private and restricted to authorized groups only.`
      );
      return;
    }
    
    const config = configManager.getConfig(chatId);

    await bot.sendMessage(msg.chat.id,
      `🌊 *Ocean Navy Bot*\n\n` +
      `I monitor OCEAN DEX buys and alert you in real-time.\n\n` +
      `*Current Settings:*\n` +
      `• Alerts: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
      `• Min OCEAN: ${config.minOceanAlert}\n\n` +
      `*Commands:*\n` +
      `/help - Show this message\n` +
      `/status - Show current settings\n` +
      `/ratio - FET:OCEAN price ratio (public)\n` +
      `/top - Top OCEAN buyers (public)\n` +
      `/setmin <amount> - Set minimum OCEAN (admin)\n` +
      `/enable - Enable alerts (admin)\n` +
      `/disable - Disable alerts (admin)\n` +
      `/blacklist - Manage blacklisted addresses (admin)\n` +
      `/xaccount - Monitor X (Twitter) accounts (admin)`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAllowedChat(chatId)) return;
    
    await bot.sendMessage(msg.chat.id,
      `🌊 *Ocean Navy Bot - Commands*\n\n` +
      `*Everyone:*\n` +
      `/help - Show this message\n` +
      `/status - Show current settings\n` +
      `/ratio - FET:OCEAN price ratio\n` +
      `/top - Top OCEAN buyers by time period\n\n` +
      `*Admins Only:*\n` +
      `/setmin <amount> - Set min OCEAN amount\n` +
      `/enable - Enable buy alerts\n` +
      `/disable - Disable buy alerts\n` +
      `/blacklist <address> - Add/remove address from blacklist\n` +
      `/blacklist show - View blacklisted addresses\n` +
      `/xaccount <username> - Monitor X account tweets\n` +
      `/xaccount show - View monitored X accounts\n\n` +
      `Example: \`/setmin 100\` to only alert for buys ≥100 OCEAN`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAllowedChat(chatId)) return;
    
    const config = configManager.getConfig(chatId);

    await bot.sendMessage(msg.chat.id,
      `📊 *Current Settings*\n\n` +
      `• Alerts: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
      `• Min OCEAN: ${config.minOceanAlert}\n` +
      `• Updated: ${new Date(config.updatedAt).toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/setmin (.+)/, async (msg, match) => {
    if (!match) return;

    const chatId = msg.chat.id.toString();
    if (!isAllowedChat(chatId)) return;

    const isAdmin = msg.chat.type === 'private' || await isUserAdmin(bot, msg.chat.id, msg.from!.id);
    if (!isAdmin) {
      await bot.sendMessage(msg.chat.id, '❌ Only admins can change settings.');
      return;
    }

    const amount = parseFloat(match[1]);
    if (isNaN(amount) || amount < 0) {
      await bot.sendMessage(msg.chat.id, '❌ Invalid amount. Use a positive number.\n\nExample: `/setmin 50`', { parse_mode: 'Markdown' });
      return;
    }

    configManager.updateConfig(chatId, { minOceanAlert: amount });

    await bot.sendMessage(msg.chat.id, `✅ Minimum OCEAN alert set to *${amount}*`, { parse_mode: 'Markdown' });
    logger.info({ chatId, amount }, 'Min OCEAN alert updated');
  });

  bot.onText(/\/enable/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAllowedChat(chatId)) return;

    const isAdmin = msg.chat.type === 'private' || await isUserAdmin(bot, msg.chat.id, msg.from!.id);
    if (!isAdmin) {
      await bot.sendMessage(msg.chat.id, '❌ Only admins can change settings.');
      return;
    }

    configManager.updateConfig(chatId, { enabled: true });

    await bot.sendMessage(msg.chat.id, '✅ OCEAN buy alerts *enabled*', { parse_mode: 'Markdown' });
    logger.info({ chatId }, 'Alerts enabled');
  });

  bot.onText(/\/disable/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAllowedChat(chatId)) return;

    const isAdmin = msg.chat.type === 'private' || await isUserAdmin(bot, msg.chat.id, msg.from!.id);
    if (!isAdmin) {
      await bot.sendMessage(msg.chat.id, '❌ Only admins can change settings.');
      return;
    }

    configManager.updateConfig(chatId, { enabled: false });

    await bot.sendMessage(msg.chat.id, '⏸️ OCEAN buy alerts *disabled*', { parse_mode: 'Markdown' });
    logger.info({ chatId }, 'Alerts disabled');
  });

  // PUBLIC COMMAND - No auth check
  bot.onText(/\/ratio/, async (msg) => {
    const chatId = msg.chat.id.toString();
    
    try {
      // Show "typing" indicator
      await bot.sendChatAction(msg.chat.id, 'typing');
      
      const ratioData = await ratioService.getRatioData();
      
      if (!ratioData) {
        await bot.sendMessage(msg.chat.id, 
          '❌ Unable to fetch ratio data. Please try again later.'
        );
        return;
      }

      const currentPrices = ratioService.getCurrentPricesFromCache();
      logger.debug({ currentPrices }, 'Current prices from cache');
      
      const message = ratioService.formatRatioMessage(
        ratioData, 
        currentPrices?.fet, 
        currentPrices?.ocean
      );
      await bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
      
      logger.info({ chatId }, 'Ratio command executed');
    } catch (error) {
      logger.error({ error, chatId }, 'Failed to execute ratio command');
      await bot.sendMessage(msg.chat.id, 
        '❌ Error fetching ratio data. Please try again later.'
      );
    }
  });

  // /top command - Show time selection buttons (public command)
  bot.onText(/\/top/, async (msg) => {
    const chatId = msg.chat.id.toString();
    
    try {
      const keyboard = {
        inline_keyboard: [
          [
            { text: '5m', callback_data: 'top:5m' },
            { text: '30m', callback_data: 'top:30m' },
            { text: '1h', callback_data: 'top:1h' },
          ],
          [
            { text: '4h', callback_data: 'top:4h' },
            { text: '12h', callback_data: 'top:12h' },
            { text: '1d', callback_data: 'top:1d' },
          ],
          [
            { text: '7d', callback_data: 'top:7d' },
          ],
        ],
      };

      await bot.sendMessage(
        msg.chat.id,
        '🏆 *Top OCEAN Buyers*\n\nSelect time period:',
        {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }
      );

      logger.info({ chatId }, 'Top command executed - showing time selection');
    } catch (error) {
      logger.error({ error, chatId }, 'Failed to execute top command');
      await bot.sendMessage(msg.chat.id, '❌ Error showing options. Please try again later.');
    }
  });

  // Handle callback queries for /top time selection
  bot.on('callback_query', async (query) => {
    if (!query.data?.startsWith('top:')) return;

    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    
    if (!chatId || !messageId) return;

    try {
      const timePeriod = query.data.split(':')[1];
      
      // Answer callback to remove loading state
      await bot.answerCallbackQuery(query.id, { text: `Fetching ${timePeriod} data...` });

      // Edit message to show loading
      await bot.editMessageText(
        `⏳ Fetching top OCEAN buyers for *${timePeriod}*...\n\nThis may take a moment.`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
        }
      );

      logger.info({ chatId, timePeriod }, 'Fetching top buyers');

      // Fetch top buyers
      const result = await topBuyersService.getTopBuyers(timePeriod);

      if (!result) {
        await bot.editMessageText(
          '❌ Unable to fetch top buyers. Please try again later.',
          {
            chat_id: chatId,
            message_id: messageId,
          }
        );
        return;
      }

      // Format message
      const lines = result.topBuyers.map((buyer, i) => {
        const shortAddr = buyer.address.slice(0, 6) + '…' + buyer.address.slice(-4);
        const oceanFormatted = buyer.oceanAmount.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        });
        const usdFormatted = buyer.usdValue.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        });
        return `${i + 1}. [${shortAddr}](https://etherscan.io/address/${buyer.address}) → ${oceanFormatted} OCEAN ($${usdFormatted})`;
      });

      const message = [
        `🏆 *Top 5 OCEAN Buyers (${timePeriod})*`,
        ``,
        ...lines,
        ``,
        `🐋 Whale Count: ${result.whaleCount} wallets > $5,000`,
        `👥 Total Buyers: ${result.totalBuyers}`,
        ``,
        `_Across all DEXs (V2, V3, V4, aggregators)_`,
      ].join('\n');

      await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      logger.info({ chatId, timePeriod, topBuyers: result.topBuyers.length }, 'Top buyers sent');
    } catch (error) {
      logger.error({ error, chatId }, 'Failed to handle top callback query');
      await bot.answerCallbackQuery(query.id, { 
        text: 'Error fetching data. Please try again.', 
        show_alert: true 
      });
    }
  });

  // /blacklist command - manage blacklisted addresses
  bot.onText(/\/blacklist(.*)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    
    // Check if chat is allowed
    if (!isAllowedChat(chatId)) {
      return;
    }

    // Check if user is admin
    if (!await isUserAdmin(bot, msg.chat.id, msg.from!.id)) {
      await bot.sendMessage(msg.chat.id, '⚠️ Only admins can manage the blacklist.');
      return;
    }

    try {
      const args = match?.[1]?.trim() || '';

      // /blacklist show - display current blacklist
      if (args === 'show' || args === '') {
        const addresses = await blacklistService.getAll();
        
        if (addresses.length === 0) {
          await bot.sendMessage(
            msg.chat.id,
            '📋 *Blacklist*\n\nNo addresses blacklisted.\n\nUse `/blacklist <address>` to add an address.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        const lines = addresses.map((addr, i) => {
          const shortAddr = addr.slice(0, 6) + '…' + addr.slice(-4);
          return `${i + 1}. \`${shortAddr}\` ([view](https://etherscan.io/address/${addr}))`;
        });

        const message = [
          `📋 *Blacklist* (${addresses.length} address${addresses.length === 1 ? '' : 'es'})`,
          '',
          ...lines,
          '',
          '_These addresses will not trigger buy notifications._',
          '',
          'Use `/blacklist <address>` to add/remove an address.',
        ].join('\n');

        await bot.sendMessage(msg.chat.id, message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });

        logger.info({ chatId, count: addresses.length }, 'Blacklist shown');
        return;
      }

      // Parse address from args
      const addressMatch = args.match(/^(0x[a-fA-F0-9]{40})$/);
      
      if (!addressMatch) {
        await bot.sendMessage(
          msg.chat.id,
          '⚠️ Invalid address format.\n\n' +
          '*Usage:*\n' +
          '• `/blacklist <address>` - Add/remove an address\n' +
          '• `/blacklist show` - Show blacklist',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const address = addressMatch[1];

      // Toggle the address
      const added = await blacklistService.toggle(address);
      const shortAddr = address.slice(0, 6) + '…' + address.slice(-4);

      if (added) {
        await bot.sendMessage(
          msg.chat.id,
          `✅ *Address Blacklisted*\n\n` +
          `\`${shortAddr}\` will no longer trigger buy notifications.\n\n` +
          `Use \`/blacklist ${address}\` again to remove it.`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ chatId, address }, 'Address added to blacklist');
      } else {
        await bot.sendMessage(
          msg.chat.id,
          `✅ *Address Removed from Blacklist*\n\n` +
          `\`${shortAddr}\` will now trigger buy notifications again.`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ chatId, address }, 'Address removed from blacklist');
      }

    } catch (error) {
      logger.error({ error, chatId }, 'Failed to handle blacklist command');
      await bot.sendMessage(
        msg.chat.id,
        '❌ Failed to update blacklist. Please try again.'
      );
    }
  });

  // /xaccount command - manage monitored X accounts
  bot.onText(/\/xaccount(.*)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    
    // Check if chat is allowed
    if (!isAllowedChat(chatId)) {
      return;
    }

    // Check if user is admin
    if (!await isUserAdmin(bot, msg.chat.id, msg.from!.id)) {
      await bot.sendMessage(msg.chat.id, '⚠️ Only admins can manage X account monitoring.');
      return;
    }

    try {
      const args = match?.[1]?.trim() || '';

      // /xaccount show - display monitored accounts
      if (args === 'show' || args === '') {
        const accounts = await xAccountsService.getAll();
        
        if (accounts.length === 0) {
          await bot.sendMessage(
            msg.chat.id,
            '📋 *X Account Monitor*\n\nNo accounts being monitored.\n\nUse `/xaccount <username>` to add an account.',
            { parse_mode: 'Markdown' }
          );
          return;
        }

        const lines = accounts.map((username, i) => {
          return `${i + 1}. [@${username}](https://x.com/${username})`;
        });

        const message = [
          `📋 *X Account Monitor* (${accounts.length} account${accounts.length === 1 ? '' : 's'})`,
          '',
          ...lines,
          '',
          '_New tweets from these accounts will be posted here._',
          '',
          'Use `/xaccount <username>` to add/remove an account.',
        ].join('\n');

        await bot.sendMessage(msg.chat.id, message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });

        logger.info({ chatId, count: accounts.length }, 'X accounts shown');
        return;
      }

      // Parse username from args
      const username = args.replace(/^@/, '').trim();
      
      // Validate username (alphanumeric and underscores, 1-15 chars)
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(username)) {
        await bot.sendMessage(
          msg.chat.id,
          '⚠️ Invalid X username format.\n\n' +
          '*Usage:*\n' +
          '• `/xaccount <username>` - Add/remove an account\n' +
          '• `/xaccount show` - Show monitored accounts\n\n' +
          '*Example:*\n' +
          '`/xaccount elonmusk`\n' +
          '`/xaccount @VitalikButerin`',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Toggle the account
      const added = await xAccountsService.toggle(username);

      if (added) {
        await bot.sendMessage(
          msg.chat.id,
          `✅ *Now Monitoring @${username}*\n\n` +
          `New tweets will be posted to this chat.\n\n` +
          `Use \`/xaccount ${username}\` again to stop monitoring.`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ chatId, username }, 'X account added to monitor');
      } else {
        await bot.sendMessage(
          msg.chat.id,
          `✅ *Stopped Monitoring @${username}*\n\n` +
          `Tweets will no longer be posted.`,
          { parse_mode: 'Markdown' }
        );
        logger.info({ chatId, username }, 'X account removed from monitor');
      }

    } catch (error) {
      logger.error({ error, chatId }, 'Failed to handle xaccount command');
      await bot.sendMessage(
        msg.chat.id,
        '❌ Failed to update X account monitoring. Please try again.'
      );
    }
  });

  logger.info('Telegram commands registered');
}
