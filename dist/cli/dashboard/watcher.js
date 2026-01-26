/**
 * File Watcher for Dashboard
 *
 * Watches configured directories and broadcasts changes via WebSocket.
 * Uses fs.watch (inotify on Linux) with debouncing.
 */
import fs from 'fs';
import path from 'path';
import { getPath } from '../managers/core-manager.js';
import { broadcast, getConnectionCount } from './websocket.js';
import { clearCache as clearDashboardCache } from './lib/cache.js';
import { clearCache as clearArtefactsCache } from '../managers/artefacts/common.js';
import { normalizeId } from '../lib/normalize.js';
import { prdIdFromDir } from '../managers/artefacts/prd.js';
// =============================================================================
// Watch Configs from "managers"
// =============================================================================
/**
 * Get watch config for artefacts (PRDs, Epics, Tasks)
 */
function getArtefactsWatchConfig() {
    return {
        paths: [getPath('artefacts')],
        patterns: ['*.md'],
        event: 'artefact:updated',
        debounce: 200,
        onClear: () => {
            clearArtefactsCache(); // Clear managers cache (task/epic/prd indices)
            clearDashboardCache(); // Clear dashboard lib cache
        }
    };
}
// Future: add more watch configs here
// function getAgentsWatchConfig(): WatchConfig { ... }
/**
 * Get all watch configurations
 */
export function getAllWatchConfigs() {
    return [
        getArtefactsWatchConfig(),
        // Add more as needed
    ];
}
// =============================================================================
// Watcher Implementation
// =============================================================================
const activeWatchers = [];
const debounceTimers = new Map();
/**
 * Extract artefact ID and type from file path using existing managers
 * Examples:
 *   prds/PRD-001-xxx/prd.md → { id: 'PRD-001', type: 'prd' }
 *   prds/PRD-001-xxx/epics/E001-xxx.md → { id: 'E001', type: 'epic' }
 *   prds/PRD-001-xxx/tasks/T001-xxx.md → { id: 'T001', type: 'task' }
 */
function extractArtefactInfo(filepath) {
    if (!filepath)
        return null;
    const filename = path.basename(filepath);
    // Task: tasks/T001-xxx.md
    if (filepath.includes('/tasks/') || filepath.includes('\\tasks\\')) {
        const match = filename.match(/^(T\d+[a-z]?)/i);
        if (match) {
            const id = normalizeId(match[1]);
            return id ? { id, type: 'task' } : null;
        }
    }
    // Epic: epics/E001-xxx.md
    if (filepath.includes('/epics/') || filepath.includes('\\epics\\')) {
        const match = filename.match(/^(E\d+[a-z]?)/i);
        if (match) {
            const id = normalizeId(match[1]);
            return id ? { id, type: 'epic' } : null;
        }
    }
    // PRD: prds/PRD-001-xxx/prd.md (filename is prd.md, need parent dir)
    if (filename === 'prd.md') {
        const parentDir = path.dirname(filepath);
        const id = prdIdFromDir(parentDir);
        if (id && id.match(/^PRD-\d+$/i)) {
            return { id, type: 'prd' };
        }
    }
    return null;
}
/**
 * Check if filename matches any pattern
 */
function matchesPattern(filename, patterns) {
    if (!patterns || patterns.length === 0)
        return true;
    for (const pattern of patterns) {
        // Simple glob: *.md matches any .md file
        if (pattern.startsWith('*.')) {
            const ext = pattern.slice(1); // .md
            if (filename.endsWith(ext))
                return true;
        }
        else if (pattern === filename) {
            return true;
        }
    }
    return false;
}
/**
 * Handle file change event with debouncing
 */
function handleChange(config, eventType, filename) {
    // Skip if filename doesn't match patterns
    if (filename && !matchesPattern(filename, config.patterns)) {
        return;
    }
    const key = config.event;
    const delay = config.debounce ?? 200;
    // Clear existing timer
    const existingTimer = debounceTimers.get(key);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    // Set new debounced timer
    debounceTimers.set(key, setTimeout(() => {
        debounceTimers.delete(key);
        // Call onClear callback (e.g., clear cache)
        if (config.onClear) {
            config.onClear();
        }
        // Extract artefact info using managers
        const artefactInfo = filename ? extractArtefactInfo(filename) : null;
        // Broadcast to WebSocket clients with clean ID and type
        const connCount = getConnectionCount();
        broadcast({
            type: config.event,
            id: artefactInfo?.id || '*',
            artefactType: artefactInfo?.type,
            message: `File ${eventType}: ${artefactInfo?.id || filename || 'unknown'}`,
            timestamp: new Date().toISOString()
        });
        console.log(`[watcher] ${config.event}: ${artefactInfo?.id || filename || 'change detected'} (${artefactInfo?.type || 'unknown'}) (${connCount} clients)`);
    }, delay));
}
/**
 * Watch a single directory recursively
 */
function watchDirectory(dirPath, config) {
    try {
        const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
            handleChange(config, eventType, filename);
        });
        watcher.on('error', (err) => {
            console.error(`[watcher] Error watching ${dirPath}:`, err.message);
        });
        return watcher;
    }
    catch (err) {
        console.error(`[watcher] Cannot watch ${dirPath}:`, err.message);
        return null;
    }
}
/**
 * Start all watchers based on configs
 */
export function startWatchers() {
    const configs = getAllWatchConfigs();
    for (const config of configs) {
        for (const watchPath of config.paths) {
            // Resolve path if needed
            const resolvedPath = path.isAbsolute(watchPath) ? watchPath : path.resolve(watchPath);
            if (!fs.existsSync(resolvedPath)) {
                console.log(`[watcher] Path does not exist, skipping: ${resolvedPath}`);
                continue;
            }
            const watcher = watchDirectory(resolvedPath, config);
            if (watcher) {
                activeWatchers.push({ watcher, config });
                console.log(`[watcher] Watching: ${resolvedPath} (${config.event})`);
            }
        }
    }
    if (activeWatchers.length > 0) {
        console.log(`[watcher] ${activeWatchers.length} watcher(s) active`);
    }
}
/**
 * Stop all watchers
 */
export function stopWatchers() {
    for (const { watcher } of activeWatchers) {
        watcher.close();
    }
    activeWatchers.length = 0;
    // Clear any pending timers
    for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
    }
    debounceTimers.clear();
    console.log('[watcher] All watchers stopped');
}
/**
 * Get watcher status
 */
export function getWatcherStatus() {
    return {
        active: activeWatchers.length,
        paths: activeWatchers.map(w => w.config.paths).flat()
    };
}
