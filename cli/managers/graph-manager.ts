/**
 * Graph Manager
 * Provides dependency graph operations with config/data access.
 *
 * MANAGER: Orchestrates libs with config/data access.
 */
import { getAllTasks } from './artefacts-manager.js';
import {
  buildDependencyGraph as buildDependencyGraphPure,
  type TasksMap,
  type BlocksMap,
  type TaskNode,
} from '../lib/graph.js';

// Re-export types for convenience
export type { TasksMap, BlocksMap, TaskNode };

// Re-export pure graph functions that don't need data injection
export {
  detectCycles,
  findRoots,
  blockersResolved,
  longestPath,
  countTotalUnblocked,
  getAncestors,
  getDescendants,
} from '../lib/graph.js';

/**
 * Build complete dependency graph from all project tasks
 * This is the manager wrapper that fetches tasks and delegates to the pure lib
 */
export function buildDependencyGraph(): { tasks: TasksMap; blocks: BlocksMap } {
  const taskEntries = getAllTasks();
  return buildDependencyGraphPure(taskEntries);
}
