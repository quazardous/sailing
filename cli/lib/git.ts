/**
 * Git Operations
 *
 * Centralized git operations for the CLI.
 * Wraps execSync with consistent error handling.
 */
import fs from 'fs';
import path from 'path';
import { execSync, StdioOptions } from 'child_process';
import { findProjectRoot } from './core.js';
import { getGitConfig } from './config.js';

interface GitOptions {
  cwd?: string;
  silent?: boolean;
  timeout?: number;
}

interface MergeOptions extends GitOptions {
  message?: string;
}

interface DeleteBranchOptions extends GitOptions {
  force?: boolean;
}

interface PushOptions extends GitOptions {
  setUpstream?: boolean;
  remote?: string;
}

interface FetchOptions extends GitOptions {
  remote?: string;
  timeout?: number;
}

/**
 * Execute git command
 * @param {string} cmd - Git command (without 'git' prefix)
 * @param {GitOptions} options - Options
 * @param {string} options.cwd - Working directory (default: project root)
 * @param {boolean} options.silent - Suppress output (default: true)
 * @returns {string} Command output
 */
export function git(cmd: string, options: GitOptions = {}) {
  const cwd = options.cwd || findProjectRoot();
  const stdio = (options.silent !== false ? ['pipe', 'pipe', 'pipe'] : 'inherit') as StdioOptions;

  return execSync(`git ${cmd}`, {
    cwd,
    encoding: 'utf8',
    stdio
  }).trim();
}

/**
 * Check if directory is a git repository
 * @param {string} cwd - Directory to check
 * @returns {boolean}
 */
export function isGitRepo(cwd: string) {
  try {
    execSync('git rev-parse --git-dir', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if repository has commits
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
export function hasCommits(cwd: string) {
  try {
    execSync('git rev-parse HEAD', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current branch name
 * @param {string} cwd - Working directory
 * @returns {string} Branch name
 */
export function getCurrentBranch(cwd?: string) {
  return git('rev-parse --abbrev-ref HEAD', { cwd });
}

/**
 * Get configured main branch name
 * @returns {string} Main branch name (from config or default 'main')
 */
export function getMainBranch() {
  try {
    const gitConfig = getGitConfig();
    return gitConfig?.main_branch || 'main';
  } catch {
    return 'main';
  }
}

/**
 * Check if branch exists
 * @param {string} branchName - Branch name
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
export function branchExists(branchName: string, cwd?: string) {
  try {
    git(`rev-parse --verify "${branchName}"`, { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create branch if it doesn't exist
 * @param {string} branchName - Branch to create
 * @param {string} baseBranch - Base branch (default: main)
 * @param {string} cwd - Working directory
 * @returns {{ created: boolean, existed: boolean, error?: string }}
 */
export function ensureBranch(branchName: string, baseBranch?: string, cwd?: string) {
  baseBranch = baseBranch || getMainBranch();

  if (branchExists(branchName, cwd)) {
    return { created: false, existed: true };
  }

  try {
    git(`branch "${branchName}" "${baseBranch}"`, { cwd });
    return { created: true, existed: false };
  } catch (e: any) {
    return { created: false, existed: false, error: e.message };
  }
}

/**
 * Checkout branch
 * @param {string} branchName - Branch to checkout
 * @param {string} cwd - Working directory
 * @returns {{ success: boolean, error?: string }}
 */
export function checkout(branchName: string, cwd?: string) {
  try {
    git(`checkout "${branchName}"`, { cwd });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Get working directory status
 * @param {string} cwd - Working directory
 * @returns {{ clean: boolean, files: string[] }}
 */
export function getStatus(cwd?: string) {
  try {
    const output = git('status --porcelain', { cwd });
    const files = output ? output.split('\n').filter(l => l.trim()) : [];
    return { clean: files.length === 0, files };
  } catch {
    return { clean: false, files: [], error: true };
  }
}

/**
 * Check if working directory is clean
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
export function isClean(cwd?: string) {
  const status = getStatus(cwd);
  // @ts-ignore
  return status.clean;
}

/**
 * Get commit count between branches
 * @param {string} from - Base branch
 * @param {string} to - Target branch
 * @param {string} cwd - Working directory
 * @returns {number}
 */
export function getCommitCount(from: string, to: string, cwd?: string) {
  try {
    const count = git(`rev-list --count ${from}..${to}`, { cwd });
    return parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Get ahead/behind count
 * @param {string} branch - Branch to check
 * @param {string} upstream - Upstream branch
 * @param {string} cwd - Working directory
 * @returns {{ ahead: number, behind: number }}
 */
export function getDivergence(branch: string, upstream: string, cwd?: string) {
  try {
    const output = git(`rev-list --left-right --count "${upstream}...${branch}"`, { cwd });
    const [behind, ahead] = output.split('\t').map(n => parseInt(n, 10) || 0);
    return { ahead, behind };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

/**
 * Merge branch
 * @param {string} branch - Branch to merge
 * @param {string} strategy - 'merge' | 'squash' | 'rebase'
 * @param {MergeOptions} options - Options
 * @param {string} options.cwd - Working directory
 * @param {string} options.message - Commit message (for squash)
 * @param {boolean} options.silent - Suppress output
 * @returns {{ success: boolean, error?: string }}
 */
export function merge(branch: string, strategy = 'merge', options: MergeOptions = {}) {
  const cwd = options.cwd || findProjectRoot();

  try {
    if (strategy === 'merge') {
      const msg = options.message || `Merge ${branch}`;
      git(`merge "${branch}" --no-edit -m "${msg}"`, { cwd, silent: options.silent });
    } else if (strategy === 'squash') {
      git(`merge --squash "${branch}"`, { cwd, silent: true });
      const msg = options.message || `Squashed merge of ${branch}`;
      git(`commit -m "${msg}"`, { cwd, silent: options.silent });
    } else if (strategy === 'rebase') {
      git(`rebase "${branch}"`, { cwd, silent: options.silent });
    }
    return { success: true };
  } catch (e: any) {
    // Try to abort on failure
    try {
      if (strategy === 'rebase') {
        git('rebase --abort', { cwd, silent: true });
      } else {
        git('merge --abort', { cwd, silent: true });
      }
    } catch { /* ignore */ }
    return { success: false, error: e.message };
  }
}

/**
 * Delete branch
 * @param {string} branchName - Branch to delete
 * @param {DeleteBranchOptions} options - Options
 * @param {string} options.cwd - Working directory
 * @param {boolean} options.force - Force delete (-D)
 * @returns {{ success: boolean, error?: string }}
 */
export function deleteBranch(branchName: string, options: DeleteBranchOptions = {}) {
  const cwd = options.cwd || findProjectRoot();
  const flag = options.force ? '-D' : '-d';

  try {
    git(`branch ${flag} "${branchName}"`, { cwd });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Push branch to remote
 * @param {string} branchName - Branch to push
 * @param {PushOptions} options - Options
 * @param {string} options.cwd - Working directory
 * @param {boolean} options.setUpstream - Set upstream (-u)
 * @param {string} options.remote - Remote name (default: origin)
 * @returns {{ success: boolean, error?: string }}
 */
export function push(branchName: string, options: PushOptions = {}) {
  const cwd = options.cwd || findProjectRoot();
  const remote = options.remote || 'origin';
  const upstreamFlag = options.setUpstream ? '-u' : '';

  try {
    git(`push ${upstreamFlag} ${remote} "${branchName}"`, { cwd });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Delete remote branch
 * @param {string} branchName - Branch to delete
 * @param {FetchOptions} options - Options
 * @returns {{ success: boolean, error?: string }}
 */
export function deleteRemoteBranch(branchName: string, options: FetchOptions = {}) {
  const cwd = options.cwd || findProjectRoot();
  const remote = options.remote || 'origin';

  try {
    git(`push ${remote} --delete "${branchName}"`, { cwd });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Fetch from remote
 * @param {FetchOptions} options - Options
 * @returns {{ success: boolean, error?: string }}
 */
export function fetch(options: FetchOptions = {}) {
  const cwd = options.cwd || findProjectRoot();
  const remote = options.remote || 'origin';

  try {
    git(`fetch ${remote} --quiet`, { cwd, timeout: 10000 });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Get remote URL
 * @param {string} remote - Remote name (default: origin)
 * @param {string} cwd - Working directory
 * @returns {string|null}
 */
export function getRemoteUrl(remote = 'origin', cwd?: string) {
  try {
    return git(`remote get-url ${remote}`, { cwd });
  } catch {
    return null;
  }
}

/**
 * Move file/directory using git mv
 * Falls back to regular move if git mv fails (untracked files)
 * @param {string} src - Source path
 * @param {string} dest - Destination path
 * @param {string} cwd - Working directory
 * @returns {{ method: 'git'|'fs', error?: string }}
 */
export function gitMv(src: string, dest: string, cwd?: string) {
  // Ensure destination parent directory exists
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  try {
    git(`mv "${src}" "${dest}"`, { cwd });
    return { method: 'git' };
  } catch {
    // Fallback to fs.rename if git mv fails (untracked file)
    try {
      fs.renameSync(src, dest);
      return { method: 'fs' };
    } catch (e: any) {
      return { method: 'fs', error: e.message };
    }
  }
}
