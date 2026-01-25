// Cache for expensive operations
let _prdsDataCache = null;
let _blockersCache = null;
let _pendingMemoryCache = null;
let _cacheTTL = 0;
// Injected fetcher functions (set by initCache)
let _prdsFetcher = null;
let _blockersFetcher = null;
let _pendingMemoryFetcher = null;
/**
 * Initialize cache with fetcher functions (called by API layer)
 */
export function initCache(fetchers) {
    _prdsFetcher = fetchers.prds;
    _blockersFetcher = fetchers.blockers;
    _pendingMemoryFetcher = fetchers.pendingMemory;
}
/**
 * Set cache TTL in seconds (0 = disabled)
 */
export function setCacheTTL(ttl) {
    _cacheTTL = ttl;
}
/**
 * Get current cache TTL
 */
export function getCacheTTL() {
    return _cacheTTL;
}
/**
 * Generic cache helper
 */
function getCached(cache, setCache, getData) {
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
export function getCachedPrdsData() {
    if (!_prdsFetcher) {
        throw new Error('Cache not initialized. Call initCache() first.');
    }
    return getCached(_prdsDataCache, c => { _prdsDataCache = c; }, _prdsFetcher);
}
/**
 * Get cached blockers
 */
export function getCachedBlockers() {
    if (!_blockersFetcher) {
        throw new Error('Cache not initialized. Call initCache() first.');
    }
    return getCached(_blockersCache, c => { _blockersCache = c; }, _blockersFetcher);
}
/**
 * Get cached pending memory
 */
export function getCachedPendingMemory() {
    if (!_pendingMemoryFetcher) {
        throw new Error('Cache not initialized. Call initCache() first.');
    }
    return getCached(_pendingMemoryCache, c => { _pendingMemoryCache = c; }, _pendingMemoryFetcher);
}
/**
 * Clear all caches
 */
export function clearCache() {
    _prdsDataCache = null;
    _blockersCache = null;
    _pendingMemoryCache = null;
}
