/**
 * Diagnose Manager
 * Provides config-aware factory for DiagnoseOps.
 *
 * MANAGER: Creates configured lib instances.
 */
import { getPath } from './core-manager.js';
import { DiagnoseOps } from '../lib/diagnose.js';

// Re-export types and class for direct usage
export { DiagnoseOps };
export type { NoiseFilter, LogEvent, DiagnoseResult } from '../lib/diagnose.js';

// Re-export pure functions that don't need path injection
export {
  matchesNoiseFilter,
  parseJsonLog,
  truncateError,
  printDiagnoseResult,
} from '../lib/diagnose.js';

// ============================================================================
// DiagnoseOps Factory (lazy-initialized)
// ============================================================================

let _ops: DiagnoseOps | null = null;

/**
 * Get base diagnostics directory from config
 */
function getBaseDiagnosticsDir(): string {
  return getPath('diagnostics');
}

/**
 * Get configured DiagnoseOps instance (lazy-initialized)
 * Commands should use: getDiagnoseOps().someMethod()
 */
export function getDiagnoseOps(): DiagnoseOps {
  if (!_ops) {
    _ops = new DiagnoseOps(getBaseDiagnosticsDir());
  }
  return _ops;
}

/**
 * Reset ops instance (for testing or when config changes)
 */
export function resetDiagnoseOps(): void {
  _ops = null;
}
