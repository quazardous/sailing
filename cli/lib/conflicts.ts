/**
 * Conflict Detection Module
 *
 * Detects file conflicts between agent worktrees to support parallel execution.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import { findProjectRoot } from './core.js';
import { getWorktreePath, getBranchName, listAgentWorktrees } from './worktree.js';
import { loadState } from './state.js';
import { AgentInfo } from './types/agent.js';

/**
 * Get modified files for an agent worktree
 * @param {string} taskId - Task ID
 * @returns {string[]} List of modified file paths
 */
export function getModifiedFiles(taskId) {
  const projectRoot = findProjectRoot();
  const branch = getBranchName(taskId);
  const worktreePath = getWorktreePath(taskId);

  if (!fs.existsSync(worktreePath)) {
    return [];
  }

  try {
    // Get files modified compared to main branch
    const output = execSync(`git diff --name-only main...${branch}`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (!output) return [];
    return output.split('\n').filter(f => f.trim());
  } catch (e) {
    // Branch might not have diverged yet
    try {
      // Try getting uncommitted changes instead
      const output = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      if (!output) return [];
      return output.split('\n')
        .filter(line => line.trim())
        .map(line => line.substring(3));
    } catch {
      return [];
    }
  }
}

/**
 * Detect conflicts between two task worktrees
 * @param {string} taskId1 - First task ID
 * @param {string} taskId2 - Second task ID
 * @returns {{ files: string[], count: number }}
 */
export function detectConflicts(taskId1, taskId2) {
  const files1 = new Set(getModifiedFiles(taskId1));
  const files2 = new Set(getModifiedFiles(taskId2));

  const conflicts = [];
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
 * @returns {{ agents: string[], matrix: object, conflicts: object[] }}
 */
export function buildConflictMatrix() {
  const state = loadState();
  const agents = state.agents || {};

  // Get agents with worktrees that are dispatched or running
  const activeAgents = Object.entries(agents)
    .filter(([_, info]) => (info as AgentInfo).worktree && ['dispatched', 'running'].includes((info as AgentInfo).status || ''))
    .map(([id]) => id);

  if (activeAgents.length < 2) {
    return {
      agents: activeAgents,
      matrix: {},
      conflicts: [],
      hasConflicts: false
    };
  }

  // Get modified files for each agent
  const filesByAgent = {};
  for (const taskId of activeAgents) {
    filesByAgent[taskId] = getModifiedFiles(taskId);
  }

  // Build conflict matrix
  const matrix = {};
  const conflicts = [];

  for (let i = 0; i < activeAgents.length; i++) {
    const id1 = activeAgents[i];
    matrix[id1] = {};

    for (let j = i + 1; j < activeAgents.length; j++) {
      const id2 = activeAgents[j];
      const conflict = detectConflicts(id1, id2);

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
 * @returns {{ canMerge: boolean, conflictsWith: string[] }}
 */
export function canMergeWithoutConflict(taskId) {
  const state = loadState();
  const agents = state.agents || {};

  // Get other active agents
  const otherAgents = Object.entries(agents)
    .filter(([id, info]) =>
      id !== taskId &&
      (info as AgentInfo).worktree &&
      ['dispatched', 'running'].includes((info as AgentInfo).status || '')
    )
    .map(([id]) => id);

  const conflictsWith = [];

  for (const otherId of otherAgents) {
    const conflict = detectConflicts(taskId, otherId);
    if (conflict.count > 0) {
      conflictsWith.push(otherId);
    }
  }

  return {
    canMerge: conflictsWith.length === 0,
    conflictsWith
  };
}
