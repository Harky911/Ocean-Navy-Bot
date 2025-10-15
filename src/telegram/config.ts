import { readFileSync, writeFileSync, existsSync } from 'fs';
import { ChatConfig } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

const CONFIG_FILE = './config.json';

interface ConfigStore {
  chats: Record<string, ChatConfig>;
}

class ConfigManager {
  private store: ConfigStore;

  constructor() {
    this.store = this.load();
  }

  private load(): ConfigStore {
    if (!existsSync(CONFIG_FILE)) {
      return { chats: {} };
    }

    try {
      const data = readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      logger.error({ error }, 'Failed to load config file, using empty config');
      return { chats: {} };
    }
  }

  private save(): void {
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(this.store, null, 2), 'utf-8');
      logger.debug('Config saved');
    } catch (error) {
      logger.error({ error }, 'Failed to save config file');
    }
  }

  getConfig(chatId: string): ChatConfig {
    const existing = this.store.chats[chatId];
    if (existing) {
      return existing;
    }

    const defaultConfig: ChatConfig = {
      chatId,
      enabled: true,
      minOceanAlert: env.MIN_OCEAN_ALERT,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.store.chats[chatId] = defaultConfig;
    this.save();
    return defaultConfig;
  }

  updateConfig(chatId: string, updates: Partial<Omit<ChatConfig, 'chatId' | 'createdAt'>>): ChatConfig {
    const config = this.getConfig(chatId);
    Object.assign(config, updates, { updatedAt: new Date().toISOString() });
    this.save();
    return config;
  }

  getAllConfigs(): ChatConfig[] {
    return Object.values(this.store.chats);
  }
}

export const configManager = new ConfigManager();
