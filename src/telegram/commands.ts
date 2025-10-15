import TelegramBot from 'node-telegram-bot-api';
import { configManager } from './config.js';
import { logger } from '../utils/logger.js';

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
      `/setmin <amount> - Set minimum OCEAN (admin)\n` +
      `/enable - Enable alerts (admin)\n` +
      `/disable - Disable alerts (admin)`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
      `🌊 *Ocean Navy Bot - Commands*\n\n` +
      `*Everyone:*\n` +
      `/help - Show this message\n` +
      `/status - Show current settings\n\n` +
      `*Admins Only:*\n` +
      `/setmin <amount> - Set min OCEAN amount\n` +
      `/enable - Enable buy alerts\n` +
      `/disable - Disable buy alerts\n\n` +
      `Example: \`/setmin 100\` to only alert for buys ≥100 OCEAN`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id.toString();
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

    const chatId = msg.chat.id.toString();
    configManager.updateConfig(chatId, { minOceanAlert: amount });

    await bot.sendMessage(msg.chat.id, `✅ Minimum OCEAN alert set to *${amount}*`, { parse_mode: 'Markdown' });
    logger.info({ chatId, amount }, 'Min OCEAN alert updated');
  });

  bot.onText(/\/enable/, async (msg) => {
    const isAdmin = msg.chat.type === 'private' || await isUserAdmin(bot, msg.chat.id, msg.from!.id);
    if (!isAdmin) {
      await bot.sendMessage(msg.chat.id, '❌ Only admins can change settings.');
      return;
    }

    const chatId = msg.chat.id.toString();
    configManager.updateConfig(chatId, { enabled: true });

    await bot.sendMessage(msg.chat.id, '✅ OCEAN buy alerts *enabled*', { parse_mode: 'Markdown' });
    logger.info({ chatId }, 'Alerts enabled');
  });

  bot.onText(/\/disable/, async (msg) => {
    const isAdmin = msg.chat.type === 'private' || await isUserAdmin(bot, msg.chat.id, msg.from!.id);
    if (!isAdmin) {
      await bot.sendMessage(msg.chat.id, '❌ Only admins can change settings.');
      return;
    }

    const chatId = msg.chat.id.toString();
    configManager.updateConfig(chatId, { enabled: false });

    await bot.sendMessage(msg.chat.id, '⏸️ OCEAN buy alerts *disabled*', { parse_mode: 'Markdown' });
    logger.info({ chatId }, 'Alerts disabled');
  });

  logger.info('Telegram commands registered');
}
