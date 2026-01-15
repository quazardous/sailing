/**
 * Git Factory
 *
 * Pure technical wrapper for simple-git.
 * NO config access - no manager imports.
 *
 * Usage:
 *   import { getGit } from './git.js';
 *   const git = getGit(cwd); // cwd is required
 *   const status = await git.status();
 *
 * For project-aware git with auto-detection, use:
 *   import { getGit } from '../managers/worktree-manager.js';
 */
import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';

/**
 * Get configured SimpleGit instance
 * @param cwd - Working directory (required - no auto-detection)
 * @param options - Additional simple-git options
 */
export function getGit(cwd: string, options?: Partial<SimpleGitOptions>): SimpleGit {
  return simpleGit(cwd, options);
}

// Re-export simple-git types for convenience
export type { SimpleGit, StatusResult, BranchSummary, LogResult } from 'simple-git';
