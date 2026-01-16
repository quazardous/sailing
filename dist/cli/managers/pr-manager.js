/**
 * PR/MR Manager
 *
 * Business logic and I/O operations for pull request management.
 * Handles GitHub and GitLab PR/MR operations with config integration.
 * Merged from lib/git-forge.ts (technical ops) + pr-manager.ts (config logic)
 */
import { execa, execaSync } from 'execa';
import { findProjectRoot, getAgentConfig } from './core-manager.js';
import { getGit } from '../lib/git.js';
import { getBranchName } from './worktree-manager.js';
// ============================================================================
// Provider Detection
// ============================================================================
/**
 * Detect PR provider from git remote
 * @param cwd - Working directory
 * @returns 'github' | 'gitlab' | null
 */
export async function detectProvider(cwd) {
    try {
        const git = getGit(cwd);
        const remote = await git.remote(['get-url', 'origin']);
        if (!remote)
            return null;
        if (remote.includes('github.com') || remote.includes('github:')) {
            return 'github';
        }
        else if (remote.includes('gitlab.com') || remote.includes('gitlab:')) {
            return 'gitlab';
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Get configured or auto-detected provider
 */
export async function getProvider(cwd) {
    const config = getAgentConfig();
    if (config.pr_provider && config.pr_provider !== 'auto') {
        return config.pr_provider;
    }
    return detectProvider(cwd);
}
/**
 * Check if PR CLI is available
 * @param provider - Provider type
 * @returns { available: boolean, cmd: string }
 */
export function checkCli(provider) {
    const cmd = provider === 'github' ? 'gh' : 'glab';
    try {
        execaSync(cmd, ['--version']);
        return { available: true, cmd };
    }
    catch {
        return { available: false, cmd };
    }
}
// ============================================================================
// PR Status Operations
// ============================================================================
/**
 * Get PR status for a branch (core implementation)
 */
async function getStatusCore(branch, cwd, provider) {
    const resolvedProvider = provider || await detectProvider(cwd) || undefined;
    if (!resolvedProvider)
        return null;
    try {
        if (resolvedProvider === 'github') {
            const { stdout } = await execa('gh', ['pr', 'view', branch, '--json', 'state,url,number,mergeable'], { cwd });
            return JSON.parse(stdout);
        }
        else if (resolvedProvider === 'gitlab') {
            const { stdout } = await execa('glab', ['mr', 'view', branch, '-F', 'json'], { cwd });
            return JSON.parse(stdout);
        }
    }
    catch {
        return null;
    }
}
/**
 * Get PR status for a branch
 * Uses config-aware provider resolution
 */
export async function getStatus(branch, cwd, provider) {
    const resolvedProvider = provider || await getProvider(cwd) || undefined;
    return getStatusCore(branch, cwd, resolvedProvider);
}
/**
 * Check if PR exists for a branch
 */
export async function exists(branch, cwd) {
    return await getStatusCore(branch, cwd) !== null;
}
/**
 * Check if PR is merged
 */
export async function isMerged(branch, cwd) {
    const status = await getStatusCore(branch, cwd);
    if (!status)
        return false;
    return status.state === 'MERGED' || status.state === 'merged';
}
// ============================================================================
// PR Create Operations
// ============================================================================
/**
 * Create PR for a task (core implementation)
 */
async function createCore(taskId, options = {}) {
    const cwd = options.cwd || findProjectRoot();
    const provider = options.provider || await detectProvider(cwd);
    if (!provider) {
        return { error: 'Cannot detect PR provider. Set agent.pr_provider in config.' };
    }
    const cli = checkCli(provider);
    if (!cli.available) {
        return { error: `${cli.cmd} CLI not found. Install it to create PRs.` };
    }
    const branch = getBranchName(taskId);
    // Build title and body
    const title = options.title || `${taskId}: Agent work`;
    let body = options.body || `Task: ${taskId}`;
    if (options.epicId)
        body += `\nEpic: ${options.epicId}`;
    if (options.prdId)
        body += `\nPRD: ${options.prdId}`;
    // Push branch first
    const git = getGit(cwd);
    try {
        await git.push('origin', branch, ['--set-upstream']);
    }
    catch (e) {
        return { error: `Failed to push branch: ${e.message}` };
    }
    // Create PR
    try {
        if (provider === 'github') {
            const args = ['pr', 'create', '--head', branch, '--title', title, '--body', body];
            if (options.draft)
                args.push('--draft');
            const { stdout } = await execa('gh', args, { cwd });
            return { url: stdout.trim(), provider: 'github' };
        }
        else if (provider === 'gitlab') {
            const args = ['mr', 'create', '--source-branch', branch, '--title', title, '--description', body];
            if (options.draft)
                args.push('--draft');
            const { stdout } = await execa('glab', args, { cwd });
            const urlMatch = stdout.match(/https:\/\/[^\s]+/);
            return { url: urlMatch ? urlMatch[0] : stdout.trim(), provider: 'gitlab' };
        }
    }
    catch (e) {
        return { error: `Failed to create PR: ${e.message}` };
    }
    return { error: 'Unknown provider' };
}
/**
 * Create PR for a task
 * Uses config-aware provider resolution
 */
export async function create(taskId, options = {}) {
    const cwd = options.cwd || process.cwd();
    const provider = await getProvider(cwd);
    return createCore(taskId, { ...options, provider: provider || undefined });
}
// ============================================================================
// State Helpers
// ============================================================================
/**
 * Get PR URL for a task (from state)
 */
export function getUrlFromState(taskId, state) {
    return state.agents?.[taskId]?.pr_url || null;
}
