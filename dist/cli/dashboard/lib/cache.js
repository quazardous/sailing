import { getPrdsDataImpl, getBlockersImpl, getPendingMemoryImpl } from './data.js';
// Cache for expensive operations
let _prdsDataCache = null;
let _blockersCache = null;
let _pendingMemoryCache = null;
let _cacheTTL = 0;
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
    return getCached(_prdsDataCache, c => { _prdsDataCache = c; }, getPrdsDataImpl);
}
/**
 * Get cached blockers
 */
export function getCachedBlockers() {
    return getCached(_blockersCache, c => { _blockersCache = c; }, getBlockersImpl);
}
/**
 * Get cached pending memory
 */
export function getCachedPendingMemory() {
    return getCached(_pendingMemoryCache, c => { _pendingMemoryCache = c; }, getPendingMemoryImpl);
}
/**
 * Clear all caches
 */
export function clearCache() {
    _prdsDataCache = null;
    _blockersCache = null;
    _pendingMemoryCache = null;
}
