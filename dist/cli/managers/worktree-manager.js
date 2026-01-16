/**
 * Worktree Manager
 *
 * Business logic for git worktree operations.
 * Handles config access and delegates to WorktreeOps class.
 */
import { findProjectRoot, getWorktreesDir, getConfigValue, getMainBranch } from './core-manager.js';
import { WorktreeOps, 
// Pure functions (re-exported)
getBranchName, getPrdBranchName, getEpicBranchName, getMergeBranchName, getReconcileBranchName, parseMergeBranchName, isMergeBranch, isReconcileBranch, getParentBranch as getParentBranchCore, getBranchHierarchy as getBranchHierarchyCore } from '../lib/worktree.js';
// Re-export pure functions (those that don't need config)
export { getBranchName, 
// Branch name helpers
getPrdBranchName, getEpicBranchName, getMergeBranchName, getReconcileBranchName, parseMergeBranchName, isMergeBranch, isReconcileBranch };
// Re-export getMainBranch from core-manager
export { getMainBranch } from './core-manager.js';
// ============================================================================
// WorktreeOps Instance (lazy-initialized)
// ============================================================================
let _ops = null;
function getOps() {
    if (!_ops) {
        _ops = new WorktreeOps(findProjectRoot(), getWorktreesDir());
    }
    return _ops;
}
/**
 * Reset ops instance (for testing or when config changes)
 */
export function resetWorktreeOps() {
    _ops = null;
}
// ============================================================================
// Public API (config-aware wrappers)
// ============================================================================
/**
 * Get worktree path for a task
 */
export function getWorktreePath(taskId) {
    return getOps().getWorktreePath(taskId);
}
/**
 * Check if a worktree exists
 */
export function worktreeExists(taskId) {
    return getOps().worktreeExists(taskId);
}
/**
 * Check if a branch exists
 */
export function branchExists(branchName) {
    return getOps().branchExists(branchName);
}
/**
 * Create a branch if it doesn't exist
 */
export function ensureBranch(branchName, baseBranch) {
    return getOps().ensureBranch(branchName, baseBranch || getMainBranch());
}
/**
 * Get branch divergence
 */
export function getBranchDivergence(branch, upstream) {
    return getOps().getBranchDivergence(branch, upstream);
}
/**
 * Sync a branch from its upstream
 */
export function syncBranch(branch, upstream, strategy = 'merge') {
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
export function getWorktreeStatus(taskId) {
    return getOps().getWorktreeStatus(taskId);
}
/**
 * Create worktree for a task
 */
export function createWorktree(taskId, options = {}) {
    return getOps().createWorktree(taskId, options);
}
/**
 * Remove worktree for a task
 */
export function removeWorktree(taskId, options = {}) {
    return getOps().removeWorktree(taskId, options);
}
/**
 * Full cleanup: worktree + local branch + remote branch
 */
export function cleanupWorktree(taskId, options = {}) {
    return getOps().cleanupWorktree(taskId, options);
}
/**
 * Get parent branch for a task based on branching strategy
 */
export function getParentBranch(taskId, context = {}) {
    const mainBranch = getMainBranch();
    return getParentBranchCore(taskId, { ...context, mainBranch });
}
/**
 * Ensure branch hierarchy exists for a task
 */
export function ensureBranchHierarchy(context) {
    const mainBranch = getMainBranch();
    return getOps().ensureBranchHierarchy({ ...context, mainBranch });
}
/**
 * Get the branch hierarchy chain for sync propagation
 */
export function getBranchHierarchy(context) {
    const mainBranch = getMainBranch();
    return getBranchHierarchyCore({ ...context, mainBranch });
}
/**
 * Sync parent branch from its upstream (one level only)
 * Called before spawning task
 */
export function syncParentBranch(context) {
    const syncEnabled = getConfigValue('git.sync_before_spawn');
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
export function syncUpwardHierarchy(level, context) {
    const mainBranch = getMainBranch();
    return getOps().syncUpwardHierarchy(level, { ...context, mainBranch });
}
