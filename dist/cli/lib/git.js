/**
 * Git Factory
 *
 * Minimal wrapper that provides a configured simple-git instance.
 * All git operations should use simple-git directly, not thin wrappers.
 *
 * Usage:
 *   import { getGit, getMainBranch } from './git.js';
 *   const git = getGit(cwd);
 *   const status = await git.status();
 *   const isClean = status.isClean();
 */
import { simpleGit } from 'simple-git';
import { findProjectRoot } from './core.js';
import { getGitConfig } from './config.js';
/**
 * Get configured SimpleGit instance
 * Handles SAILING_PROJECT, cwd detection, etc.
 * @param cwd - Working directory (default: project root)
 * @param options - Additional simple-git options
 */
export function getGit(cwd, options) {
    const baseDir = cwd || findProjectRoot();
    return simpleGit(baseDir, options);
}
/**
 * Get configured main branch name
 * This is business logic (reads sailing config), not a git wrapper
 * @returns Main branch name (from config or default 'main')
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
