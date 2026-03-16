/**
 * MCP Conductor Tools - Workflow operations
 */
import { getTask } from '../../artefacts-manager.js';
import { getStore } from '../../artefacts-manager.js';
import {
  getReadyTasks,
  validateDeps,
  startTask,
  completeTask
} from '../../../operations/index.js';
import {
  ok,
  err,
  detectType,
  canonicalId
} from '../types.js';
import { normalizeId } from '../../../lib/normalize.js';
import { getAgentConfig } from '../../config-manager.js';
import { isStatusBreakdown, isStatusInProgress, isStatusDone, isStatusAutoDone } from '../../../lib/lexicon.js';
import type { ToolDefinition, NextAction } from '../types.js';

const MIN_TASKS_PER_EPIC = 3;

interface EpicWarning {
  epicId: string;
  type: 'not_breakdown' | 'too_few_tasks' | 'no_tasks';
  message: string;
  suggestion?: string;
}

/**
 * Check epic health within a scope (PRD or single epic)
 * Returns warnings for epics that aren't ready for execution
 */
function getEpicHealthWarnings(scope?: { prd?: string; epic?: string }): EpicWarning[] {
  const warnings: EpicWarning[] = [];
  const store = getStore();

  let epics: Array<{ id: string; data?: Record<string, unknown> }>;

  if (scope?.epic) {
    const epic = store.getEpic(scope.epic);
    epics = epic ? [epic] : [];
  } else if (scope?.prd) {
    const prdMatch = /PRD-0*(\d+)/i.exec(scope.prd);
    epics = prdMatch ? store.getEpicsForPrd(parseInt(prdMatch[1], 10)) : [];
  } else {
    epics = store.getAllEpics();
  }

  for (const epic of epics) {
    const status = epic.data?.status as string | undefined;

    // Skip done/auto-done epics
    if (isStatusDone(status) || isStatusAutoDone(status)) continue;

    const tasks = store.getTasksForEpic(epic.id);
    const cid = canonicalId(epic.id);

    if (tasks.length === 0) {
      // Epic not yet in Breakdown is expected to have no tasks
      if (isStatusBreakdown(status) || isStatusInProgress(status)) {
        warnings.push({
          epicId: cid,
          type: 'no_tasks',
          message: `${cid} is "${status}" but has 0 tasks`,
          suggestion: `/dev:epic-breakdown ${cid}`
        });
      } else {
        warnings.push({
          epicId: cid,
          type: 'not_breakdown',
          message: `${cid} is "${status}" — needs review + breakdown before execution`,
          suggestion: `/dev:epic-review ${cid}`
        });
      }
    } else if (tasks.length < MIN_TASKS_PER_EPIC) {
      warnings.push({
        epicId: cid,
        type: 'too_few_tasks',
        message: `${cid} has only ${tasks.length} task(s) (minimum ${MIN_TASKS_PER_EPIC})`,
        suggestion: `Review breakdown for ${cid} — may need more granularity`
      });
    }
  }

  return warnings;
}

export const WORKFLOW_TOOLS: ToolDefinition[] = [
  {
    tool: {
      name: 'workflow_ready',
      description: 'Get ready tasks (unblocked, not started) with impact scores',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter by PRD-001 or E001' },
          limit: { type: 'number', description: 'Max results (default: 6)' },
          include_started: { type: 'boolean', description: 'Include In Progress tasks for resume' }
        }
      }
    },
    handler: (args) => {
      const type = args.scope ? detectType(args.scope as string) : null;

      const result = getReadyTasks({
        prd: type === 'prd' ? args.scope as string : undefined,
        epic: type === 'epic' ? args.scope as string : undefined,
        limit: (args.limit as number) || 6,
        includeStarted: args.include_started as boolean | undefined
      });

      const nextActions: NextAction[] = [];

      // Check epic health warnings
      const epicWarnings = getEpicHealthWarnings({
        prd: type === 'prd' ? args.scope as string : undefined,
        epic: type === 'epic' ? args.scope as string : undefined
      });

      if (result.tasks.length > 0) {
        nextActions.push({
          tool: 'workflow_start',
          args: { task_id: result.tasks[0].id },
          reason: `Start highest impact task`,
          priority: 'high'
        });
      }
      if (result.tasks.length === 0) {
        nextActions.push({
          tool: 'memory_status',
          args: {},
          reason: 'No ready tasks - check if logs need consolidation',
          priority: 'normal'
        });
      }

      return ok({
        success: true,
        data: {
          tasks: result.tasks.map(t => ({ ...t, id: canonicalId(t.id) })),
          total: result.total,
          ...(epicWarnings.length > 0 ? { warnings: epicWarnings } : {})
        },
        next_actions: nextActions
      });
    }
  },
  {
    tool: {
      name: 'workflow_validate',
      description: 'Validate dependencies and report issues',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter by PRD' }
        }
      }
    },
    handler: (args) => {
      const result = validateDeps({
        prd: args.scope as string | undefined
      });

      // Check epic health warnings
      const epicWarnings = getEpicHealthWarnings({
        prd: args.scope as string | undefined
      });

      const nextActions: NextAction[] = [];

      if (result.valid) {
        nextActions.push({
          tool: 'workflow_ready',
          args: { scope: args.scope },
          reason: 'Find tasks ready to start after validation',
          priority: 'normal'
        });
      }

      return ok({
        success: true,
        data: {
          ...result,
          ...(epicWarnings.length > 0 ? { epicWarnings } : {})
        },
        next_actions: nextActions
      });
    }
  },
  {
    tool: {
      name: 'workflow_start',
      description: 'Start task (atomically sets status + assignee + checks blockers)',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID' },
          assignee: { type: 'string', description: 'Assignee (default: agent)' }
        },
        required: ['task_id']
      }
    },
    handler: (args) => {
      try {
        const result = startTask(args.task_id as string, {
          assignee: (args.assignee as string) || 'agent'
        });

        const config = getAgentConfig();
        const nextActions: NextAction[] = config.use_subprocess
          ? [{
              tool: 'agent_spawn',
              args: { task_id: result.id },
              reason: 'Spawn agent to execute task',
              priority: 'high'
            }]
          : [{
              tool: 'artefact_show',
              args: { id: result.id, raw: true },
              reason: 'Read task spec to begin implementation',
              priority: 'high'
            }];

        return ok({
          success: true,
          data: { ...result, id: canonicalId(result.id) },
          next_actions: nextActions
        });
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    }
  },
  {
    tool: {
      name: 'workflow_complete',
      description: 'Complete task (atomically sets Done + logs message)',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID' },
          message: { type: 'string', description: 'Completion message' }
        },
        required: ['task_id']
      }
    },
    handler: (args) => {
      try {
        const id = normalizeId(args.task_id as string, undefined, 'task');
        const result = completeTask(id, {
          message: args.message as string | undefined
        });

        const nextActions: NextAction[] = [];

        // Get epic from task to suggest memory sync
        const task = getTask(id);
        const rawEpicId = task?.data?.parent ? /E\d+/.exec(task.data.parent)?.[0] : undefined;
        const epicId = rawEpicId ? canonicalId(rawEpicId) : undefined;

        nextActions.push({
          tool: 'workflow_ready',
          args: { scope: epicId },
          reason: 'Check for newly unblocked tasks',
          priority: 'high'
        });
        nextActions.push({
          tool: 'memory_status',
          args: { scope: epicId },
          reason: 'Check if logs need consolidation',
          priority: 'normal'
        });

        return ok({
          success: true,
          data: { ...result, id: canonicalId(result.id), cascades: result.cascades.map(canonicalId) },
          next_actions: nextActions
        });
      } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
      }
    }
  }
];
