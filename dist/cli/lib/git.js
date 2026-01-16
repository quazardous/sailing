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
import { simpleGit } from 'simple-git';
/**
 * Get configured SimpleGit instance
 * @param cwd - Working directory (required - no auto-detection)
 * @param options - Additional simple-git options
 */
export function getGit(cwd, options) {
    return simpleGit(cwd, options);
}
