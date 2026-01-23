/**
 * Worktree command helpers
 *
 * Shared types and utility functions for worktree subcommands.
 */
import { findProjectRoot } from '../../managers/core-manager.js';
import { getTask } from '../../managers/artefacts-manager.js';
import { extractPrdId, extractEpicId } from '../../lib/normalize.js';
import { getGit } from '../../lib/git.js';
import {
  getBranchName,
  getMainBranch as getConfiguredMainBranch
} from '../../managers/worktree-manager.js';
import {
  getStatus as getPrStatusFromLib,
  create as createPrFromLib
} from '../../managers/pr-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface StatusOptions {
  json?: boolean;
}

export interface PreflightOptions {
  json?: boolean;
}

export interface PrOptions {
  draft?: boolean;
  json?: boolean;
}

export interface CleanupOptions {
  force?: boolean;
  json?: boolean;
}

export interface SyncOptions {
  dryRun?: boolean;
  json?: boolean;
}

export interface MergeOptions {
  strategy?: string;
  cleanup?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface PromoteOptions {
  prd?: string;
  strategy?: string;
  dryRun?: boolean;
  json?: boolean;
}

export interface ReconcileOptions {
  prd?: string;
  epic?: string;
  sync?: boolean;
  prune?: boolean;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export interface PrStatus {
  state?: string;
  mergeable?: boolean;
  url?: string;
  number?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get main branch status
 */
export async function getMainBranchStatus(projectRoot: string) {
  const git = getGit(projectRoot);
  const mainBranch = getConfiguredMainBranch();
  const gitStatus = await git.status();
  const allFiles = [...gitStatus.modified, ...gitStatus.created, ...gitStatus.deleted, ...gitStatus.not_added];
  const result = {
    branch: mainBranch,
    clean: gitStatus.isClean(),
    uncommitted: allFiles.length,
    ahead: 0,
    behind: 0,
    upToDate: true
  };

  try {
    await git.fetch();
  } catch {
    return result;
  }

  try {
    const ahead = await git.raw(['rev-list', '--count', `origin/${mainBranch}..HEAD`]);
    const behind = await git.raw(['rev-list', '--count', `HEAD..origin/${mainBranch}`]);
    result.ahead = parseInt(ahead.trim(), 10) || 0;
    result.behind = parseInt(behind.trim(), 10) || 0;
    result.upToDate = result.behind === 0;
  } catch {
    // Ignore divergence errors
  }

  return result;
}

/**
 * Get PR status for a branch (wrapper for pr.js)
 */
export async function getPrStatus(taskId: string, projectRoot: string, provider: string) {
  const branch = getBranchName(taskId);
  return getPrStatusFromLib(branch, projectRoot, provider);
}

/**
 * Create PR for a task (wrapper for pr.js)
 */
export async function createPr(taskId: string, options: PrOptions, projectRoot: string) {
  const taskInfo = getTask(taskId);
  const taskTitle = taskInfo?.data?.title;
  const epicId = taskInfo?.data?.parent ? extractEpicId(taskInfo.data.parent) : null;
  const prdId = taskInfo?.data?.parent ? extractPrdId(taskInfo.data.parent) : null;

  const title = taskTitle ? `${taskId}: ${taskTitle}` : `${taskId}: Agent work`;

  return createPrFromLib(taskId, {
    cwd: projectRoot,
    title,
    draft: options.draft,
    epicId: epicId || undefined,
    prdId: prdId || undefined
  });
}
