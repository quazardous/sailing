/**
 * Dashboard cache management (PURE - no manager imports)
 *
 * This module provides generic caching for expensive operations.
 * Fetcher functions are injected by the API layer (which CAN call managers).
 */
import type { PrdData, BlockerData, CacheEntry } from './types.js';

// Cache for expensive operations
let _prdsDataCache: CacheEntry<PrdData[]> | null = null;
let _blockersCache: CacheEntry<BlockerData[]> | null = null;
let _pendingMemoryCache: CacheEntry<string[]> | null = null;
let _cacheTTL = 0;

// Injected fetcher functions (set by initCache)
let _prdsFetcher: (() => PrdData[]) | null = null;
let _blockersFetcher: (() => BlockerData[]) | null = null;
let _pendingMemoryFetcher: (() => string[]) | null = null;

/**
 * Initialize cache with fetcher functions (called by API layer)
 */
export function initCache(fetchers: {
  prds: () => PrdData[];
  blockers: () => BlockerData[];
  pendingMemory: () => string[];
}): void {
  _prdsFetcher = fetchers.prds;
  _blockersFetcher = fetchers.blockers;
  _pendingMemoryFetcher = fetchers.pendingMemory;
}

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
  if (!_prdsFetcher) {
    throw new Error('Cache not initialized. Call initCache() first.');
  }
  return getCached(
    _prdsDataCache,
    c => { _prdsDataCache = c; },
    _prdsFetcher
  );
}

/**
 * Get cached blockers
 */
export function getCachedBlockers(): BlockerData[] {
  if (!_blockersFetcher) {
    throw new Error('Cache not initialized. Call initCache() first.');
  }
  return getCached(
    _blockersCache,
    c => { _blockersCache = c; },
    _blockersFetcher
  );
}

/**
 * Get cached pending memory
 */
export function getCachedPendingMemory(): string[] {
  if (!_pendingMemoryFetcher) {
    throw new Error('Cache not initialized. Call initCache() first.');
  }
  return getCached(
    _pendingMemoryCache,
    c => { _pendingMemoryCache = c; },
    _pendingMemoryFetcher
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
