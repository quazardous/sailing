/**
 * Worktree Manager
 *
 * Business logic for git worktree operations.
 * Handles config access and delegates to WorktreeOps class.
 */
import { findProjectRoot, getWorktreesDir, getConfigValue, getMainBranch } from './core-manager.js';
import {
  WorktreeOps,
  WorktreeContext,
  // Pure functions (re-exported)
  getBranchName,
  getPrdBranchName,
  getEpicBranchName,
  getMergeBranchName,
  getReconcileBranchName,
  parseMergeBranchName,
  isMergeBranch,
  isReconcileBranch,
  getParentBranch as getParentBranchCore,
  getBranchHierarchy as getBranchHierarchyCore
} from '../lib/worktree.js';

// Re-export pure functions (those that don't need config)
export {
  getBranchName,
  // Branch name helpers
  getPrdBranchName,
  getEpicBranchName,
  getMergeBranchName,
  getReconcileBranchName,
  parseMergeBranchName,
  isMergeBranch,
  isReconcileBranch
};

// Re-export type
export type { WorktreeContext };

// Re-export getMainBranch from core-manager
export { getMainBranch } from './core-manager.js';

// ============================================================================
// WorktreeOps Instance (lazy-initialized)
// ============================================================================

let _ops: WorktreeOps | null = null;

function getOps(): WorktreeOps {
  if (!_ops) {
    _ops = new WorktreeOps(findProjectRoot(), getWorktreesDir());
  }
  return _ops;
}

/**
 * Reset ops instance (for testing or when config changes)
 */
export function resetWorktreeOps(): void {
  _ops = null;
}

// ============================================================================
// Public API (config-aware wrappers)
// ============================================================================

/**
 * Get worktree path for a task
 */
export function getWorktreePath(taskId: string) {
  return getOps().getWorktreePath(taskId);
}

/**
 * Check if a worktree exists
 */
export function worktreeExists(taskId: string) {
  return getOps().worktreeExists(taskId);
}

/**
 * Check if a branch exists
 */
export function branchExists(branchName: string) {
  return getOps().branchExists(branchName);
}

/**
 * Create a branch if it doesn't exist
 */
export function ensureBranch(branchName: string, baseBranch?: string) {
  return getOps().ensureBranch(branchName, baseBranch || getMainBranch());
}

/**
 * Get branch divergence
 */
export function getBranchDivergence(branch: string, upstream: string) {
  return getOps().getBranchDivergence(branch, upstream);
}

/**
 * Sync a branch from its upstream
 */
export function syncBranch(branch: string, upstream: string, strategy = 'merge') {
  return getOps().syncBranch(branch, upstream, strategy);
}

/**
 * List all worktrees
 */
export function listWorktrees() {
  return getOps().listWorktrees();
}

/**
 * List agent worktrees
 */
export function listAgentWorktrees() {
  return getOps().listAgentWorktrees();
}

/**
 * Prune orphaned worktrees
 */
export function pruneWorktrees() {
  return getOps().pruneWorktrees();
}

/**
 * Get worktree status
 */
export function getWorktreeStatus(taskId: string) {
  return getOps().getWorktreeStatus(taskId);
}

/**
 * Create worktree for a task
 */
export function createWorktree(taskId: string, options: { baseBranch?: string; force?: boolean } = {}) {
  return getOps().createWorktree(taskId, options);
}

/**
 * Remove worktree for a task
 */
export function removeWorktree(taskId: string, options: { force?: boolean; keepBranch?: boolean } = {}) {
  return getOps().removeWorktree(taskId, options);
}

/**
 * Full cleanup: worktree + local branch + remote branch
 */
export function cleanupWorktree(taskId: string, options: { force?: boolean } = {}) {
  return getOps().cleanupWorktree(taskId, options);
}

/**
 * Get parent branch for a task based on branching strategy
 */
export function getParentBranch(taskId: string, context: WorktreeContext = {}) {
  const mainBranch = getMainBranch();
  return getParentBranchCore(taskId, { ...context, mainBranch });
}

/**
 * Ensure branch hierarchy exists for a task
 */
export function ensureBranchHierarchy(context: WorktreeContext) {
  const mainBranch = getMainBranch();
  return getOps().ensureBranchHierarchy({ ...context, mainBranch });
}

/**
 * Get the branch hierarchy chain for sync propagation
 */
export function getBranchHierarchy(context: WorktreeContext) {
  const mainBranch = getMainBranch();
  return getBranchHierarchyCore({ ...context, mainBranch });
}

/**
 * Sync parent branch from its upstream (one level only)
 * Called before spawning task
 */
export function syncParentBranch(context: WorktreeContext) {
  const syncEnabled = getConfigValue('git.sync_before_spawn') as boolean;
  if (!syncEnabled) {
    return { success: true, disabled: true };
  }

  const mainBranch = getMainBranch();
  const chain = getBranchHierarchyCore({ ...context, mainBranch });

  if (chain.length < 2) {
    return { success: true, skipped: 'flat mode' };
  }

  const branch = chain[chain.length - 1];
  const upstream = chain[chain.length - 2];

  const ops = getOps();
  if (!ops.branchExists(branch)) {
    return { success: true, skipped: `${branch} (not created yet)` };
  }

  const result = ops.syncBranch(branch, upstream, 'merge');
  if (!result.success) {
    return { success: false, error: `${branch}: ${result.error}` };
  }

  if (result.synced) {
    return { success: true, synced: `${branch} ← ${upstream} (${result.behind} commits)` };
  }

  return { success: true, skipped: `${branch} (up to date)` };
}

/**
 * Sync branch hierarchy upward (for epic/PRD completion)
 */
export function syncUpwardHierarchy(level: string, context: WorktreeContext) {
  const mainBranch = getMainBranch();
  return getOps().syncUpwardHierarchy(level, { ...context, mainBranch });
}
