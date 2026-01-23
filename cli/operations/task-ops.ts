/**
 * Task Operations - High-level operations shared by CLI and MCP
 *
 * This layer orchestrates managers for common task workflows.
 * Commands → Operations → Managers → Libs
 */
import { getTask, updateArtefact } from '../managers/artefacts/index.js';
import { appendTaskLog } from '../managers/memory-manager.js';
import { escalateOnTaskStart, cascadeTaskCompletion } from '../managers/status-manager.js';
import { normalizeId } from '../lib/normalize.js';
import type { LogLevel, TaskLogMeta } from '../managers/memory-manager.js';

// ============================================================================
// LOG
// ============================================================================

export interface LogTaskOptions {
  file?: string;
  command?: string;
}

export interface LogTaskResult {
  id: string;
  level: string;
  entry: string;
}

/**
 * Log a message for a task
 */
export function logTask(
  taskId: string,
  message: string,
  level: LogLevel = 'INFO',
  options: LogTaskOptions = {}
): LogTaskResult {
  const id = normalizeId(taskId);

  const meta: TaskLogMeta = {};
  if (options.file) meta.files = [options.file];
  if (options.command) meta.cmd = options.command;

  const entry = appendTaskLog(id, level, message, meta);

  return { id, level, entry };
}

// ============================================================================
// LIFECYCLE
// ============================================================================

export interface StartTaskOptions {
  assignee?: string;
}

export interface StartTaskResult {
  id: string;
  status: string;
  assignee: string;
  escalations: string[];
}

/**
 * Start a task (set status + assignee + escalate parent statuses)
 */
export function startTask(taskId: string, options: StartTaskOptions = {}): StartTaskResult {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const id = task.id;
  const assignee = options.assignee || 'agent';

  // Update task status and assignee
  updateArtefact(id, {
    status: 'In Progress',
    assignee
  });

  // Escalate parent epic/PRD to In Progress if needed
  const escalations: string[] = [];
  const taskData = task.data || {};
  const escalateResult = escalateOnTaskStart(taskData);

  if (escalateResult.epic?.updated) {
    escalations.push(`Epic ${escalateResult.epic.entityId} → In Progress`);
  }
  if (escalateResult.prd?.updated) {
    escalations.push(`PRD ${escalateResult.prd.entityId} → In Progress`);
  }

  return {
    id,
    status: 'In Progress',
    assignee,
    escalations
  };
}

export interface CompleteTaskOptions {
  message?: string;
}

export interface CompleteTaskResult {
  id: string;
  status: string;
  cascades: string[];
  logged: boolean;
}

/**
 * Complete a task (set Done + cascade parent statuses + optional log)
 */
export function completeTask(taskId: string, options: CompleteTaskOptions = {}): CompleteTaskResult {
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const id = task.id;

  // Update task status
  updateArtefact(id, { status: 'Done' });

  // Log completion message if provided
  let logged = false;
  if (options.message) {
    logTask(id, options.message, 'INFO');
    logged = true;
  }

  // Cascade to parent epic/PRD if all tasks done
  const cascades: string[] = [];
  const taskData = task.data || {};
  const cascadeResult = cascadeTaskCompletion(id, taskData);

  if (cascadeResult.epic?.updated) {
    cascades.push(`Epic ${cascadeResult.epic.entityId} → Done`);
  }
  if (cascadeResult.prd?.updated) {
    cascades.push(`PRD ${cascadeResult.prd.entityId} → Done`);
  }

  return {
    id,
    status: 'Done',
    cascades,
    logged
  };
}
