/**
 * MCP Agent Tools - Limited tools for sandbox agents
 */
import { getConductorManager } from '../conductor-manager.js';
import { getAllPrds, getAllTasks } from '../artefacts-manager.js';
import {
  logTask,
  showArtefact,
  showDeps,
  loadContext,
  showMemory
} from '../../operations/index.js';
import type { LogLevel } from '../memory-manager.js';
import {
  ok,
  err
} from './types.js';
import type { ToolDefinition } from './types.js';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    tool: {
      name: 'task_log',
      description: 'Log message for task execution',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (T001)' },
          message: { type: 'string', description: 'Log message' },
          level: { type: 'string', enum: ['info', 'tip', 'warn', 'error', 'critical'], description: 'Log level' },
          file: { type: 'string', description: 'Related file path' },
          command: { type: 'string', description: 'Related command' }
        },
        required: ['task_id', 'message']
      }
    },
    handler: (args) => {
      const level = (args.level?.toUpperCase() || 'INFO') as LogLevel;
      const result = logTask(
        args.task_id as string,
        args.message as string,
        level,
        {
          file: args.file as string | undefined,
          command: args.command as string | undefined
        }
      );

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'artefact_show',
      description: 'Get artefact details (task, epic, prd, story)',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Artefact ID (T001, E001, PRD-001, S001)' },
          raw: { type: 'boolean', description: 'Include raw markdown body' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const result = showArtefact(args.id as string, { raw: args.raw as boolean | undefined });

      if (!result.exists) {
        return err(`Artefact not found: ${args.id}`);
      }

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'deps_show',
      description: 'Get dependencies for task or epic',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Task or Epic ID (T001, E001)' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const result = showDeps(args.id as string);

      if (!result) {
        return err(`Task not found: ${args.id}`);
      }

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'context_load',
      description: 'Load execution context for operation',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Operation name or task ID' },
          role: { type: 'string', enum: ['agent', 'skill'], description: 'Role (default: agent)' }
        },
        required: ['operation']
      }
    },
    handler: (args) => {
      const result = loadContext(args.operation as string, {
        role: args.role as string | undefined
      });

      if (!result) {
        return err(`No context defined for operation: ${args.operation}`);
      }

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'memory_read',
      description: 'Read memory hierarchy (project → PRD → epic)',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Scope: PROJECT, PRD-001, E001, or T001' },
          full: { type: 'boolean', description: 'Include all sections (default: agent-relevant only)' }
        },
        required: ['scope']
      }
    },
    handler: (args) => {
      const result = showMemory(args.scope as string, {
        full: args.full as boolean | undefined
      });

      if (!result.exists) {
        return ok({
          success: true,
          data: { exists: false, message: `No memory found for: ${args.scope}` }
        });
      }

      return ok({
        success: true,
        data: result
      });
    }
  },
  {
    tool: {
      name: 'system_status',
      description: 'Get project status overview',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const prds = getAllPrds();
      const tasks = getAllTasks();
      const conductor = getConductorManager();
      const agentsRecord = conductor.getAllAgents();
      const agentsList = Object.values(agentsRecord);

      const byStatus: Record<string, number> = {};
      tasks.forEach(t => {
        const status = t.data?.status || 'Unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
      });

      return ok({
        success: true,
        data: {
          prds: prds.length,
          tasks: { total: tasks.length, byStatus },
          agents: {
            total: agentsList.length,
            running: agentsList.filter(a => a.status === 'running' || a.status === 'spawned').length
          }
        }
      });
    }
  }
];
