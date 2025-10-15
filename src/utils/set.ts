import { LRUCache } from 'lru-cache';

export class DedupeSet {
  private cache: LRUCache<string, boolean>;

  constructor(maxSize = 1000, ttl = 3600000) {
    this.cache = new LRUCache<string, boolean>({
      max: maxSize,
      ttl,
    });
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  add(key: string): void {
    this.cache.set(key, true);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
