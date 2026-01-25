/**
 * Storage utilities with project-scoped keys
 */

let projectHash: string | null = null;

/**
 * Generate a simple hash from a string
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to hex and take first 8 chars
  return Math.abs(hash).toString(16).substring(0, 8);
}

/**
 * Set the current project path (call once when project is loaded)
 */
export function setProjectPath(path: string): void {
  projectHash = simpleHash(path);
  console.log(`[Storage] Project hash set: ${projectHash} (from: ${path})`);
}

/**
 * Get project hash
 */
export function getProjectHash(): string {
  return projectHash || 'default';
}

/**
 * Get a project-scoped storage key
 */
export function getStorageKey(key: string): string {
  return `sailing-${getProjectHash()}-${key}`;
}

/**
 * Load JSON from localStorage with project scope
 */
export function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const fullKey = getStorageKey(key);
    const stored = localStorage.getItem(fullKey);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error(`[Storage] Failed to load ${key}:`, e);
  }
  return defaultValue;
}

/**
 * Save JSON to localStorage with project scope
 */
export function saveToStorage<T>(key: string, value: T): void {
  try {
    const fullKey = getStorageKey(key);
    localStorage.setItem(fullKey, JSON.stringify(value));
  } catch (e) {
    console.error(`[Storage] Failed to save ${key}:`, e);
  }
}
