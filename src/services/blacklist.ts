import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

const BLACKLIST_FILE = path.join(process.cwd(), 'data', 'blacklist.json');

/**
 * Service for managing blacklisted wallet addresses
 */
class BlacklistService {
  private blacklist: Set<string> = new Set();
  private initialized = false;

  /**
   * Initialize the blacklist from file
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure data directory exists
      await fs.mkdir(path.dirname(BLACKLIST_FILE), { recursive: true });

      // Try to load existing blacklist
      try {
        const data = await fs.readFile(BLACKLIST_FILE, 'utf-8');
        const addresses = JSON.parse(data) as string[];
        this.blacklist = new Set(addresses.map(addr => addr.toLowerCase()));
        logger.info({ count: this.blacklist.size }, 'Loaded blacklist from file');
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          logger.info('No existing blacklist file, starting fresh');
          await this.save();
        } else {
          throw error;
        }
      }

      this.initialized = true;
    } catch (error) {
      logger.error({ error }, 'Failed to initialize blacklist');
      throw error;
    }
  }

  /**
   * Save blacklist to file
   */
  private async save(): Promise<void> {
    try {
      const addresses = Array.from(this.blacklist);
      await fs.writeFile(BLACKLIST_FILE, JSON.stringify(addresses, null, 2), 'utf-8');
      logger.debug({ count: addresses.length }, 'Saved blacklist to file');
    } catch (error) {
      logger.error({ error }, 'Failed to save blacklist');
      throw error;
    }
  }

  /**
   * Add an address to the blacklist
   * @returns true if added, false if already existed
   */
  async add(address: string): Promise<boolean> {
    await this.initialize();

    const normalized = address.toLowerCase();
    
    if (this.blacklist.has(normalized)) {
      return false;
    }

    this.blacklist.add(normalized);
    await this.save();
    
    logger.info({ address: normalized }, 'Added address to blacklist');
    return true;
  }

  /**
   * Remove an address from the blacklist
   * @returns true if removed, false if didn't exist
   */
  async remove(address: string): Promise<boolean> {
    await this.initialize();

    const normalized = address.toLowerCase();
    
    if (!this.blacklist.has(normalized)) {
      return false;
    }

    this.blacklist.delete(normalized);
    await this.save();
    
    logger.info({ address: normalized }, 'Removed address from blacklist');
    return true;
  }

  /**
   * Toggle an address in the blacklist
   * @returns true if added, false if removed
   */
  async toggle(address: string): Promise<boolean> {
    await this.initialize();

    const normalized = address.toLowerCase();
    
    if (this.blacklist.has(normalized)) {
      await this.remove(normalized);
      return false; // removed
    } else {
      await this.add(normalized);
      return true; // added
    }
  }

  /**
   * Check if an address is blacklisted
   */
  async isBlacklisted(address: string): Promise<boolean> {
    await this.initialize();
    return this.blacklist.has(address.toLowerCase());
  }

  /**
   * Get all blacklisted addresses
   */
  async getAll(): Promise<string[]> {
    await this.initialize();
    return Array.from(this.blacklist);
  }

  /**
   * Get count of blacklisted addresses
   */
  async count(): Promise<number> {
    await this.initialize();
    return this.blacklist.size;
  }

  /**
   * Clear all blacklisted addresses
   */
  async clear(): Promise<void> {
    await this.initialize();
    this.blacklist.clear();
    await this.save();
    logger.info('Cleared all blacklisted addresses');
  }
}

export const blacklistService = new BlacklistService();

