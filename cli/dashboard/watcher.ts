/**
 * File Watcher for Dashboard
 *
 * Watches configured directories and broadcasts changes via WebSocket.
 * Uses fs.watch (inotify on Linux) with debouncing.
 */
import fs from 'fs';
import path from 'path';
import { getPath } from '../managers/core-manager.js';
import { broadcast, WsMessageType } from './websocket.js';
import { clearCache } from './lib/cache.js';

// =============================================================================
// Types
// =============================================================================

export interface WatchConfig {
  /** Directories to watch */
  paths: string[];
  /** File patterns to match (e.g., '*.md') - simple glob */
  patterns?: string[];
  /** WebSocket event type to broadcast */
  event: WsMessageType;
  /** Debounce delay in ms (default: 200) */
  debounce?: number;
  /** Callback when change detected (before broadcast) */
  onClear?: () => void;
}

interface ActiveWatcher {
  watcher: fs.FSWatcher;
  config: WatchConfig;
}

// =============================================================================
// Watch Configs from "managers"
// =============================================================================

/**
 * Get watch config for artefacts (PRDs, Epics, Tasks)
 */
function getArtefactsWatchConfig(): WatchConfig {
  return {
    paths: [getPath('artefacts')],
    patterns: ['*.md'],
    event: 'artefact:updated',
    debounce: 200,
    onClear: () => clearCache()
  };
}

// Future: add more watch configs here
// function getAgentsWatchConfig(): WatchConfig { ... }

/**
 * Get all watch configurations
 */
export function getAllWatchConfigs(): WatchConfig[] {
  return [
    getArtefactsWatchConfig(),
    // Add more as needed
  ];
}

// =============================================================================
// Watcher Implementation
// =============================================================================

const activeWatchers: ActiveWatcher[] = [];
const debounceTimers = new Map<string, NodeJS.Timeout>();

/**
 * Check if filename matches any pattern
 */
function matchesPattern(filename: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;

  for (const pattern of patterns) {
    // Simple glob: *.md matches any .md file
    if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1); // .md
      if (filename.endsWith(ext)) return true;
    } else if (pattern === filename) {
      return true;
    }
  }
  return false;
}

/**
 * Handle file change event with debouncing
 */
function handleChange(config: WatchConfig, eventType: string, filename: string | null): void {
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

    // Broadcast to WebSocket clients
    broadcast({
      type: config.event,
      id: filename || '*',
      message: `File ${eventType}: ${filename || 'unknown'}`,
      timestamp: new Date().toISOString()
    });

    console.log(`[watcher] ${config.event}: ${filename || 'change detected'}`);
  }, delay));
}

/**
 * Watch a single directory recursively
 */
function watchDirectory(dirPath: string, config: WatchConfig): fs.FSWatcher | null {
  try {
    const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      handleChange(config, eventType, filename);
    });

    watcher.on('error', (err) => {
      console.error(`[watcher] Error watching ${dirPath}:`, err.message);
    });

    return watcher;
  } catch (err: any) {
    console.error(`[watcher] Cannot watch ${dirPath}:`, err.message);
    return null;
  }
}

/**
 * Start all watchers based on configs
 */
export function startWatchers(): void {
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
export function stopWatchers(): void {
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
export function getWatcherStatus(): { active: number; paths: string[] } {
  return {
    active: activeWatchers.length,
    paths: activeWatchers.map(w => w.config.paths).flat()
  };
}
