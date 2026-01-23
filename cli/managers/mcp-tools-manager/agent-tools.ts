/**
 * MCP Agent Tools - Limited tools for sandbox agents
 */
import { runRudder } from '../mcp-manager.js';
import { getConductorManager } from '../conductor-manager.js';
import { getAllPrds, getAllTasks } from '../artefacts-manager.js';
import {
  ok,
  err,
  fromRunResult,
  normalizeId,
  detectType
} from './types.js';
import type { ToolDefinition, ArtefactType } from './types.js';

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
      let cmd = `task:log ${args.task_id} "${args.message.replace(/"/g, '\\"')}"`;
      if (args.level) cmd += ` --${args.level}`;
      if (args.file) cmd += ` -f "${args.file}"`;
      if (args.command) cmd += ` -c "${args.command}"`;
      return fromRunResult(runRudder(cmd));
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
      const id = normalizeId(args.id);
      const type = detectType(id);

      const cmdMap: Record<ArtefactType, string> = {
        task: `task:show ${id} --json`,
        epic: `epic:show ${id} --json`,
        prd: `prd:show ${id} --json`,
        story: `story:show ${id} --json`,
        unknown: ''
      };

      if (type === 'unknown') {
        return err(`Cannot detect artefact type from ID: ${id}`);
      }

      const cmd = args.raw ? cmdMap[type].replace('--json', '--raw') : cmdMap[type];
      return fromRunResult(runRudder(cmd, { json: false }));
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
      const id = normalizeId(args.id);
      return fromRunResult(runRudder(`deps:show ${id} --json`, { json: false }));
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
      return fromRunResult(runRudder(`context:load ${args.operation} --role ${args.role || 'agent'}`));
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
      let cmd = `memory:show ${args.scope}`;
      if (args.full) cmd += ' --full';
      cmd += ' --json';
      return fromRunResult(runRudder(cmd, { json: false }));
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
