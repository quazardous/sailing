/**
 * Git Worktree Management
 *
 * Provides isolated execution environments for agents using git worktrees.
 * Each agent gets its own worktree with a dedicated branch.
 * TODO[P1]: Type inputs/outputs (branch names, git status) to remove implicit any when strict is enabled.
 * TODO[P2]: Wrap git exec results in typed helpers for divergence/status to avoid repeated casting.
 * TODO[P3]: Split CLI-facing helpers vs low-level git operations to ease progressive TS adoption.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { findProjectRoot, getWorktreesDir as _getWorktreesDir } from './core.js';
import { ensureDir } from './paths.js';
import { getGitConfig, getConfigValue } from './config.js';
/**
 * Get configured main branch name
 * @returns {string} Main branch name (from config or default 'main')
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
// Re-export from core.js for backward compatibility
export const getWorktreesDir = _getWorktreesDir;
/**
 * Get worktree path for a task
 * @param {string} taskId - Task ID (e.g., T042)
 * @returns {string} Absolute path to worktree
 */
export function getWorktreePath(taskId) {
    return path.join(getWorktreesDir(), taskId);
}
/**
 * Get branch name for a task
 * @param {string} taskId - Task ID
 * @returns {string} Branch name (e.g., task/T042)
 */
export function getBranchName(taskId) {
    return `task/${taskId}`;
}
/**
 * Get branch name for a PRD
 * @param {string} prdId - PRD ID (e.g., PRD-001)
 * @returns {string} Branch name (e.g., prd/PRD-001)
 */
export function getPrdBranchName(prdId) {
    return `prd/${prdId}`;
}
/**
 * Get branch name for an Epic
 * @param {string} epicId - Epic ID (e.g., E001)
 * @returns {string} Branch name (e.g., epic/E001)
 */
export function getEpicBranchName(epicId) {
    return `epic/${epicId}`;
}
/**
 * Get branch name for a merge operation
 * Used when merging source into target with potential conflicts
 * @param {string} sourceId - Source entity ID (e.g., T042, E001)
 * @param {string} targetId - Target entity ID (e.g., E001, PRD-001, or 'main')
 * @returns {string} Branch name (e.g., merge/T042-to-E001)
 */
export function getMergeBranchName(sourceId, targetId) {
    return `merge/${sourceId}-to-${targetId}`;
}
/**
 * Get branch name for reconciliation (sync from parent)
 * Used when pulling changes from parent branch
 * @param {string} branchId - Entity ID being reconciled (e.g., E001, T042)
 * @returns {string} Branch name (e.g., reconcile/E001)
 */
export function getReconcileBranchName(branchId) {
    return `reconcile/${branchId}`;
}
/**
 * Parse a merge branch name to extract source and target
 * @param {string} branchName - Branch name (e.g., merge/T042-to-E001)
 * @returns {{ source: string, target: string }|null}
 */
export function parseMergeBranchName(branchName) {
    const match = branchName.match(/^merge\/([^-]+)-to-(.+)$/);
    if (!match)
        return null;
    return { source: match[1], target: match[2] };
}
/**
 * Check if a branch is a merge branch
 * @param {string} branchName - Branch name
 * @returns {boolean}
 */
export function isMergeBranch(branchName) {
    return branchName.startsWith('merge/');
}
/**
 * Check if a branch is a reconcile branch
 * @param {string} branchName - Branch name
 * @returns {boolean}
 */
export function isReconcileBranch(branchName) {
    return branchName.startsWith('reconcile/');
}
/**
 * Check if a branch exists
 * @param {string} branchName - Full branch name
 * @returns {boolean}
 */
export function branchExists(branchName) {
    const projectRoot = findProjectRoot();
    try {
        execSync(`git rev-parse --verify "${branchName}"`, {
            cwd: projectRoot,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Create a branch if it doesn't exist
 * @param {string} branchName - Branch name to create
 * @param {string} baseBranch - Base branch to create from (default: configured main branch)
 * @returns {{ created: boolean, branch: string, error?: string }}
 */
export function ensureBranch(branchName, baseBranch = null) {
    baseBranch = baseBranch || getMainBranch();
    const projectRoot = findProjectRoot();
    if (branchExists(branchName)) {
        return { created: false, branch: branchName, existed: true };
    }
    try {
        execSync(`git branch "${branchName}" "${baseBranch}"`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return { created: true, branch: branchName };
    }
    catch (e) {
        return { created: false, branch: branchName, error: e.message };
    }
}
/**
 * Get parent branch for a task based on branching strategy
 * @param {string} taskId - Task ID
 * @param {WorktreeContext} context - Context with prdId, epicId, branching strategy
 * @returns {string} Parent branch name
 */
export function getParentBranch(taskId, context = {}) {
    const { prdId, epicId, branching = 'flat' } = context;
    const mainBranch = getMainBranch();
    switch (branching) {
        case 'epic':
            if (epicId)
                return getEpicBranchName(epicId);
            if (prdId)
                return getPrdBranchName(prdId);
            return mainBranch;
        case 'prd':
            if (prdId)
                return getPrdBranchName(prdId);
            return mainBranch;
        case 'flat':
        default:
            return mainBranch;
    }
}
/**
 * Ensure branch hierarchy exists for a task
 * @param {WorktreeContext} context - { prdId, epicId, branching, mainBranch }
 * @returns {{ branches: string[], created: string[], errors: string[] }}
 */
export function ensureBranchHierarchy(context) {
    const { prdId, epicId, branching = 'flat' } = context;
    const mainBranch = context.mainBranch || getMainBranch();
    const branches = [];
    const created = [];
    const errors = [];
    if (branching === 'flat') {
        return { branches: [mainBranch], created: [], errors: [] };
    }
    // PRD branch (for 'prd' and 'epic' strategies)
    if (prdId && (branching === 'prd' || branching === 'epic')) {
        const prdBranch = getPrdBranchName(prdId);
        branches.push(prdBranch);
        const result = ensureBranch(prdBranch, mainBranch);
        if (result.created)
            created.push(prdBranch);
        if (result.error)
            errors.push(`${prdBranch}: ${result.error}`);
    }
    // Epic branch (for 'epic' strategy only)
    if (epicId && branching === 'epic') {
        const epicBranch = getEpicBranchName(epicId);
        const parentBranch = prdId ? getPrdBranchName(prdId) : mainBranch;
        branches.push(epicBranch);
        const result = ensureBranch(epicBranch, parentBranch);
        if (result.created)
            created.push(epicBranch);
        if (result.error)
            errors.push(`${epicBranch}: ${result.error}`);
    }
    return { branches, created, errors };
}
/**
 * Get the branch hierarchy chain for sync propagation
 * Returns array from main → ... → task parent (order: top to bottom)
 * @param {WorktreeContext} context - { prdId, epicId, branching }
 * @returns {string[]} Branch chain (e.g., ['main', 'prd/PRD-001', 'epic/E001'])
 */
export function getBranchHierarchy(context) {
    const { prdId, epicId, branching = 'flat' } = context;
    const mainBranch = getMainBranch();
    const chain = [mainBranch];
    if (branching === 'flat') {
        return chain;
    }
    if (prdId && (branching === 'prd' || branching === 'epic')) {
        chain.push(getPrdBranchName(prdId));
    }
    if (epicId && branching === 'epic') {
        chain.push(getEpicBranchName(epicId));
    }
    return chain;
}
/**
 * Check if a branch is behind another
 * @param {string} branch - Branch to check
 * @param {string} upstream - Upstream branch
 * @returns {{ behind: number, ahead: number }}
 */
export function getBranchDivergence(branch, upstream) {
    const projectRoot = findProjectRoot();
    try {
        const output = execSync(`git rev-list --left-right --count "${upstream}...${branch}"`, { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const [aheadUpstream, behindUpstream] = output.split('\t').map(n => parseInt(n, 10) || 0);
        return { behind: aheadUpstream, ahead: behindUpstream };
    }
    catch {
        return { behind: 0, ahead: 0 };
    }
}
/**
 * Sync (merge/rebase) a branch from its upstream
 * @param {string} branch - Branch to sync
 * @param {string} upstream - Upstream branch to sync from
 * @param {string} strategy - 'merge' or 'rebase' (default: merge)
 * @returns {{ success: boolean, synced: boolean, error?: string }}
 */
export function syncBranch(branch, upstream, strategy = 'merge') {
    const projectRoot = findProjectRoot();
    // Check divergence first
    const div = getBranchDivergence(branch, upstream);
    if (div.behind === 0) {
        return { success: true, synced: false, message: 'Already up to date' };
    }
    try {
        // Checkout branch, sync, then return to previous
        const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        execSync(`git checkout "${branch}"`, {
            cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
        });
        try {
            if (strategy === 'rebase') {
                execSync(`git rebase "${upstream}"`, {
                    cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
                });
            }
            else {
                execSync(`git merge "${upstream}" --no-edit`, {
                    cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
                });
            }
            // Return to original branch
            execSync(`git checkout "${currentBranch}"`, {
                cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
            });
            return { success: true, synced: true, behind: div.behind };
        }
        catch (e) {
            // Abort and return to original
            try {
                if (strategy === 'rebase') {
                    execSync('git rebase --abort', { cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] });
                }
                else {
                    execSync('git merge --abort', { cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] });
                }
            }
            catch { /* ignore */ }
            execSync(`git checkout "${currentBranch}"`, {
                cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
            });
            return { success: false, synced: false, error: `Conflict during ${strategy}: ${e.message}` };
        }
    }
    catch (e) {
        return { success: false, synced: false, error: e.message };
    }
}
/**
 * Sync parent branch from its upstream (one level only)
 * Called before spawning task - syncs only the immediate parent
 * @param {WorktreeContext} context - { prdId, epicId, branching }
 * @returns {{ success: boolean, synced?: string, skipped?: string, error?: string, disabled?: boolean }}
 */
export function syncParentBranch(context) {
    const syncEnabled = getConfigValue('git.sync_before_spawn');
    if (!syncEnabled) {
        return { success: true, disabled: true };
    }
    const chain = getBranchHierarchy(context);
    if (chain.length < 2) {
        // flat mode: no parent to sync
        return { success: true, skipped: 'flat mode' };
    }
    // Get the last branch in the hierarchy (task's parent) and its upstream
    const branch = chain[chain.length - 1]; // e.g., epic/E001
    const upstream = chain[chain.length - 2]; // e.g., prd/PRD-001 or main
    // Skip if branch doesn't exist yet
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
 * Called when finishing an epic or PRD - syncs upward to main
 * @param {string} level - 'epic' | 'prd' - which level completed
 * @param {WorktreeContext} context - { prdId, epicId, branching }
 * @returns {{ success: boolean, synced: string[], errors: string[], skipped: string[] }}
 */
export function syncUpwardHierarchy(level, context) {
    const { prdId, epicId, branching = 'flat' } = context;
    const mainBranch = getMainBranch();
    const synced = [];
    const errors = [];
    const skipped = [];
    if (branching === 'flat') {
        return { success: true, synced: [], errors: [], skipped: ['flat mode'] };
    }
    // Determine which syncs to perform based on completion level
    const syncPairs = [];
    if (level === 'epic' && branching === 'epic') {
        // Epic completed: sync epic → prd
        if (epicId && prdId) {
            syncPairs.push({ branch: getEpicBranchName(epicId), upstream: getPrdBranchName(prdId) });
        }
    }
    else if (level === 'prd') {
        // PRD completed: sync prd → main (and epic → prd if epic mode)
        if (branching === 'epic' && epicId && prdId) {
            syncPairs.push({ branch: getEpicBranchName(epicId), upstream: getPrdBranchName(prdId) });
        }
        if (prdId) {
            syncPairs.push({ branch: getPrdBranchName(prdId), upstream: mainBranch });
        }
    }
    for (const { branch, upstream } of syncPairs) {
        if (!branchExists(branch)) {
            skipped.push(`${branch} (not found)`);
            continue;
        }
        const result = syncBranch(branch, upstream, 'merge');
        if (!result.success) {
            errors.push(`${branch}: ${result.error}`);
        }
        else if (result.synced) {
            synced.push(`${branch} ← ${upstream} (${result.behind} commits)`);
        }
        else {
            skipped.push(`${branch} (up to date)`);
        }
    }
    return { success: errors.length === 0, synced, errors, skipped };
}
/**
 * Check if a worktree exists
 * @param {string} taskId - Task ID
 * @returns {boolean}
 */
export function worktreeExists(taskId) {
    const worktreePath = getWorktreePath(taskId);
    return fs.existsSync(worktreePath);
}
/**
 * Create a worktree for a task
 * @param {string} taskId - Task ID
 * @param {WorktreeOptions} options - Options
 * @param {string} options.baseBranch - Base branch to create from (default: current branch)
 * @returns {{ success: boolean, path: string, branch: string, error?: string }}
 */
export function createWorktree(taskId, options = {}) {
    const projectRoot = findProjectRoot();
    const worktreePath = getWorktreePath(taskId);
    const branch = getBranchName(taskId);
    // Check if worktree path already exists
    if (fs.existsSync(worktreePath)) {
        return {
            success: false,
            path: worktreePath,
            branch,
            error: `Worktree already exists: ${worktreePath}`
        };
    }
    // Ensure parent directory exists
    ensureDir(path.dirname(worktreePath));
    try {
        // Get base branch
        let baseBranch = options.baseBranch;
        if (!baseBranch) {
            baseBranch = execSync('git rev-parse --abbrev-ref HEAD', {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
        }
        // Check if branch already exists (orphaned from previous run)
        const branchAlreadyExists = branchExists(branch);
        if (branchAlreadyExists) {
            // Check if the branch has commits ahead of base
            // If yes, there's work that might be lost - escalate
            try {
                const aheadCount = execSync(`git rev-list --count "${baseBranch}..${branch}"`, { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
                if (parseInt(aheadCount, 10) > 0) {
                    return {
                        success: false,
                        path: worktreePath,
                        branch,
                        baseBranch,
                        error: `Branch '${branch}' exists with ${aheadCount} commit(s) ahead of ${baseBranch}. ` +
                            `Use 'git branch -D ${branch}' to delete it, or investigate the existing work.`
                    };
                }
            }
            catch {
                // If we can't check, assume safe to reuse
            }
            // Branch exists but no worktree, and no commits ahead → delete and recreate
            // This ensures the new worktree starts from the latest baseBranch
            // (baseBranch may have advanced since the orphaned branch was created)
            execSync(`git branch -D "${branch}"`, {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            // Now create fresh worktree with new branch from current baseBranch
            execSync(`git worktree add "${worktreePath}" -b "${branch}" "${baseBranch}"`, {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return {
                success: true,
                path: worktreePath,
                branch,
                baseBranch,
                recreated: true // Indicates orphaned branch was deleted and recreated
            };
        }
        else {
            // Create worktree with new branch
            execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
                cwd: projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return {
                success: true,
                path: worktreePath,
                branch,
                baseBranch,
                reused: false
            };
        }
    }
    catch (e) {
        return {
            success: false,
            path: worktreePath,
            branch,
            error: e.message || String(e)
        };
    }
}
/**
 * Remove a worktree and its branch
 * @param {string} taskId - Task ID
 * @param {WorktreeOptions} options - Options
 * @param {boolean} options.force - Force removal even if dirty
 * @param {boolean} options.keepBranch - Don't delete the branch
 * @returns {{ success: boolean, path: string, branch: string, error?: string }}
 */
export function removeWorktree(taskId, options = {}) {
    const projectRoot = findProjectRoot();
    const worktreePath = getWorktreePath(taskId);
    const branch = getBranchName(taskId);
    // Check if worktree exists
    if (!fs.existsSync(worktreePath)) {
        return {
            success: false,
            path: worktreePath,
            branch,
            error: `Worktree not found: ${worktreePath}`
        };
    }
    try {
        // Remove worktree
        const forceFlag = options.force ? ' --force' : '';
        execSync(`git worktree remove "${worktreePath}"${forceFlag}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        // Delete branch unless keepBranch is set
        if (!options.keepBranch) {
            try {
                const deleteFlag = options.force ? '-D' : '-d';
                execSync(`git branch ${deleteFlag} "${branch}"`, {
                    cwd: projectRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
            }
            catch {
                // Branch might not exist or have unmerged changes, ignore
            }
        }
        return {
            success: true,
            path: worktreePath,
            branch
        };
    }
    catch (e) {
        return {
            success: false,
            path: worktreePath,
            branch,
            error: e.message || String(e)
        };
    }
}
/**
 * List all worktrees
 * @returns {Array<WorktreeInfo>}
 */
export function listWorktrees() {
    const projectRoot = findProjectRoot();
    try {
        const output = execSync('git worktree list --porcelain', {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        const worktrees = [];
        let current = {};
        for (const line of output.split('\n')) {
            if (line.startsWith('worktree ')) {
                if (current.path) {
                    worktrees.push(current);
                }
                current = { path: line.substring(9) };
            }
            else if (line.startsWith('HEAD ')) {
                current.head = line.substring(5);
            }
            else if (line.startsWith('branch ')) {
                current.branch = line.substring(7);
                // Extract task ID from task/TNNN pattern
                const match = current.branch.match(/refs\/heads\/task\/(T\d+)$/);
                if (match) {
                    current.taskId = match[1];
                }
            }
            else if (line === 'detached') {
                current.detached = true;
            }
            else if (line === 'bare') {
                current.bare = true;
            }
        }
        if (current.path) {
            worktrees.push(current);
        }
        return worktrees;
    }
    catch (e) {
        return [];
    }
}
/**
 * List agent worktrees (only those matching agent/TNNN pattern)
 * @returns {Array<{ path: string, branch: string, head: string, taskId: string }>}
 */
export function listAgentWorktrees() {
    return listWorktrees().filter(w => w.taskId);
}
/**
 * Prune orphaned worktrees
 * @returns {{ pruned: number }}
 */
export function pruneWorktrees() {
    const projectRoot = findProjectRoot();
    try {
        execSync('git worktree prune', {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return { pruned: true };
    }
    catch {
        return { pruned: false };
    }
}
/**
 * Get worktree status
 * @param {string} taskId - Task ID
 * @returns {{ exists: boolean, path: string, branch: string, clean?: boolean, ahead?: number, behind?: number }}
 */
export function getWorktreeStatus(taskId) {
    const worktreePath = getWorktreePath(taskId);
    const branch = getBranchName(taskId);
    if (!fs.existsSync(worktreePath)) {
        return {
            exists: false,
            path: worktreePath,
            branch
        };
    }
    try {
        // Check if clean
        const status = execSync('git status --porcelain', {
            cwd: worktreePath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        const clean = status.trim() === '';
        // Get ahead/behind count
        let ahead = 0;
        let behind = 0;
        try {
            const counts = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
                cwd: worktreePath,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            }).trim().split('\t');
            ahead = parseInt(counts[0], 10) || 0;
            behind = parseInt(counts[1], 10) || 0;
        }
        catch {
            // No upstream tracking
        }
        return {
            exists: true,
            path: worktreePath,
            branch,
            clean,
            ahead,
            behind
        };
    }
    catch (e) {
        return {
            exists: true,
            path: worktreePath,
            branch,
            error: e.message
        };
    }
}
