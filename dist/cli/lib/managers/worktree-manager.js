/**
 * Worktree Manager
 *
 * Business logic for git worktree operations.
 * Handles config access and orchestrates lib/worktree.ts functions.
 */
import { getGitConfig, getConfigValue } from '../../managers/core-manager.js';
import { getWorktreePath, getBranchName, getWorktreesDir, createWorktree as createWorktreeCore, removeWorktree as removeWorktreeCore, cleanupWorktree as cleanupWorktreeCore, listWorktrees, listAgentWorktrees, pruneWorktrees, getWorktreeStatus, worktreeExists, branchExists, ensureBranch, ensureBranchHierarchy as ensureBranchHierarchyCore, getParentBranch as getParentBranchCore, getBranchHierarchy as getBranchHierarchyCore, syncBranch, getBranchDivergence, syncUpwardHierarchy as syncUpwardHierarchyCore, 
// Branch name helpers (pure)
getPrdBranchName, getEpicBranchName, getMergeBranchName, getReconcileBranchName, parseMergeBranchName, isMergeBranch, isReconcileBranch } from '../worktree.js';
// Re-export pure functions
export { getWorktreePath, getBranchName, getWorktreesDir, listWorktrees, listAgentWorktrees, pruneWorktrees, getWorktreeStatus, worktreeExists, branchExists, syncBranch, getBranchDivergence, 
// Branch name helpers
getPrdBranchName, getEpicBranchName, getMergeBranchName, getReconcileBranchName, parseMergeBranchName, isMergeBranch, isReconcileBranch };
// ============================================================================
// Config Helpers
// ============================================================================
/**
 * Get configured main branch name
 */
export function getMainBranch() {
    try {
        const gitConfig = getGitConfig();
        return gitConfig?.main_branch || 'main';
    }
    catch {
        return 'main';
    }
}
// ============================================================================
// Public API (config-aware wrappers)
// ============================================================================
/**
 * Create worktree for a task
 */
export function createWorktree(taskId, options = {}) {
    return createWorktreeCore(taskId, options);
}
/**
 * Remove worktree for a task
 */
export function removeWorktree(taskId, options = {}) {
    return removeWorktreeCore(taskId, options);
}
/**
 * Full cleanup: worktree + local branch + remote branch
 */
export function cleanupWorktree(taskId, options = {}) {
    return cleanupWorktreeCore(taskId, options);
}
/**
 * Ensure a branch exists
 */
export function ensureBranchWithDefault(branchName, baseBranch) {
    return ensureBranch(branchName, baseBranch || getMainBranch());
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
    return ensureBranchHierarchyCore({ ...context, mainBranch });
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
    if (!branchExists(branch)) {
        return { success: true, skipped: `${branch} (not created yet)` };
    }
    const result = syncBranch(branch, upstream, 'merge');
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
    return syncUpwardHierarchyCore(level, { ...context, mainBranch });
}
