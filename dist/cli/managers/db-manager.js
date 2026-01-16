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
// ============================================================================
// DbOps Factory (lazy-initialized)
// ============================================================================
let _ops = null;
/**
 * Get database directory from config
 */
function getDbDir() {
    const custom = resolvePath('db');
    return custom || resolvePlaceholders('${haven}/db');
}
/**
 * Get configured DbOps instance (lazy-initialized)
 * Commands should use: getDbOps().someMethod()
 */
export function getDbOps() {
    if (!_ops) {
        _ops = new DbOps(getDbDir());
    }
    return _ops;
}
/**
 * Reset ops instance (for testing or when config changes)
 */
export function resetDbOps() {
    _ops = null;
}
