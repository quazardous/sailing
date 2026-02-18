/**
 * Dependencies Operations - High-level dependency operations shared by CLI and MCP
 */
import { buildDependencyGraph, blockersResolved, longestPath, countTotalUnblocked, detectCycles } from '../managers/graph-manager.js';
import { addTaskDependency } from '../managers/artefacts-manager.js';
import { normalizeId, buildIdResolver } from '../lib/normalize.js';
import { isStatusNotStarted, isStatusInProgress, isStatusCancelled, normalizeStatus, STATUS } from '../lib/lexicon.js';

// ============================================================================
// GET READY TASKS
// ============================================================================

export interface ReadyTasksOptions {
  prd?: string;
  epic?: string;
  tags?: string[];
  limit?: number;
  includeStarted?: boolean;
}

export interface ReadyTask {
  id: string;
  title: string;
  status: string;
  epic?: string;
  impact: number;
  criticalPath: number;
}

export interface ReadyTasksResult {
  tasks: ReadyTask[];
  total: number;
}

/**
 * Get ready tasks sorted by impact (best to work on first)
 */
export function getReadyTasks(options: ReadyTasksOptions = {}): ReadyTasksResult {
  const { tasks, blocks } = buildDependencyGraph();
  const ready: ReadyTask[] = [];

  const prdFilter = options.prd ? normalizeId(options.prd) : null;
  const epicFilter = options.epic ? normalizeId(options.epic) : null;

  for (const [id, task] of tasks) {
    // Apply filters
    if (prdFilter && !task.prd?.includes(prdFilter)) continue;
    if (epicFilter && task.epic !== epicFilter) continue;

    if (options.tags?.length) {
      const taskTags = task.tags || [];
      const allTagsMatch = options.tags.every(t => taskTags.includes(t));
      if (!allTagsMatch) continue;
    }

    // Check status
    const statusOk = isStatusNotStarted(task.status) ||
                     (options.includeStarted && isStatusInProgress(task.status));

    if (!statusOk) continue;

    // Check blockers resolved
    if (!blockersResolved(task, tasks)) continue;

    // Calculate impact metrics
    const totalUnblocked = countTotalUnblocked(id, tasks, blocks);
    const { length: criticalPathLen } = longestPath(id, tasks, blocks);

    ready.push({
      id,
      title: task.title,
      status: task.status,
      epic: task.epic,
      impact: totalUnblocked,
      criticalPath: criticalPathLen
    });
  }

  // Sort by impact (descending), then critical path (descending)
  ready.sort((a, b) => {
    if (b.impact !== a.impact) return b.impact - a.impact;
    return b.criticalPath - a.criticalPath;
  });

  const limited = options.limit ? ready.slice(0, options.limit) : ready;

  return { tasks: limited, total: ready.length };
}

// ============================================================================
// ADD DEPENDENCY
// ============================================================================

// Re-export type from manager
export type { AddDependencyResult } from '../managers/artefacts-manager.js';

/**
 * Add a dependency between tasks
 */
export function addDependency(taskId: string, blockedBy: string) {
  return addTaskDependency(taskId, blockedBy);
}

// ============================================================================
// SHOW DEPENDENCIES
// ============================================================================

export interface ShowDepsResult {
  id: string;
  blockers: string[];
  blockersResolved: boolean;
  dependents: string[];
  impact: number;
}

/**
 * Show dependencies for a task
 */
export function showDeps(taskId: string): ShowDepsResult | null {
  const { tasks, blocks } = buildDependencyGraph();
  const resolve = buildIdResolver(tasks.keys());
  const id = resolve(taskId) ?? normalizeId(taskId);
  const task = tasks.get(id);

  if (!task) {
    return null;
  }

  const blockers = task.blockedBy || [];
  const dependents = [...blocks.entries()]
    .filter(([_, blockedBy]) => blockedBy.includes(id))
    .map(([depId]) => depId);

  return {
    id,
    blockers,
    blockersResolved: blockersResolved(task, tasks),
    dependents,
    impact: dependents.length
  };
}

// ============================================================================
// VALIDATE DEPENDENCIES
// ============================================================================

export interface ValidationError {
  type: string;
  task?: string;
  epic?: string;
  blocker?: string;
  path?: string[];
  message: string;
}

export interface ValidateDepsOptions {
  prd?: string;
}

export interface ValidateDepsResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  tasksChecked: number;
  fixable: number;
}

/**
 * Validate dependencies for issues (cycles, missing refs, status inconsistencies)
 */
export function validateDeps(options: ValidateDepsOptions = {}): ValidateDepsResult {
  const { tasks, blocks } = buildDependencyGraph();
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  let fixable = 0;

  const prdFilter = options.prd ? normalizeId(options.prd) : null;

  for (const [id, task] of tasks) {
    if (prdFilter && !task.prd?.includes(prdFilter)) continue;

    // 1. Missing refs
    for (const blockerId of task.blockedBy) {
      if (!tasks.has(blockerId)) {
        errors.push({
          type: 'missing_ref',
          task: id,
          blocker: blockerId,
          message: `${id}: blocked_by references non-existent task ${blockerId}`
        });
        fixable++;
      }
    }

    // 2. Self-references
    if (task.blockedBy.includes(id)) {
      errors.push({
        type: 'self_ref',
        task: id,
        message: `${id}: blocked_by contains self-reference`
      });
      fixable++;
    }

    // 3. Duplicates
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const blockerId of task.blockedBy) {
      if (seen.has(blockerId)) duplicates.push(blockerId);
      seen.add(blockerId);
    }
    if (duplicates.length > 0) {
      warnings.push({
        type: 'duplicate',
        task: id,
        message: `${id}: blocked_by contains duplicates: ${duplicates.join(', ')}`
      });
      fixable++;
    }

    // 4. Cancelled blockers
    for (const blockerId of task.blockedBy) {
      const blocker = tasks.get(blockerId);
      if (blocker && isStatusCancelled(blocker.status)) {
        warnings.push({
          type: 'cancelled_blocker',
          task: id,
          blocker: blockerId,
          message: `${id}: blocked by cancelled task ${blockerId}`
        });
        fixable++;
      }
    }

    // 5. Invalid status
    const canonical = normalizeStatus(task.status, 'task');
    if (!canonical) {
      errors.push({
        type: 'invalid_status',
        task: id,
        message: `${id}: Invalid status "${task.status}". Valid: ${STATUS.task.join(', ')}`
      });
    } else if (canonical !== task.status) {
      warnings.push({
        type: 'status_format',
        task: id,
        message: `${id}: Status "${task.status}" should be "${canonical}"`
      });
      fixable++;
    }

    // 6. Task without epic parent
    if (!task.epic && !task.parent?.match(/E\d+/i)) {
      errors.push({
        type: 'missing_epic',
        task: id,
        message: `${id}: Task has no epic parent (parent: ${task.parent || 'none'})`
      });
    }
  }

  // 7. Cycles
  const cycles = detectCycles(tasks);
  for (const cycle of cycles) {
    errors.push({
      type: 'cycle',
      path: cycle,
      message: `Task cycle detected: ${cycle.join(' → ')}`
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    tasksChecked: tasks.size,
    fixable
  };
}
