/**
 * Git Worktree Management
 *
 * Provides isolated execution environments for agents using git worktrees.
 * Each agent gets its own worktree with a dedicated branch.
 *
 * PURE LIB: No config access, no manager imports.
 * WorktreeOps class encapsulates operations needing projectRoot/worktreesDir.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ensureDir } from './fs-utils.js';
// ============================================================================
// Pure Functions (no context needed)
// ============================================================================
/**
 * Get branch name for a task
 */
export function getBranchName(taskId) {
    return `task/${taskId}`;
}
/**
 * Get branch name for a PRD
 */
export function getPrdBranchName(prdId) {
    return `prd/${prdId}`;
}
/**
 * Get branch name for an Epic
 */
export function getEpicBranchName(epicId) {
    return `epic/${epicId}`;
}
/**
 * Get branch name for a merge operation
 */
export function getMergeBranchName(sourceId, targetId) {
    return `merge/${sourceId}-to-${targetId}`;
}
/**
 * Get branch name for reconciliation (sync from parent)
 */
export function getReconcileBranchName(branchId) {
    return `reconcile/${branchId}`;
}
/**
 * Parse a merge branch name to extract source and target
 */
export function parseMergeBranchName(branchName) {
    const match = branchName.match(/^merge\/([^-]+)-to-(.+)$/);
    if (!match)
        return null;
    return { source: match[1], target: match[2] };
}
/**
 * Check if a branch is a merge branch
 */
export function isMergeBranch(branchName) {
    return branchName.startsWith('merge/');
}
/**
 * Check if a branch is a reconcile branch
 */
export function isReconcileBranch(branchName) {
    return branchName.startsWith('reconcile/');
}
/**
 * Get parent branch for a task based on branching strategy
 */
export function getParentBranch(taskId, context) {
    const { prdId, epicId, branching = 'flat', mainBranch = 'main' } = context;
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
 * Get the branch hierarchy chain for sync propagation
 * Returns array from main → ... → task parent (order: top to bottom)
 */
export function getBranchHierarchy(context) {
    const { prdId, epicId, branching = 'flat', mainBranch = 'main' } = context;
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
// ============================================================================
// WorktreeOps Class - POO Encapsulation
// ============================================================================
/**
 * Worktree operations class with injected projectRoot and worktreesDir.
 * Encapsulates all git/worktree operations that need context.
 */
export class WorktreeOps {
    projectRoot;
    worktreesDir;
    constructor(projectRoot, worktreesDir) {
        this.projectRoot = projectRoot;
        this.worktreesDir = worktreesDir;
    }
    // --------------------------------------------------------------------------
    // Path Operations
    // --------------------------------------------------------------------------
    /**
     * Get worktree path for a task
     */
    getWorktreePath(taskId) {
        return path.join(this.worktreesDir, taskId);
    }
    /**
     * Check if a worktree exists
     */
    worktreeExists(taskId) {
        const worktreePath = this.getWorktreePath(taskId);
        return fs.existsSync(worktreePath);
    }
    // --------------------------------------------------------------------------
    // Branch Operations
    // --------------------------------------------------------------------------
    /**
     * Check if a branch exists
     */
    branchExists(branchName) {
        try {
            execSync(`git rev-parse --verify "${branchName}"`, {
                cwd: this.projectRoot,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if a commit/branch is ancestor of another
     */
    isAncestor(commit, descendant) {
        try {
            execSync(`git merge-base --is-ancestor "${commit}" "${descendant}"`, {
                cwd: this.projectRoot,
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
     */
    ensureBranch(branchName, baseBranch) {
        if (this.branchExists(branchName)) {
            return { created: false, branch: branchName, existed: true };
        }
        try {
            execSync(`git branch "${branchName}" "${baseBranch}"`, {
                cwd: this.projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return { created: true, branch: branchName };
        }
        catch (e) {
            return { created: false, branch: branchName, error: e instanceof Error ? e.message : String(e) };
        }
    }
    /**
     * Ensure branch hierarchy exists for a task
     */
    ensureBranchHierarchy(context) {
        const { prdId, epicId, branching = 'flat', mainBranch = 'main' } = context;
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
            const result = this.ensureBranch(prdBranch, mainBranch);
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
            const result = this.ensureBranch(epicBranch, parentBranch);
            if (result.created)
                created.push(epicBranch);
            if (result.error)
                errors.push(`${epicBranch}: ${result.error}`);
        }
        return { branches, created, errors };
    }
    /**
     * Get branch divergence (ahead/behind counts)
     */
    getBranchDivergence(branch, upstream) {
        try {
            const output = execSync(`git rev-list --left-right --count "${upstream}...${branch}"`, { cwd: this.projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const [aheadUpstream, behindUpstream] = output.split('\t').map(n => parseInt(n, 10) || 0);
            return { behind: aheadUpstream, ahead: behindUpstream };
        }
        catch {
            return { behind: 0, ahead: 0 };
        }
    }
    /**
     * Sync (merge/rebase) a branch from its upstream
     */
    syncBranch(branch, upstream, strategy = 'merge') {
        // Check divergence first
        const div = this.getBranchDivergence(branch, upstream);
        if (div.behind === 0) {
            return { success: true, synced: false, message: 'Already up to date' };
        }
        try {
            // Checkout branch, sync, then return to previous
            const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
                cwd: this.projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
            }).trim();
            execSync(`git checkout "${branch}"`, {
                cwd: this.projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
            });
            try {
                if (strategy === 'rebase') {
                    execSync(`git rebase "${upstream}"`, {
                        cwd: this.projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
                    });
                }
                else {
                    execSync(`git merge "${upstream}" --no-edit`, {
                        cwd: this.projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
                    });
                }
                // Return to original branch
                execSync(`git checkout "${currentBranch}"`, {
                    cwd: this.projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
                });
                return { success: true, synced: true, behind: div.behind };
            }
            catch (e) {
                // Abort and return to original
                try {
                    if (strategy === 'rebase') {
                        execSync('git rebase --abort', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'pipe'] });
                    }
                    else {
                        execSync('git merge --abort', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'pipe'] });
                    }
                }
                catch { /* ignore */ }
                execSync(`git checkout "${currentBranch}"`, {
                    cwd: this.projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
                });
                return { success: false, synced: false, error: `Conflict during ${strategy}: ${e.message}` };
            }
        }
        catch (e) {
            return { success: false, synced: false, error: e instanceof Error ? e.message : String(e) };
        }
    }
    /**
     * Sync branch hierarchy upward (for epic/PRD completion)
     */
    syncUpwardHierarchy(level, context) {
        const { prdId, epicId, branching = 'flat', mainBranch = 'main' } = context;
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
            if (!this.branchExists(branch)) {
                skipped.push(`${branch} (not found)`);
                continue;
            }
            const result = this.syncBranch(branch, upstream, 'merge');
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
    // --------------------------------------------------------------------------
    // Worktree List Operations
    // --------------------------------------------------------------------------
    /**
     * List all worktrees
     */
    listWorktrees() {
        try {
            const output = execSync('git worktree list --porcelain', {
                cwd: this.projectRoot,
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
        catch {
            return [];
        }
    }
    /**
     * List agent worktrees (only those matching agent/TNNN pattern)
     */
    listAgentWorktrees() {
        return this.listWorktrees().filter(w => w.taskId);
    }
    /**
     * Prune orphaned worktrees
     */
    pruneWorktrees() {
        try {
            execSync('git worktree prune', {
                cwd: this.projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return { pruned: true };
        }
        catch {
            return { pruned: false };
        }
    }
    // --------------------------------------------------------------------------
    // Worktree Status
    // --------------------------------------------------------------------------
    /**
     * Get worktree status
     */
    getWorktreeStatus(taskId) {
        const worktreePath = this.getWorktreePath(taskId);
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
                error: e instanceof Error ? e.message : String(e)
            };
        }
    }
    // --------------------------------------------------------------------------
    // Worktree Management
    // --------------------------------------------------------------------------
    /**
     * Create a worktree for a task
     */
    createWorktree(taskId, options = {}) {
        const worktreePath = this.getWorktreePath(taskId);
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
                    cwd: this.projectRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                }).trim();
            }
            // Check if branch already exists (orphaned from previous run)
            const branchAlreadyExists = this.branchExists(branch);
            if (branchAlreadyExists) {
                // Check if the branch has commits ahead of base
                // If yes, there's work that might be lost - escalate
                try {
                    const aheadCount = execSync(`git rev-list --count "${baseBranch}..${branch}"`, { cwd: this.projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
                execSync(`git branch -D "${branch}"`, {
                    cwd: this.projectRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                // Now create fresh worktree with new branch from current baseBranch
                execSync(`git worktree add "${worktreePath}" -b "${branch}" "${baseBranch}"`, {
                    cwd: this.projectRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                return {
                    success: true,
                    path: worktreePath,
                    branch,
                    baseBranch,
                    recreated: true
                };
            }
            else {
                // Create worktree with new branch
                execSync(`git worktree add "${worktreePath}" -b "${branch}"`, {
                    cwd: this.projectRoot,
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
                error: e instanceof Error ? e.message : String(e)
            };
        }
    }
    /**
     * Remove a worktree and its branch
     */
    removeWorktree(taskId, options = {}) {
        const worktreePath = this.getWorktreePath(taskId);
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
                cwd: this.projectRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe']
            });
            // Delete branch unless keepBranch is set
            if (!options.keepBranch) {
                try {
                    const deleteFlag = options.force ? '-D' : '-d';
                    execSync(`git branch ${deleteFlag} "${branch}"`, {
                        cwd: this.projectRoot,
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
                error: e instanceof Error ? e.message : String(e)
            };
        }
    }
    /**
     * Full cleanup: remove worktree + local branch + remote branch
     */
    cleanupWorktree(taskId, options = {}) {
        const worktreePath = this.getWorktreePath(taskId);
        const branch = getBranchName(taskId);
        const removed = [];
        const errors = [];
        // Remove worktree
        if (fs.existsSync(worktreePath)) {
            const result = this.removeWorktree(taskId, { force: options.force });
            if (result.success) {
                removed.push('worktree');
            }
            else if (result.error) {
                errors.push(`worktree: ${result.error}`);
            }
        }
        // Delete local branch
        try {
            execSync(`git branch -D "${branch}"`, {
                cwd: this.projectRoot,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            removed.push('local_branch');
        }
        catch {
            // Branch may not exist - not an error
        }
        // Delete remote branch
        try {
            execSync(`git push origin --delete "${branch}"`, {
                cwd: this.projectRoot,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            removed.push('remote_branch');
        }
        catch {
            // Remote branch may not exist - not an error
        }
        return {
            success: errors.length === 0,
            removed,
            errors
        };
    }
}
