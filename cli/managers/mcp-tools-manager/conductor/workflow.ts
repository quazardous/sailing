/**
 * MCP Conductor Tools - Workflow operations
 */
import { runRudder } from '../../mcp-manager.js';
import { getTask } from '../../artefacts-manager.js';
import {
  fromRunResult,
  normalizeId,
  detectType
} from '../types.js';
import type { ToolDefinition, NextAction } from '../types.js';

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
      let cmd = 'deps:ready';
      if (args.scope) {
        const type = detectType(args.scope);
        if (type === 'prd') cmd += ` --prd ${args.scope}`;
        else if (type === 'epic') cmd += ` --epic ${args.scope}`;
      }
      cmd += ` --limit ${args.limit || 6}`;
      if (args.include_started) cmd += ' --include-started';
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        try {
          const tasks = JSON.parse(result.output || '[]');
          if (tasks.length > 0) {
            nextActions.push({
              tool: 'workflow_start',
              args: { task_id: tasks[0].id || tasks[0].taskId },
              reason: `Start highest impact task`,
              priority: 'high'
            });
          }
          if (tasks.length === 0) {
            nextActions.push({
              tool: 'memory_status',
              args: {},
              reason: 'No ready tasks - check if logs need consolidation',
              priority: 'normal'
            });
          }
        } catch { /* ignore */ }
      }

      return fromRunResult(result, nextActions);
    }
  },
  {
    tool: {
      name: 'workflow_validate',
      description: 'Validate dependencies and optionally auto-fix issues',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter by PRD' },
          fix: { type: 'boolean', description: 'Auto-fix issues' }
        }
      }
    },
    handler: (args) => {
      let cmd = 'deps:validate';
      if (args.scope) cmd += ` --prd ${args.scope}`;
      if (args.fix) cmd += ' --fix';
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        nextActions.push({
          tool: 'workflow_ready',
          args: { scope: args.scope },
          reason: 'Find tasks ready to start after validation',
          priority: 'normal'
        });
      }

      return fromRunResult(result, nextActions);
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
      const id = normalizeId(args.task_id);
      const assignee = args.assignee || 'agent';

      // Use task:start which does status + assignee + blocker check
      const result = runRudder(`task:start ${id} --assignee "${assignee}" --json`, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        nextActions.push({
          tool: 'agent_spawn',
          args: { task_id: id },
          reason: 'Spawn agent to execute task',
          priority: 'high'
        });
      }

      return fromRunResult(result, nextActions);
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
      const id = normalizeId(args.task_id);
      let cmd = `task:done ${id}`;
      if (args.message) cmd += ` --message "${args.message.replace(/"/g, '\\"')}"`;
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        // Get epic from task to suggest memory sync
        const task = getTask(id);
        const epicId = task?.data?.parent?.match(/E\d+/)?.[0];

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
      }

      return fromRunResult(result, nextActions);
    }
  }
];
