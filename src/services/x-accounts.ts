import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

const ACCOUNTS_FILE = path.join(process.cwd(), 'data', 'x-accounts.json');
const LAST_SEEN_FILE = path.join(process.cwd(), 'data', 'x-last-seen.json');

interface XAccount {
  username: string;
  addedAt: number;
  lastChecked: number;
}

interface LastSeenData {
  [username: string]: string; // username -> last tweet ID
}

/**
 * Service for managing monitored X (Twitter) accounts
 */
class XAccountsService {
  private accounts: Set<string> = new Set();
  private lastSeen: Map<string, string> = new Map();
  private initialized = false;

  /**
   * Initialize from files
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure data directory exists
      await fs.mkdir(path.dirname(ACCOUNTS_FILE), { recursive: true });

      // Load accounts
      try {
        const data = await fs.readFile(ACCOUNTS_FILE, 'utf-8');
        const accountList = JSON.parse(data) as XAccount[];
        this.accounts = new Set(accountList.map(acc => acc.username.toLowerCase()));
        logger.info({ count: this.accounts.size }, 'Loaded X accounts from file');
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          logger.info('No existing X accounts file, starting fresh');
          await this.saveAccounts();
        } else {
          throw error;
        }
      }

      // Load last seen IDs
      try {
        const data = await fs.readFile(LAST_SEEN_FILE, 'utf-8');
        const lastSeenData = JSON.parse(data) as LastSeenData;
        this.lastSeen = new Map(Object.entries(lastSeenData));
        logger.info({ count: this.lastSeen.size }, 'Loaded last seen tweet IDs');
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          logger.info('No existing last seen file, starting fresh');
          await this.saveLastSeen();
        } else {
          throw error;
        }
      }

      this.initialized = true;
    } catch (error) {
      logger.error({ error }, 'Failed to initialize X accounts service');
      throw error;
    }
  }

  /**
   * Save accounts to file
   */
  private async saveAccounts(): Promise<void> {
    try {
      const accountList: XAccount[] = Array.from(this.accounts).map(username => ({
        username,
        addedAt: Date.now(),
        lastChecked: 0,
      }));
      await fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accountList, null, 2), 'utf-8');
      logger.debug({ count: accountList.length }, 'Saved X accounts to file');
    } catch (error) {
      logger.error({ error }, 'Failed to save X accounts');
      throw error;
    }
  }

  /**
   * Save last seen tweet IDs to file
   */
  private async saveLastSeen(): Promise<void> {
    try {
      const lastSeenData: LastSeenData = Object.fromEntries(this.lastSeen);
      await fs.writeFile(LAST_SEEN_FILE, JSON.stringify(lastSeenData, null, 2), 'utf-8');
      logger.debug({ count: this.lastSeen.size }, 'Saved last seen tweet IDs');
    } catch (error) {
      logger.error({ error }, 'Failed to save last seen IDs');
      throw error;
    }
  }

  /**
   * Add an X account to monitor
   * @returns true if added, false if already existed
   */
  async add(username: string): Promise<boolean> {
    await this.initialize();

    // Remove @ if present and normalize to lowercase
    const normalized = username.replace(/^@/, '').toLowerCase();
    
    if (this.accounts.has(normalized)) {
      return false;
    }

    this.accounts.add(normalized);
    await this.saveAccounts();
    
    logger.info({ username: normalized }, 'Added X account to monitor');
    return true;
  }

  /**
   * Remove an X account from monitoring
   * @returns true if removed, false if didn't exist
   */
  async remove(username: string): Promise<boolean> {
    await this.initialize();

    const normalized = username.replace(/^@/, '').toLowerCase();
    
    if (!this.accounts.has(normalized)) {
      return false;
    }

    this.accounts.delete(normalized);
    this.lastSeen.delete(normalized);
    await this.saveAccounts();
    await this.saveLastSeen();
    
    logger.info({ username: normalized }, 'Removed X account from monitoring');
    return true;
  }

  /**
   * Toggle an X account
   * @returns true if added, false if removed
   */
  async toggle(username: string): Promise<boolean> {
    await this.initialize();

    const normalized = username.replace(/^@/, '').toLowerCase();
    
    if (this.accounts.has(normalized)) {
      await this.remove(normalized);
      return false; // removed
    } else {
      await this.add(normalized);
      return true; // added
    }
  }

  /**
   * Get all monitored accounts
   */
  async getAll(): Promise<string[]> {
    await this.initialize();
    return Array.from(this.accounts);
  }

  /**
   * Get count of monitored accounts
   */
  async count(): Promise<number> {
    await this.initialize();
    return this.accounts.size;
  }

  /**
   * Get last seen tweet ID for an account
   */
  async getLastSeen(username: string): Promise<string | null> {
    await this.initialize();
    const normalized = username.replace(/^@/, '').toLowerCase();
    return this.lastSeen.get(normalized) || null;
  }

  /**
   * Set last seen tweet ID for an account
   */
  async setLastSeen(username: string, tweetId: string): Promise<void> {
    await this.initialize();
    const normalized = username.replace(/^@/, '').toLowerCase();
    this.lastSeen.set(normalized, tweetId);
    await this.saveLastSeen();
  }

  /**
   * Check if account is monitored
   */
  async isMonitored(username: string): Promise<boolean> {
    await this.initialize();
    const normalized = username.replace(/^@/, '').toLowerCase();
    return this.accounts.has(normalized);
  }
}

export const xAccountsService = new XAccountsService();

