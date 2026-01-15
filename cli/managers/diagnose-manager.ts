/**
 * Diagnose Manager
 * Provides diagnose operations with config/path access.
 *
 * MANAGER: Orchestrates libs with config/data access.
 */
import { getPath } from './core-manager.js';
import {
  analyzeLog as analyzeLogPure,
  loadNoiseFilters as loadNoiseFiltersPure,
  saveNoiseFilters as saveNoiseFiltersPure,
  getDiagnosticsDir as getDiagnosticsDirPure,
  type NoiseFilter,
  type DiagnoseResult,
} from '../lib/diagnose.js';

// Re-export types for convenience
export type { NoiseFilter, LogEvent, DiagnoseResult } from '../lib/diagnose.js';

// Re-export pure functions that don't need path injection
export {
  matchesNoiseFilter,
  parseJsonLog,
  truncateError,
  printDiagnoseResult,
} from '../lib/diagnose.js';

/**
 * Get base diagnostics directory from config
 */
function getBaseDiagnosticsDir(): string {
  return getPath('diagnostics');
}

/**
 * Get diagnostics directory for an epic
 */
export function getDiagnosticsDir(epicId: string | null): string {
  return getDiagnosticsDirPure(getBaseDiagnosticsDir(), epicId);
}

/**
 * Load noise filters for an epic
 */
export function loadNoiseFilters(epicId: string | null): NoiseFilter[] {
  return loadNoiseFiltersPure(getBaseDiagnosticsDir(), epicId);
}

/**
 * Save noise filters for an epic
 */
export function saveNoiseFilters(epicId: string | null, filters: NoiseFilter[]): void {
  saveNoiseFiltersPure(getBaseDiagnosticsDir(), epicId, filters);
}

/**
 * Analyze log file and return errors
 */
export function analyzeLog(logFile: string, epicId: string | null, maxLineLen = 500): DiagnoseResult {
  return analyzeLogPure(logFile, getBaseDiagnosticsDir(), epicId, maxLineLen);
}
