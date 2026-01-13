/**
 * Recovery Strategies and Merge Configurations
 *
 * Defines merge strategies and error recovery actions.
 */
/**
 * Merge Strategy Matrix
 *
 * Defines behavior for each merge strategy
 */
export const mergeStrategies = {
    merge: {
        name: 'merge',
        description: 'Standard merge with merge commit',
        command: (branch) => `git merge ${branch} --no-edit`,
        onConflict: 'abort_or_resolve',
        preservesHistory: true,
        createsMergeCommit: true
    },
    squash: {
        name: 'squash',
        description: 'Squash all commits into one',
        command: (branch) => `git merge --squash ${branch}`,
        postCommand: (msg) => `git commit -m "${msg}"`,
        onConflict: 'abort_or_resolve',
        preservesHistory: false,
        createsMergeCommit: false
    },
    rebase: {
        name: 'rebase',
        description: 'Rebase and fast-forward',
        preCommand: (branch) => `git rebase ${branch}`,
        command: (branch) => `git merge ${branch} --ff-only`,
        onConflict: 'rebase_continue_or_abort',
        preservesHistory: true,
        createsMergeCommit: false
    }
};
/**
 * Error Recovery Matrix
 *
 * Maps error conditions to recovery actions
 */
export const errorRecovery = {
    worktree_exists: {
        description: 'Worktree already exists at target path',
        actions: ['removeWorktree', 'retry'],
        requiresForce: true,
        commands: {
            remove: (path) => `git worktree remove --force ${path}`,
            prune: () => 'git worktree prune'
        }
    },
    branch_exists: {
        description: 'Branch name already in use',
        actions: ['deleteBranch', 'retry'],
        requiresForce: true,
        commands: {
            delete: (branch) => `git branch -D ${branch}`
        }
    },
    merge_conflict: {
        description: 'Merge conflict detected',
        actions: ['abortMerge'],
        alternatives: ['manualResolve', 'reject'],
        commands: {
            abort: () => 'git merge --abort',
            status: () => 'git status',
            continue: () => 'git merge --continue'
        }
    },
    rebase_conflict: {
        description: 'Rebase conflict detected',
        actions: ['abortRebase'],
        alternatives: ['manualResolve', 'reject'],
        commands: {
            abort: () => 'git rebase --abort',
            continue: () => 'git rebase --continue',
            skip: () => 'git rebase --skip'
        }
    },
    dirty_worktree: {
        description: 'Worktree has uncommitted changes',
        actions: ['stashChanges', 'retry'],
        alternatives: ['commitChanges', 'discardChanges'],
        commands: {
            stash: () => 'git stash push -m "sailing: auto-stash"',
            stashPop: () => 'git stash pop',
            commit: (msg) => `git add -A && git commit -m "${msg}"`,
            discard: () => 'git checkout -- . && git clean -fd'
        }
    },
    worktree_missing: {
        description: 'Worktree not found on disk',
        actions: ['pruneWorktrees', 'updateState'],
        commands: {
            prune: () => 'git worktree prune'
        }
    },
    branch_missing: {
        description: 'Branch not found',
        actions: ['updateState'],
        message: 'Branch may have been deleted manually'
    },
    no_git: {
        description: 'Git is not installed',
        actions: ['abort'],
        message: 'Git is required for worktree operations'
    },
    not_git_repo: {
        description: 'Not a git repository',
        actions: ['abort'],
        alternatives: ['initGitRepo'],
        commands: {
            init: () => 'git init'
        }
    },
    lock_conflict: {
        description: 'Git lock file exists (concurrent operation)',
        actions: ['wait', 'retry'],
        alternatives: ['removeLock'],
        commands: {
            check: (gitDir) => `ls -la ${gitDir}/*.lock 2>/dev/null`,
            remove: (lockFile) => `rm -f ${lockFile}`
        }
    },
    detached_head: {
        description: 'Worktree is in detached HEAD state',
        actions: ['checkoutBranch'],
        commands: {
            checkout: (branch) => `git checkout ${branch}`,
            createBranch: (branch) => `git checkout -b ${branch}`
        }
    }
};
/**
 * Get recovery strategy for an error
 * @param {string} errorType - Error type key
 * @returns {object|null} Recovery configuration
 */
export function getRecoveryStrategy(errorType) {
    return errorRecovery[errorType] || null;
}
/**
 * Get merge strategy configuration
 * @param {string} strategy - Strategy name (merge, squash, rebase)
 * @returns {object|null} Strategy configuration
 */
export function getMergeStrategy(strategy) {
    return mergeStrategies[strategy] || null;
}
/**
 * List available merge strategies
 * @returns {string[]} Strategy names
 */
export function listMergeStrategies() {
    return Object.keys(mergeStrategies);
}
/**
 * List known error types
 * @returns {string[]} Error type keys
 */
export function listErrorTypes() {
    return Object.keys(errorRecovery);
}
