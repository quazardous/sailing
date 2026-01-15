/**
 * Worktree Manager
 *
 * Business logic for git worktree operations.
 * Handles config access and orchestrates lib/worktree.ts functions.
 */
import { findProjectRoot, getWorktreesDir, getConfigValue, getMainBranch } from './core-manager.js';
import {
  getWorktreePath as getWorktreePathCore,
  getBranchName,
  createWorktree as createWorktreeCore,
  removeWorktree as removeWorktreeCore,
  cleanupWorktree as cleanupWorktreeCore,
  listWorktrees as listWorktreesCore,
  listAgentWorktrees as listAgentWorktreesCore,
  pruneWorktrees as pruneWorktreesCore,
  getWorktreeStatus as getWorktreeStatusCore,
  worktreeExists as worktreeExistsCore,
  branchExists as branchExistsCore,
  ensureBranch as ensureBranchCore,
  ensureBranchHierarchy as ensureBranchHierarchyCore,
  getParentBranch as getParentBranchCore,
  getBranchHierarchy as getBranchHierarchyCore,
  syncBranch as syncBranchCore,
  getBranchDivergence as getBranchDivergenceCore,
  syncUpwardHierarchy as syncUpwardHierarchyCore,
  // Branch name helpers (pure)
  getPrdBranchName,
  getEpicBranchName,
  getMergeBranchName,
  getReconcileBranchName,
  parseMergeBranchName,
  isMergeBranch,
  isReconcileBranch,
  WorktreeContext
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
// Public API (config-aware wrappers)
// ============================================================================

/**
 * Get worktree path for a task
 */
export function getWorktreePath(taskId: string) {
  return getWorktreePathCore(getWorktreesDir(), taskId);
}

/**
 * Check if a worktree exists
 */
export function worktreeExists(taskId: string) {
  return worktreeExistsCore(getWorktreesDir(), taskId);
}

/**
 * Check if a branch exists
 */
export function branchExists(branchName: string) {
  return branchExistsCore(findProjectRoot(), branchName);
}

/**
 * Create a branch if it doesn't exist
 */
export function ensureBranch(branchName: string, baseBranch?: string) {
  return ensureBranchCore(findProjectRoot(), branchName, baseBranch || getMainBranch());
}

/**
 * Get branch divergence
 */
export function getBranchDivergence(branch: string, upstream: string) {
  return getBranchDivergenceCore(findProjectRoot(), branch, upstream);
}

/**
 * Sync a branch from its upstream
 */
export function syncBranch(branch: string, upstream: string, strategy = 'merge') {
  return syncBranchCore(findProjectRoot(), branch, upstream, strategy);
}

/**
 * List all worktrees
 */
export function listWorktrees() {
  return listWorktreesCore(findProjectRoot());
}

/**
 * List agent worktrees
 */
export function listAgentWorktrees() {
  return listAgentWorktreesCore(findProjectRoot());
}

/**
 * Prune orphaned worktrees
 */
export function pruneWorktrees() {
  return pruneWorktreesCore(findProjectRoot());
}

/**
 * Get worktree status
 */
export function getWorktreeStatus(taskId: string) {
  return getWorktreeStatusCore(getWorktreesDir(), taskId);
}

/**
 * Create worktree for a task
 */
export function createWorktree(taskId: string, options: { baseBranch?: string; force?: boolean } = {}) {
  return createWorktreeCore(findProjectRoot(), getWorktreesDir(), taskId, options);
}

/**
 * Remove worktree for a task
 */
export function removeWorktree(taskId: string, options: { force?: boolean; keepBranch?: boolean } = {}) {
  return removeWorktreeCore(findProjectRoot(), getWorktreesDir(), taskId, options);
}

/**
 * Full cleanup: worktree + local branch + remote branch
 */
export function cleanupWorktree(taskId: string, options: { force?: boolean } = {}) {
  return cleanupWorktreeCore(findProjectRoot(), getWorktreesDir(), taskId, options);
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
  const projectRoot = findProjectRoot();
  const mainBranch = getMainBranch();
  return ensureBranchHierarchyCore(projectRoot, { ...context, mainBranch });
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
  const syncEnabled = getConfigValue('git.sync_before_spawn');
  if (!syncEnabled) {
    return { success: true, disabled: true };
  }

  const projectRoot = findProjectRoot();
  const mainBranch = getMainBranch();
  const chain = getBranchHierarchyCore({ ...context, mainBranch });

  if (chain.length < 2) {
    return { success: true, skipped: 'flat mode' };
  }

  const branch = chain[chain.length - 1];
  const upstream = chain[chain.length - 2];

  if (!branchExistsCore(projectRoot, branch)) {
    return { success: true, skipped: `${branch} (not created yet)` };
  }

  const result = syncBranchCore(projectRoot, branch, upstream, 'merge');
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
  const projectRoot = findProjectRoot();
  const mainBranch = getMainBranch();
  return syncUpwardHierarchyCore(projectRoot, level, { ...context, mainBranch });
}
