/**
 * Git Worktree Management
 *
 * Provides isolated execution environments for agents using git worktrees.
 * Each agent gets its own worktree with a dedicated branch.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { findProjectRoot, getWorktreesDir as _getWorktreesDir } from './core.js';
import { ensureDir } from './paths.js';

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
 * @returns {string} Branch name (e.g., agent/T042)
 */
export function getBranchName(taskId) {
  return `agent/${taskId}`;
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
 * @param {object} options - Options
 * @param {string} options.baseBranch - Base branch to create from (default: current branch)
 * @returns {{ success: boolean, path: string, branch: string, error?: string }}
 */
export function createWorktree(taskId, options = {}) {
  const projectRoot = findProjectRoot();
  const worktreePath = getWorktreePath(taskId);
  const branch = getBranchName(taskId);

  // Check if already exists
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
      baseBranch
    };
  } catch (e) {
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
 * @param {object} options - Options
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
      } catch {
        // Branch might not exist or have unmerged changes, ignore
      }
    }

    return {
      success: true,
      path: worktreePath,
      branch
    };
  } catch (e) {
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
 * @returns {Array<{ path: string, branch: string, head: string, taskId?: string }>}
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
      } else if (line.startsWith('HEAD ')) {
        current.head = line.substring(5);
      } else if (line.startsWith('branch ')) {
        current.branch = line.substring(7);
        // Extract task ID from agent/TNNN pattern
        const match = current.branch.match(/refs\/heads\/agent\/(T\d+)$/);
        if (match) {
          current.taskId = match[1];
        }
      } else if (line === 'detached') {
        current.detached = true;
      } else if (line === 'bare') {
        current.bare = true;
      }
    }

    if (current.path) {
      worktrees.push(current);
    }

    return worktrees;
  } catch (e) {
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
  } catch {
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
    } catch {
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
  } catch (e) {
    return {
      exists: true,
      path: worktreePath,
      branch,
      error: e.message
    };
  }
}
