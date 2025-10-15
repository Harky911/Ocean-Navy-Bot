import { DedupeSet } from '../utils/set.js';
import { logger } from '../utils/logger.js';

export class DedupeManager {
  private seen: DedupeSet;

  constructor() {
    this.seen = new DedupeSet(2000, 7200000);
  }

  makeKey(txHash: string, logIndex: number): string {
    return `${txHash}:${logIndex}`;
  }

  isDuplicate(txHash: string, logIndex: number): boolean {
    const key = this.makeKey(txHash, logIndex);
    return this.seen.has(key);
  }

  markSeen(txHash: string, logIndex: number): void {
    const key = this.makeKey(txHash, logIndex);
    this.seen.add(key);
    logger.debug({ key }, 'Marked event as seen');
  }

  handleReorg(txHash: string, logIndex: number): void {
    const key = this.makeKey(txHash, logIndex);
    this.seen.delete(key);
    logger.info({ key }, 'Removed event due to reorg');
  }
}
