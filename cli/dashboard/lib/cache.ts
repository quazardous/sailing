/**
 * Dashboard cache management
 */
import type { PrdData, BlockerData, CacheEntry } from './types.js';
import { getPrdsDataImpl, getBlockersImpl, getPendingMemoryImpl } from './data.js';

// Cache for expensive operations
let _prdsDataCache: CacheEntry<PrdData[]> | null = null;
let _blockersCache: CacheEntry<BlockerData[]> | null = null;
let _pendingMemoryCache: CacheEntry<string[]> | null = null;
let _cacheTTL = 0;

/**
 * Set cache TTL in seconds (0 = disabled)
 */
export function setCacheTTL(ttl: number): void {
  _cacheTTL = ttl;
}

/**
 * Get current cache TTL
 */
export function getCacheTTL(): number {
  return _cacheTTL;
}

/**
 * Generic cache helper
 */
function getCached<T>(
  cache: CacheEntry<T> | null,
  setCache: (c: CacheEntry<T>) => void,
  getData: () => T
): T {
  if (_cacheTTL > 0 && cache && Date.now() - cache.timestamp < _cacheTTL * 1000) {
    return cache.data;
  }
  const data = getData();
  if (_cacheTTL > 0) {
    setCache({ data, timestamp: Date.now() });
  }
  return data;
}

/**
 * Get cached PRDs data
 */
export function getCachedPrdsData(): PrdData[] {
  return getCached(
    _prdsDataCache,
    c => { _prdsDataCache = c; },
    getPrdsDataImpl
  );
}

/**
 * Get cached blockers
 */
export function getCachedBlockers(): BlockerData[] {
  return getCached(
    _blockersCache,
    c => { _blockersCache = c; },
    getBlockersImpl
  );
}

/**
 * Get cached pending memory
 */
export function getCachedPendingMemory(): string[] {
  return getCached(
    _pendingMemoryCache,
    c => { _pendingMemoryCache = c; },
    getPendingMemoryImpl
  );
}

/**
 * Clear all caches
 */
export function clearCache(): void {
  _prdsDataCache = null;
  _blockersCache = null;
  _pendingMemoryCache = null;
}
