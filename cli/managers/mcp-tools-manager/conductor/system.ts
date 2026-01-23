/**
 * MCP Conductor Tools - System and context operations
 */
import { getConductorManager } from '../../conductor-manager.js';
import { getAllPrds, getAllTasks } from '../../artefacts-manager.js';
import { composeContext } from '../../compose-manager.js';
import { getAllVersions } from '../../version-manager.js';
import {
  ok,
  err
} from '../types.js';
import type { ToolDefinition, NextAction } from '../types.js';

// Import CONDUCTOR_TOOLS reference for help - will be set by index.ts
let conductorToolsRef: ToolDefinition[] = [];
export function setConductorToolsRef(tools: ToolDefinition[]): void {
  conductorToolsRef = tools;
}

export const SYSTEM_TOOLS: ToolDefinition[] = [
  // ========== CONTEXT ==========
  {
    tool: {
      name: 'context_load',
      description: 'Load execution context for operation',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Operation name or task ID' },
          role: { type: 'string', enum: ['agent', 'skill', 'coordinator'], description: 'Role (default: coordinator)' }
        },
        required: ['operation']
      }
    },
    handler: (args) => {
      const result = composeContext({
        operation: args.operation,
        role: args.role || 'coordinator'
      });

      if (!result) {
        return err(`Failed to load context: ${args.operation}`);
      }

      return ok({ success: true, data: { content: result.content } });
    }
  },

  // ========== SYSTEM ==========
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

      const nextActions: NextAction[] = [];
      if (byStatus['In Progress'] > 0) {
        nextActions.push({
          tool: 'agent_list',
          args: { status: 'running' },
          reason: 'Check running agents',
          priority: 'normal'
        });
      }
      nextActions.push({
        tool: 'workflow_ready',
        args: {},
        reason: 'Find tasks ready to start',
        priority: 'normal'
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
        },
        next_actions: nextActions
      });
    }
  },
  {
    tool: {
      name: 'system_versions',
      description: 'Get component versions',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const versions = getAllVersions();
      return ok({ success: true, data: versions });
    }
  },
  {
    tool: {
      name: 'system_help',
      description: 'List all available tools by category',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const toolsByCategory: Record<string, Array<{ name: string; description: string }>> = {};
      conductorToolsRef.forEach(t => {
        const [cat] = t.tool.name.split('_');
        if (!toolsByCategory[cat]) toolsByCategory[cat] = [];
        toolsByCategory[cat].push({
          name: t.tool.name,
          description: t.tool.description || ''
        });
      });
      return ok({
        success: true,
        data: {
          categories: Object.keys(toolsByCategory),
          tools: toolsByCategory,
          total: conductorToolsRef.length
        }
      });
    }
  }
];
