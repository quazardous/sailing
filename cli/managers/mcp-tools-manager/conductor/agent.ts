/**
 * MCP Conductor Tools - Agent operations
 */
import { getConductorManager } from '../../conductor-manager.js';
import {
  ok,
  err,
  normalizeId
} from '../types.js';
import type { ToolDefinition, NextAction } from '../types.js';

export const AGENT_CONDUCTOR_TOOLS: ToolDefinition[] = [
  {
    tool: {
      name: 'agent_spawn',
      description: 'Spawn agent for task execution',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID' },
          timeout: { type: 'number', description: 'Timeout in seconds' },
          resume: { type: 'boolean', description: 'Resume existing worktree' },
          worktree: { type: 'boolean', description: 'Use git worktree isolation' }
        },
        required: ['task_id']
      }
    },
    handler: async (args) => {
      const conductor = getConductorManager();
      const result = await conductor.spawn(normalizeId(args.task_id), {
        timeout: args.timeout,
        resume: args.resume,
        worktree: args.worktree
      });

      const nextActions: NextAction[] = [];
      if (result.success) {
        nextActions.push({
          tool: 'agent_status',
          args: { task_id: args.task_id },
          reason: 'Monitor agent progress',
          priority: 'normal'
        });
      }

      return ok({
        success: result.success,
        data: result,
        error: result.error,
        next_actions: nextActions
      });
    }
  },
  {
    tool: {
      name: 'agent_reap',
      description: 'Reap agent (wait, merge work, cleanup)',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID' },
          wait: { type: 'boolean', description: 'Wait for agent to finish' },
          timeout: { type: 'number', description: 'Wait timeout in seconds' }
        },
        required: ['task_id']
      }
    },
    handler: async (args) => {
      const conductor = getConductorManager();
      const result = await conductor.reap(normalizeId(args.task_id), {
        wait: args.wait,
        timeout: args.timeout
      });

      const nextActions: NextAction[] = [];
      if (result.success) {
        nextActions.push({
          tool: 'workflow_ready',
          args: {},
          reason: 'Find next tasks to work on',
          priority: 'high'
        });
        nextActions.push({
          tool: 'memory_status',
          args: {},
          reason: 'Check memory consolidation status',
          priority: 'normal'
        });
      }

      return ok({
        success: result.success,
        data: result,
        error: result.error,
        next_actions: nextActions
      });
    }
  },
  {
    tool: {
      name: 'agent_kill',
      description: 'Kill agent process',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID' } },
        required: ['task_id']
      }
    },
    handler: async (args) => {
      const conductor = getConductorManager();
      const result = await conductor.kill(normalizeId(args.task_id));
      return ok({ success: result.success, data: result, error: result.error });
    }
  },
  {
    tool: {
      name: 'agent_status',
      description: 'Get agent execution status',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID' } },
        required: ['task_id']
      }
    },
    handler: (args) => {
      const conductor = getConductorManager();
      const status = conductor.getStatus(normalizeId(args.task_id));

      if (!status) {
        return err('Agent not found');
      }

      const nextActions: NextAction[] = [];
      if (status.status === 'completed' || status.status === 'error') {
        nextActions.push({
          tool: 'agent_reap',
          args: { task_id: args.task_id },
          reason: 'Agent finished - reap to merge work',
          priority: 'high'
        });
      }

      return ok({ success: true, data: status, next_actions: nextActions });
    }
  },
  {
    tool: {
      name: 'agent_log',
      description: 'Get agent output log',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID' },
          tail: { type: 'number', description: 'Number of lines from end' }
        },
        required: ['task_id']
      }
    },
    handler: (args) => {
      const conductor = getConductorManager();
      const lines = conductor.getLog(normalizeId(args.task_id), { tail: args.tail });
      return ok({ success: true, data: { lines, count: lines.length } });
    }
  },
  {
    tool: {
      name: 'agent_list',
      description: 'List all agents',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (spawned, running, completed, error)' }
        }
      }
    },
    handler: (args) => {
      const conductor = getConductorManager();
      const agents = args.status
        ? conductor.getAgentsByStatus(args.status)
        : conductor.getAllAgents();
      return ok({ success: true, data: agents });
    }
  }
];
