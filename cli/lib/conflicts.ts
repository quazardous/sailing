/**
 * Conflict Detection Module
 *
 * Detects file conflicts between agent worktrees to support parallel execution.
 */
import fs from 'fs';
import { findProjectRoot } from '../managers/core-manager.js';
import { getGit } from './git.js';
import { getWorktreePath, getBranchName } from '../managers/worktree-manager.js';
import { loadState } from '../managers/state-manager.js';

/**
 * Get modified files for an agent worktree
 * @param {string} taskId - Task ID
 * @returns {Promise<string[]>} List of modified file paths
 */
export async function getModifiedFiles(taskId: string): Promise<string[]> {
  const projectRoot = findProjectRoot();
  const branch = getBranchName(taskId);
  const worktreePath = getWorktreePath(taskId);

  if (!fs.existsSync(worktreePath)) {
    return [];
  }

  const git = getGit(projectRoot);

  try {
    // Get files modified compared to main branch
    const output = await git.raw(['diff', '--name-only', `main...${branch}`]);
    const trimmed = output.trim();
    if (!trimmed) return [];
    return trimmed.split('\n').filter(f => f.trim());
  } catch (e) {
    // Branch might not have diverged yet
    try {
      // Try getting uncommitted changes instead
      const worktreeGit = getGit(worktreePath);
      const status = await worktreeGit.status();
      return [...status.modified, ...status.created, ...status.deleted, ...status.not_added];
    } catch {
      return [];
    }
  }
}

/**
 * Detect conflicts between two task worktrees
 * @param {string} taskId1 - First task ID
 * @param {string} taskId2 - Second task ID
 * @returns {Promise<{ files: string[], count: number }>}
 */
export async function detectConflicts(taskId1: string, taskId2: string): Promise<{ files: string[], count: number }> {
  const [filesList1, filesList2] = await Promise.all([
    getModifiedFiles(taskId1),
    getModifiedFiles(taskId2)
  ]);
  const files1 = new Set(filesList1);
  const files2 = new Set(filesList2);

  const conflicts: string[] = [];
  for (const file of files1) {
    if (files2.has(file)) {
      conflicts.push(file);
    }
  }

  return {
    files: conflicts,
    count: conflicts.length
  };
}

/**
 * Build conflict matrix for all active agents
 * @returns {Promise<{ agents: string[], matrix: object, conflicts: object[], hasConflicts: boolean }>}
 */
export async function buildConflictMatrix() {
  const state = loadState();
  const agents = state.agents || {};

  // Get agents with worktrees that are dispatched or running
  const activeAgents = Object.entries(agents)
    .filter(([_, info]) => info.worktree && ['dispatched', 'running'].includes(info.status || ''))
    .map(([id]) => id);

  if (activeAgents.length < 2) {
    return {
      agents: activeAgents,
      matrix: {},
      conflicts: [],
      hasConflicts: false
    };
  }

  // Get modified files for each agent (in parallel)
  const filesByAgent: Record<string, string[]> = {};
  const fileResults = await Promise.all(
    activeAgents.map(async (taskId) => ({
      taskId,
      files: await getModifiedFiles(taskId)
    }))
  );
  for (const { taskId, files } of fileResults) {
    filesByAgent[taskId] = files;
  }

  // Build conflict matrix
  const matrix: Record<string, Record<string, number>> = {};
  const conflicts: Array<{ agents: string[], files: string[], count: number }> = [];

  for (let i = 0; i < activeAgents.length; i++) {
    const id1 = activeAgents[i];
    matrix[id1] = {};

    for (let j = i + 1; j < activeAgents.length; j++) {
      const id2 = activeAgents[j];
      const conflict = await detectConflicts(id1, id2);

      matrix[id1][id2] = conflict.count;

      if (conflict.count > 0) {
        conflicts.push({
          agents: [id1, id2],
          files: conflict.files,
          count: conflict.count
        });
      }
    }
  }

  return {
    agents: activeAgents,
    filesByAgent,
    matrix,
    conflicts,
    hasConflicts: conflicts.length > 0
  };
}

/**
 * Suggest merge order to minimize conflicts
 * @param {object} conflictData - Result from buildConflictMatrix()
 * @returns {string[]} Ordered list of task IDs
 */
export function suggestMergeOrder(conflictData) {
  const { agents, filesByAgent, conflicts } = conflictData;

  if (agents.length === 0) return [];
  if (!conflicts || conflicts.length === 0) {
    // No conflicts, any order works
    return [...agents];
  }

  // Simple heuristic: sort by number of files modified (fewer first)
  // This reduces the chance of conflicts blocking later merges
  return [...agents].sort((a, b) => {
    const filesA = filesByAgent[a]?.length || 0;
    const filesB = filesByAgent[b]?.length || 0;
    return filesA - filesB;
  });
}

/**
 * Check if a specific task can be merged without conflicts
 * @param {string} taskId - Task to check
 * @returns {Promise<{ canMerge: boolean, conflictsWith: string[] }>}
 */
export async function canMergeWithoutConflict(taskId: string): Promise<{ canMerge: boolean, conflictsWith: string[] }> {
  const state = loadState();
  const agents = state.agents || {};

  // Get other active agents
  const otherAgents = Object.entries(agents)
    .filter(([id, info]) =>
      id !== taskId &&
      info.worktree &&
      ['dispatched', 'running'].includes(info.status || '')
    )
    .map(([id]) => id);

  const conflictsWith: string[] = [];

  for (const otherId of otherAgents) {
    const conflict = await detectConflicts(taskId, otherId);
    if (conflict.count > 0) {
      conflictsWith.push(otherId);
    }
  }

  return {
    canMerge: conflictsWith.length === 0,
    conflictsWith
  };
}
