/**
 * Database Manager
 * Provides config-aware factory for DbOps.
 *
 * MANAGER: Creates configured lib instances.
 */
import { resolvePlaceholders, resolvePath } from './core-manager.js';
import { DbOps } from '../lib/db.js';

// Re-export types and class for direct usage
export { DbOps };
export type { DbOptions } from '../lib/db.js';

// ============================================================================
// DbOps Factory (lazy-initialized)
// ============================================================================

let _ops: DbOps | null = null;

/**
 * Get database directory from config
 */
function getDbDir(): string {
  const custom = resolvePath('db');
  return custom || resolvePlaceholders('${haven}/db');
}

/**
 * Get configured DbOps instance (lazy-initialized)
 * Commands should use: getDbOps().someMethod()
 */
export function getDbOps(): DbOps {
  if (!_ops) {
    _ops = new DbOps(getDbDir());
  }
  return _ops;
}

/**
 * Reset ops instance (for testing or when config changes)
 */
export function resetDbOps(): void {
  _ops = null;
}
