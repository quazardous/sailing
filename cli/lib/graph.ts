/**
 * Dependency graph utilities
 * Build, analyze, and traverse task dependency graphs
 *
 * PURE LIB: No config access, no manager imports.
 * All data must be passed as parameters.
 */
import path from 'path';
import { extractEpicId, buildIdResolver } from './normalize.js';
import { isStatusDone, isStatusCancelled } from './lexicon.js';
import type { TaskIndexEntry } from './types/entities.js';

export type TaskNode = {
  id: string;
  title: string;
  status: string;
  assignee: string;
  effort: string;
  priority: string;
  tags: unknown[];
  blockedBy: string[];
  blockedByRaw: unknown[];
  file: string;
  prd: string;
  parent: string;
  epic?: string;
  started_at?: unknown;
  done_at?: unknown;
  blocked_at?: unknown;
};

export type TasksMap = Map<string, TaskNode>;
export type BlocksMap = Map<string, string[]>;

interface TaskFrontmatter {
  id?: string;
  title?: string;
  status?: string;
  assignee?: string;
  effort?: string;
  priority?: string;
  tags?: unknown[];
  blocked_by?: string[];
  parent?: string;
  started_at?: unknown;
  done_at?: unknown;
  blocked_at?: unknown;
}

/**
 * Build complete dependency graph from task entries
 * @param taskEntries - Array of task index entries (from getAllTasks())
 * @returns {{ tasks: Map, blocks: Map }}
 */
export function buildDependencyGraph(taskEntries: TaskIndexEntry[]): { tasks: TasksMap; blocks: BlocksMap } {
  const tasks: TasksMap = new Map(); // id -> { id, title, status, assignee, blockedBy: [], file, prd, parent }
  const blocks: BlocksMap = new Map(); // id -> [ids that this task blocks]

  // Resolve any blocked_by ID format to the canonical entry ID
  const resolveId = buildIdResolver(taskEntries.map(e => e.id));

  for (const taskEntry of taskEntries) {
    const id = taskEntry.id;
    const data = taskEntry.data as TaskFrontmatter | undefined;

    // Extract PRD name from file path (e.g., /path/PRD-001-name/tasks/T001.md)
    const tasksDir = path.dirname(taskEntry.file);
    const prdDir = path.dirname(tasksDir);
    const prdName = path.basename(prdDir);

    const blockedByRaw = data?.blocked_by || [];
    const blockedBy = blockedByRaw.map(b => resolveId(String(b))).filter((b): b is string => b !== null);

    tasks.set(id, {
      id,
      title: data?.title || '',
      status: data?.status || 'Unknown',
      assignee: data?.assignee || 'unassigned',
      effort: data?.effort || '',
      priority: data?.priority || 'normal',
      tags: data?.tags || [],
      blockedBy,
      blockedByRaw,
      file: taskEntry.file,
      prd: prdName,
      parent: data?.parent || '',
      epic: extractEpicId(data?.parent || '') || undefined,
      started_at: data?.started_at,
      done_at: data?.done_at,
      blocked_at: data?.blocked_at
    });
  }

  // Build reverse map (who does each task block?)
  for (const [id, task] of tasks) {
    for (const blockerId of task.blockedBy) {
      if (!blocks.has(blockerId)) blocks.set(blockerId, []);
      blocks.get(blockerId)?.push(id);
    }
  }

  return { tasks, blocks };
}

/**
 * Detect cycles using DFS
 */
export function detectCycles(tasks: TasksMap): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string, pathAcc: string[]) {
    if (inStack.has(nodeId)) {
      // Found cycle - extract it
      const cycleStart = pathAcc.indexOf(nodeId);
      const cycle = pathAcc.slice(cycleStart);
      cycle.push(nodeId);
      cycles.push(cycle);
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    inStack.add(nodeId);
    pathAcc.push(nodeId);

    const task = tasks.get(nodeId);
    if (task) {
      for (const dep of task.blockedBy) {
        dfs(dep, [...pathAcc]);
      }
    }

    inStack.delete(nodeId);
  }

  for (const id of tasks.keys()) {
    if (!visited.has(id)) {
      dfs(id, []);
    }
  }

  return cycles;
}

/**
 * Find root tasks (no blockers)
 */
export function findRoots(tasks: TasksMap): string[] {
  const roots: string[] = [];
  for (const [id, task] of tasks) {
    if (task.blockedBy.length === 0) {
      roots.push(id);
    }
  }
  return roots.sort();
}

/**
 * Check if all blockers are done
 */
export function blockersResolved(task: TaskNode, tasks: TasksMap): boolean {
  for (const blockerId of task.blockedBy) {
    const blocker = tasks.get(blockerId);
    if (!blocker) continue; // Missing blocker - treat as resolved
    if (!isStatusDone(blocker.status) && !isStatusCancelled(blocker.status)) return false;
  }
  return true;
}

/**
 * Calculate longest path from a task (critical path length)
 */
export function longestPath(
  taskId: string,
  tasks: TasksMap,
  blocks: BlocksMap,
  memo: Map<string, { length: number; path: string[] }> = new Map()
): { length: number; path: string[] } {
  if (memo.has(taskId)) return memo.get(taskId);

  const dependents = blocks.get(taskId) || [];
  if (dependents.length === 0) {
    memo.set(taskId, { length: 1, path: [taskId] });
    return memo.get(taskId);
  }

  let maxLen = 0;
  let maxPath: string[] = [];
  for (const depId of dependents) {
    const sub = longestPath(depId, tasks, blocks, memo);
    if (sub.length > maxLen) {
      maxLen = sub.length;
      maxPath = sub.path;
    }
  }

  const result: { length: number; path: string[] } = { length: maxLen + 1, path: [taskId, ...maxPath] };
  memo.set(taskId, result);
  return result;
}

/**
 * Count total tasks unblocked (recursively) if a task is completed
 */
export function countTotalUnblocked(taskId: string, tasks: TasksMap, blocks: BlocksMap, visited: Set<string> = new Set()): number {
  if (visited.has(taskId)) return 0;
  visited.add(taskId);

  const dependents = blocks.get(taskId) || [];
  let count = 0;

  for (const depId of dependents) {
    const depTask = tasks.get(depId);
    if (!depTask) continue;

    // Check if this task would become ready (all other blockers done)
    const otherBlockers = depTask.blockedBy.filter(b => b !== taskId);
    const othersDone = otherBlockers.every(b => {
      const blocker = tasks.get(b);
      return !blocker || isStatusDone(blocker.status) || isStatusCancelled(blocker.status);
    });

    if (othersDone) {
      count++;
      count += countTotalUnblocked(depId, tasks, blocks, visited);
    }
  }

  return count;
}

/**
 * Get ancestors (tasks this task depends on)
 */
export function getAncestors(taskId: string, tasks: TasksMap, maxDepth: number = Infinity): Set<string> {
  const ancestors = new Set<string>();

  function walk(id: string, depth: number) {
    if (depth > maxDepth) return;
    const task = tasks.get(id);
    if (!task) return;

    for (const blockerId of task.blockedBy) {
      if (!ancestors.has(blockerId)) {
        ancestors.add(blockerId);
        walk(blockerId, depth + 1);
      }
    }
  }

  walk(taskId, 1);
  return ancestors;
}

/**
 * Get descendants (tasks that depend on this task)
 */
export function getDescendants(taskId: string, blocks: BlocksMap, maxDepth: number = Infinity): Set<string> {
  const descendants = new Set<string>();

  function walk(id: string, depth: number) {
    if (depth > maxDepth) return;
    const deps = blocks.get(id) || [];

    for (const depId of deps) {
      if (!descendants.has(depId)) {
        descendants.add(depId);
        walk(depId, depth + 1);
      }
    }
  }

  walk(taskId, 1);
  return descendants;
}
