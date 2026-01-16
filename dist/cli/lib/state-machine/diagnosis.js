/**
 * Diagnostic Functions
 *
 * Inspect actual git/filesystem state to determine current state.
 * Cross-validate state.json vs reality.
 * TODO[P1]: Add types for worktreePath/projectRoot/context objects to drop implicit any when strict is enabled.
 * TODO[P2]: Shape Diagnosis/Issue entries as typed objects instead of loose strings.
 * TODO[P3]: Extract git/file I/O helpers to shrink the surface before TS migration.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentState, WorktreeState } from './states.js';
/**
 * Diagnose worktree state from filesystem/git
 * @param {string} worktreePath - Path to worktree
 * @param {string} projectRoot - Main project root
 * @param {string} baseBranch - Base branch name (default: 'main')
 * @returns {{ state: string, details: object }}
 */
export function diagnoseWorktreeState(worktreePath, projectRoot, baseBranch = 'main') {
    const details = {
        path: worktreePath,
        exists: false,
        isGitWorktree: false,
        branch: null,
        baseBranch,
        clean: null,
        hasCommits: null,
        ahead: 0,
        behind: 0,
        uncommittedFiles: [],
        stagedFiles: [],
        conflictFiles: [],
        mergeInProgress: false,
        rebaseInProgress: false,
        errors: []
    };
    // Check if path exists
    if (!fs.existsSync(worktreePath)) {
        return { state: WorktreeState.NONE, details };
    }
    details.exists = true;
    // Check if it's a valid git worktree
    const gitFile = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitFile)) {
        details.errors.push('No .git file found');
        return { state: WorktreeState.NONE, details };
    }
    // Read .git file to verify it's a worktree
    try {
        const gitContent = fs.readFileSync(gitFile, 'utf8');
        if (!gitContent.startsWith('gitdir:')) {
            details.errors.push('Invalid .git file (not a worktree)');
            return { state: WorktreeState.NONE, details };
        }
        details.isGitWorktree = true;
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        details.errors.push(`Cannot read .git file: ${message}`);
        return { state: WorktreeState.NONE, details };
    }
    // Get current branch
    try {
        const branchOutput = execSync('git branch --show-current', {
            cwd: worktreePath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        details.branch = branchOutput.trim();
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        details.errors.push(`Cannot get branch: ${message}`);
    }
    // Check for merge/rebase in progress
    try {
        const gitDirContent = fs.readFileSync(path.join(worktreePath, '.git'), 'utf8');
        const gitDirMatch = gitDirContent.match(/gitdir:\s*(.+)/);
        if (gitDirMatch) {
            const actualGitDir = gitDirMatch[1].trim();
            details.mergeInProgress = fs.existsSync(path.join(actualGitDir, 'MERGE_HEAD'));
            details.rebaseInProgress = fs.existsSync(path.join(actualGitDir, 'rebase-merge')) ||
                fs.existsSync(path.join(actualGitDir, 'rebase-apply'));
        }
    }
    catch {
        // Check in project root's .git
        try {
            const gitDir = path.join(projectRoot, '.git');
            details.mergeInProgress = fs.existsSync(path.join(gitDir, 'MERGE_HEAD'));
            details.rebaseInProgress = fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
                fs.existsSync(path.join(gitDir, 'rebase-apply'));
        }
        catch { /* ignore */ }
    }
    // Get status (staged, unstaged, conflicts)
    try {
        const statusOutput = execSync('git status --porcelain', {
            cwd: worktreePath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        const status = statusOutput.trim();
        if (status) {
            for (const line of status.split('\n')) {
                if (!line)
                    continue;
                const index = line[0];
                const worktree = line[1];
                const file = line.substring(3);
                // Conflict markers
                if (index === 'U' || worktree === 'U' ||
                    (index === 'A' && worktree === 'A') ||
                    (index === 'D' && worktree === 'D')) {
                    details.conflictFiles.push(file);
                }
                // Staged
                else if (index !== ' ' && index !== '?') {
                    details.stagedFiles.push(file);
                }
                // Unstaged/untracked
                if (worktree !== ' ' || index === '?') {
                    details.uncommittedFiles.push(file);
                }
            }
        }
        details.clean = details.uncommittedFiles.length === 0 &&
            details.stagedFiles.length === 0;
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        details.errors.push(`Cannot get status: ${message}`);
    }
    // Check commits ahead/behind
    try {
        const countsOutput = execSync(`git rev-list --left-right --count ${baseBranch}...HEAD`, {
            cwd: worktreePath,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        const counts = countsOutput.trim().split('\t');
        details.behind = parseInt(counts[0], 10) || 0;
        details.ahead = parseInt(counts[1], 10) || 0;
        details.hasCommits = details.ahead > 0;
    }
    catch {
        // May fail if no common ancestor
        details.hasCommits = null;
    }
    // Determine state
    let state;
    if (details.conflictFiles.length > 0) {
        state = WorktreeState.CONFLICT;
    }
    else if (details.mergeInProgress || details.rebaseInProgress) {
        state = WorktreeState.CONFLICT; // Mid-operation state
    }
    else if (!details.clean) {
        state = WorktreeState.DIRTY;
    }
    else if (details.hasCommits) {
        state = WorktreeState.COMMITTED;
    }
    else {
        state = WorktreeState.CLEAN;
    }
    return { state, details };
}
/**
 * Diagnose agent state from state.json + filesystem
 * @param {string} taskId - Task ID
 * @param {object} stateData - Loaded state.json
 * @param {object} paths - { projectRoot, worktreePath, branch, baseBranch }
 * @returns {{ agentState: string, worktreeState: string, details: object, issues: string[] }}
 */
export function diagnoseAgentState(taskId, stateData, paths) {
    const issues = [];
    const agentInfo = stateData.agents?.[taskId];
    const baseBranch = paths.baseBranch || 'main';
    // No agent in state
    if (!agentInfo) {
        // But check if worktree exists anyway (orphaned)
        const wt = diagnoseWorktreeState(paths.worktreePath, paths.projectRoot, baseBranch);
        if (wt.state !== WorktreeState.NONE) {
            issues.push(`Orphaned worktree found: ${paths.worktreePath}`);
        }
        return {
            agentState: AgentState.IDLE,
            worktreeState: wt.state,
            details: { agent: null, worktree: wt.details },
            issues
        };
    }
    // Get recorded state
    const recordedState = agentInfo.status;
    // Diagnose actual worktree state
    const wt = diagnoseWorktreeState(paths.worktreePath, paths.projectRoot, baseBranch);
    // Cross-validate state vs reality
    const details = {
        agent: agentInfo,
        worktree: wt.details,
        recordedState,
        actualWorktreeState: wt.state
    };
    // Detect inconsistencies
    if (agentInfo.worktree && wt.state === WorktreeState.NONE) {
        issues.push('State says worktree exists but not found on disk');
    }
    if (!agentInfo.worktree && wt.state !== WorktreeState.NONE) {
        issues.push('Worktree exists but not recorded in state');
    }
    if (recordedState === 'running') {
        // Check if process is actually running
        if (agentInfo.pid) {
            try {
                process.kill(agentInfo.pid, 0); // Check if process exists
            }
            catch {
                issues.push(`Process ${agentInfo.pid} not found but state is 'running'`);
            }
        }
    }
    if (recordedState === 'merging' && wt.state !== WorktreeState.CONFLICT) {
        if (!wt.details.mergeInProgress && !wt.details.rebaseInProgress) {
            issues.push('State is merging but no merge in progress');
        }
    }
    if (recordedState === 'completed' && wt.state === WorktreeState.DIRTY) {
        issues.push('Completed but worktree has uncommitted changes');
    }
    return {
        agentState: recordedState,
        worktreeState: wt.state,
        details,
        issues
    };
}
/**
 * Get recommended actions based on diagnosis
 * @param {object} diagnosis - Result from diagnoseAgentState
 * @returns {string[]} List of recommended actions
 */
export function getRecommendedActions(diagnosis) {
    const actions = [];
    const { agentState, worktreeState, issues } = diagnosis;
    // Handle issues first
    for (const issue of issues) {
        if (issue.includes('Orphaned worktree')) {
            actions.push('gc:worktrees - Prune orphaned worktree');
        }
        if (issue.includes('not found but state is')) {
            actions.push('agent:kill - Update state to reflect terminated process');
        }
        if (issue.includes('uncommitted changes')) {
            actions.push('Escalate: uncommitted changes must be resolved');
        }
        if (issue.includes('no merge in progress')) {
            actions.push('agent:show - Verify actual state');
        }
    }
    // State-specific recommendations
    switch (agentState) {
        case AgentState.COMPLETED:
            if (worktreeState === WorktreeState.COMMITTED) {
                actions.push('agent:merge - Ready to merge');
            }
            else if (worktreeState === WorktreeState.DIRTY) {
                actions.push('Commit changes then agent:merge');
            }
            else if (worktreeState === WorktreeState.CLEAN) {
                actions.push('agent:reject - No changes to merge');
            }
            break;
        case AgentState.CONFLICT:
            actions.push('Resolve conflicts manually then agent:merge --continue');
            actions.push('Or: agent:merge --abort to cancel');
            actions.push('Or: agent:reject to discard all work');
            break;
        case AgentState.FAILED:
            actions.push('agent:reject - Clean up failed agent');
            actions.push('Or: agent:merge - If partial work is salvageable');
            break;
        case AgentState.KILLED:
            actions.push('agent:reject - Clean up killed agent');
            break;
        case AgentState.RUNNING:
            if (issues.some(i => i.includes('Process') && i.includes('not found'))) {
                actions.push('agent:kill - Mark as killed and cleanup');
            }
            break;
    }
    return [...new Set(actions)]; // Dedupe
}
