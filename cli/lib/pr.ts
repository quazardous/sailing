/**
 * Pull Request Operations
 *
 * GitHub and GitLab PR/MR management.
 */
import { execSync } from 'child_process';
import { findProjectRoot } from './core.js';
import { getAgentConfig } from './config.js';
import { getRemoteUrl, push } from './git.js';
import { getBranchName } from './worktree.js';

interface PrOptions {
  cwd?: string;
  title?: string;
  body?: string;
  draft?: boolean;
  epicId?: string;
  prdId?: string;
}

/**
 * Detect PR provider from git remote
 * @param {string} cwd - Working directory
 * @returns {'github'|'gitlab'|null}
 */
export function detectProvider(cwd: string) {
  const remote = getRemoteUrl('origin', cwd);
  if (!remote) return null;

  if (remote.includes('github.com') || remote.includes('github:')) {
    return 'github';
  } else if (remote.includes('gitlab.com') || remote.includes('gitlab:')) {
    return 'gitlab';
  }
  return null;
}

/**
 * Get configured or auto-detected provider
 * @param {string} cwd - Working directory
 * @returns {'github'|'gitlab'|null}
 */
export function getProvider(cwd: string) {
  const config = getAgentConfig();
  if (config.pr_provider && config.pr_provider !== 'auto') {
    return config.pr_provider;
  }
  return detectProvider(cwd);
}

/**
 * Check if PR CLI is available
 * @param {'github'|'gitlab'} provider - Provider type
 * @returns {{ available: boolean, cmd: string }}
 */
export function checkCli(provider: string) {
  const cmd = provider === 'github' ? 'gh' : 'glab';
  try {
    execSync(`${cmd} --version`, { stdio: 'pipe' });
    return { available: true, cmd };
  } catch {
    return { available: false, cmd };
  }
}

/**
 * Get PR status for a branch
 * @param {string} branch - Branch name
 * @param {string} cwd - Working directory
 * @param {'github'|'gitlab'} provider - Provider type
 * @returns {object|null} PR status or null
 */
export function getStatus(branch: string, cwd: string, provider?: string) {
  provider = provider || getProvider(cwd) || undefined;
  if (!provider) return null;

  try {
    if (provider === 'github') {
      const output = execSync(`gh pr view ${branch} --json state,url,number,mergeable`, {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return JSON.parse(output);
    } else if (provider === 'gitlab') {
      const output = execSync(`glab mr view ${branch} -F json`, {
        cwd,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return JSON.parse(output);
    }
  } catch {
    return null;
  }
}

/**
 * Check if PR exists for a branch
 * @param {string} branch - Branch name
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
export function exists(branch: string, cwd: string) {
  return getStatus(branch, cwd) !== null;
}

/**
 * Create PR for a task
 * @param {string} taskId - Task ID
 * @param {PrOptions} options - Options
 * @param {string} options.cwd - Working directory
 * @param {string} options.title - PR title
 * @param {string} options.body - PR body
 * @param {boolean} options.draft - Create as draft
 * @param {string} options.epicId - Epic ID (for body)
 * @param {string} options.prdId - PRD ID (for body)
 * @returns {{ url: string, provider: string }|{ error: string }}
 */
export function create(taskId: string, options: PrOptions = {}) {
  const cwd = options.cwd || findProjectRoot();
  const provider = getProvider(cwd);

  if (!provider) {
    return { error: 'Cannot detect PR provider. Set agent.pr_provider in config.' };
  }

  const cli = checkCli(provider);
  if (!cli.available) {
    return { error: `${cli.cmd} CLI not found. Install it to create PRs.` };
  }

  const branch = getBranchName(taskId);

  // Build title and body
  let title = options.title || `${taskId}: Agent work`;
  let body = options.body || `Task: ${taskId}`;
  if (options.epicId) body += `\nEpic: ${options.epicId}`;
  if (options.prdId) body += `\nPRD: ${options.prdId}`;

  // Push branch first
  const pushResult = push(branch, { cwd, setUpstream: true });
  if (!pushResult.success) {
    return { error: `Failed to push branch: ${pushResult.error}` };
  }

  // Create PR
  const draftFlag = options.draft ? '--draft' : '';

  try {
    if (provider === 'github') {
      const output = execSync(
        `gh pr create --head ${branch} --title "${title}" --body "${body}" ${draftFlag}`,
        { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return { url: output.trim(), provider: 'github' };
    } else if (provider === 'gitlab') {
      const output = execSync(
        `glab mr create --source-branch ${branch} --title "${title}" --description "${body}" ${draftFlag ? '--draft' : ''}`,
        { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const urlMatch = output.match(/https:\/\/[^\s]+/);
      return { url: urlMatch ? urlMatch[0] : output.trim(), provider: 'gitlab' };
    }
  } catch (e: any) {
    return { error: `Failed to create PR: ${e.message}` };
  }

  return { error: 'Unknown provider' };
}

/**
 * Check if PR is merged
 * @param {string} branch - Branch name
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
export function isMerged(branch: string, cwd: string) {
  const status = getStatus(branch, cwd);
  if (!status) return false;
  return status.state === 'MERGED' || status.state === 'merged';
}

/**
 * Get PR URL for a task (from state)
 * @param {string} taskId - Task ID
 * @param {object} state - State object with agents
 * @returns {string|null}
 */
export function getUrlFromState(taskId: string, state: any) {
  return state.agents?.[taskId]?.pr_url || null;
}
