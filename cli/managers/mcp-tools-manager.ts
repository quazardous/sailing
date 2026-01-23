/**
 * MCP Tools Manager - Shared tools definitions and handlers
 *
 * Two tool sets:
 * - AGENT_TOOLS: Limited tools for sandbox agents
 * - CONDUCTOR_TOOLS: Full tools for orchestrator
 *
 * Design: AI-first, JSON responses, auto-discoverable.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { runRudder, log, type RunResult } from './mcp-manager.js';
import { getConductorManager } from './conductor-manager.js';
import {
  getAllPrds,
  getAllEpics,
  getAllTasks,
  getTask,
  getEpicsForPrd
} from './artefacts-manager.js';
import { loadFile } from './core-manager.js';
import { buildDependencyGraph, blockersResolved } from './graph-manager.js';
import { composeContext } from './compose-manager.js';
import { getAllVersions } from './version-manager.js';

// =============================================================================
// Types
// =============================================================================

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (args: Record<string, any>) => Promise<ToolResponse> | ToolResponse;

export interface ToolDefinition {
  tool: Tool;
  handler: ToolHandler;
}

// =============================================================================
// Response Helpers
// =============================================================================

export function ok(data: any): ToolResponse {
  return {
    content: [{
      type: 'text',
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    }]
  };
}

export function err(message: string): ToolResponse {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  };
}

export function fromResult(result: RunResult): ToolResponse {
  return result.success
    ? ok(result.output || '')
    : err(`${result.error}\n${result.stderr || ''}`);
}

// =============================================================================
// Agent Tools (Limited - for sandbox agents)
// =============================================================================

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    tool: {
      name: 'task_log',
      description: 'Log message for task',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (e.g., T001)' },
          message: { type: 'string', description: 'Log message' },
          level: { type: 'string', enum: ['info', 'tip', 'warn', 'error', 'critical'] },
          file: { type: 'string', description: 'Related file path' },
          command: { type: 'string', description: 'Related command' }
        },
        required: ['task_id', 'message']
      }
    },
    handler: (args) => {
      let cmd = `task:log ${args.task_id} "${args.message}"`;
      if (args.level) cmd += ` --${args.level}`;
      if (args.file) cmd += ` -f "${args.file}"`;
      if (args.command) cmd += ` -c "${args.command}"`;
      return fromResult(runRudder(cmd));
    }
  },
  {
    tool: {
      name: 'task_show',
      description: 'Get task details',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => fromResult(runRudder(`task:show ${args.task_id} --json`, { json: false }))
  },
  {
    tool: {
      name: 'task_show_memory',
      description: 'Get task memory/context',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => fromResult(runRudder(`task:show-memory ${args.task_id}`))
  },
  {
    tool: {
      name: 'deps_show',
      description: 'Get task dependencies',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => fromResult(runRudder(`deps:show ${args.task_id} --json`, { json: false }))
  },
  {
    tool: {
      name: 'task_targets',
      description: 'Get task target versions',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => fromResult(runRudder(`task:targets ${args.task_id} --json`, { json: false }))
  },
  {
    tool: {
      name: 'context_load',
      description: 'Load context for operation',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Operation or task ID' },
          role: { type: 'string', enum: ['agent', 'skill'], description: 'Role type' }
        },
        required: ['operation']
      }
    },
    handler: (args) => fromResult(runRudder(`context:load ${args.operation} --role ${args.role || 'agent'}`))
  },
  {
    tool: {
      name: 'versions',
      description: 'Get component versions',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => fromResult(runRudder('versions --json', { json: false }))
  },
  {
    tool: {
      name: 'status',
      description: 'Get project status',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => fromResult(runRudder('status --json', { json: false }))
  },
  {
    tool: {
      name: 'cli',
      description: 'Execute rudder command',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Rudder command to execute' } },
        required: ['command']
      }
    },
    handler: (args) => fromResult(runRudder(args.command))
  }
];

// =============================================================================
// Conductor Tools (Full - for orchestrator)
// =============================================================================

export const CONDUCTOR_TOOLS: ToolDefinition[] = [
  // ========== Agent ==========
  {
    tool: {
      name: 'agent_spawn',
      description: 'Spawn agent for task',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (e.g., T001)' },
          timeout: { type: 'number', description: 'Timeout in seconds' },
          resume: { type: 'boolean', description: 'Resume existing worktree' },
          worktree: { type: 'boolean', description: 'Use git worktree' }
        },
        required: ['task_id']
      }
    },
    handler: async (args) => {
      const conductor = getConductorManager();
      const result = await conductor.spawn(args.task_id, {
        timeout: args.timeout,
        resume: args.resume,
        worktree: args.worktree
      });
      return result.success ? ok(result) : err(result.error || 'Spawn failed');
    }
  },
  {
    tool: {
      name: 'agent_reap',
      description: 'Reap agent, merge work',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (e.g., T001)' },
          wait: { type: 'boolean', description: 'Wait for agent to finish' },
          timeout: { type: 'number', description: 'Wait timeout in seconds' }
        },
        required: ['task_id']
      }
    },
    handler: async (args) => {
      const conductor = getConductorManager();
      const result = await conductor.reap(args.task_id, {
        wait: args.wait,
        timeout: args.timeout
      });
      return result.success ? ok(result) : err(result.error || 'Reap failed');
    }
  },
  {
    tool: {
      name: 'agent_kill',
      description: 'Kill agent process',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: async (args) => {
      const conductor = getConductorManager();
      const result = await conductor.kill(args.task_id);
      return result.success ? ok(result) : err(result.error || 'Kill failed');
    }
  },
  {
    tool: {
      name: 'agent_status',
      description: 'Get agent status',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => {
      const conductor = getConductorManager();
      const status = conductor.getStatus(args.task_id);
      return status ? ok(status) : err('Agent not found');
    }
  },
  {
    tool: {
      name: 'agent_log',
      description: 'Get agent output',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (e.g., T001)' },
          tail: { type: 'number', description: 'Number of lines from end' }
        },
        required: ['task_id']
      }
    },
    handler: (args) => {
      const conductor = getConductorManager();
      const lines = conductor.getLog(args.task_id, { tail: args.tail });
      return ok(lines.join('\n'));
    }
  },
  {
    tool: {
      name: 'agent_list',
      description: 'List agents',
      inputSchema: {
        type: 'object',
        properties: { status: { type: 'string', description: 'Filter by status' } }
      }
    },
    handler: (args) => {
      const conductor = getConductorManager();
      const agents = args.status
        ? conductor.getAgentsByStatus(args.status)
        : conductor.getAllAgents();
      return ok(agents);
    }
  },

  // ========== Task ==========
  {
    tool: {
      name: 'task_create',
      description: 'Create task',
      inputSchema: {
        type: 'object',
        properties: {
          epic_id: { type: 'string', description: 'Epic ID (e.g., E001)' },
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Task description' },
          effort: { type: 'string', description: 'Effort estimate' },
          priority: { type: 'string', description: 'Priority level' }
        },
        required: ['epic_id', 'title']
      }
    },
    handler: (args) => {
      let cmd = `task:create ${args.epic_id} "${args.title}"`;
      if (args.description) cmd += ` --description "${args.description}"`;
      if (args.effort) cmd += ` --effort ${args.effort}`;
      if (args.priority) cmd += ` --priority ${args.priority}`;
      return fromResult(runRudder(cmd));
    }
  },
  {
    tool: {
      name: 'task_show',
      description: 'Get task details',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => {
      const task = getTask(args.task_id);
      if (!task) return err(`Task not found: ${args.task_id}`);
      const loaded = loadFile(task.file);
      return ok({
        id: task.id,
        file: task.file,
        ...task.data,
        description: loaded?.body || ''
      });
    }
  },
  {
    tool: {
      name: 'task_update',
      description: 'Update task',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (e.g., T001)' },
          status: { type: 'string', description: 'New status' },
          title: { type: 'string', description: 'New title' },
          effort: { type: 'string', description: 'New effort' },
          priority: { type: 'string', description: 'New priority' },
          assignee: { type: 'string', description: 'New assignee' }
        },
        required: ['task_id']
      }
    },
    handler: (args) => {
      let cmd = `task:update ${args.task_id}`;
      if (args.status) cmd += ` --status "${args.status}"`;
      if (args.title) cmd += ` --title "${args.title}"`;
      if (args.effort) cmd += ` --effort ${args.effort}`;
      if (args.priority) cmd += ` --priority ${args.priority}`;
      if (args.assignee) cmd += ` --assignee "${args.assignee}"`;
      return fromResult(runRudder(cmd));
    }
  },
  {
    tool: {
      name: 'task_list',
      description: 'List tasks',
      inputSchema: {
        type: 'object',
        properties: {
          epic_id: { type: 'string', description: 'Filter by epic' },
          status: { type: 'string', description: 'Filter by status' }
        }
      }
    },
    handler: (args) => {
      const options: any = {};
      if (args.epic_id) options.epicId = args.epic_id;
      if (args.status) options.status = args.status;
      const tasks = getAllTasks(options);
      return ok(tasks.map(t => ({
        id: t.id,
        title: t.data?.title,
        status: t.data?.status,
        epic: t.data?.parent,
        assignee: t.data?.assignee
      })));
    }
  },

  // ========== PRD ==========
  {
    tool: {
      name: 'prd_create',
      description: 'Create PRD',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'PRD title' },
          description: { type: 'string', description: 'PRD description' },
          branching: { type: 'string', enum: ['flat', 'epic', 'prd'], description: 'Branching strategy' }
        },
        required: ['title']
      }
    },
    handler: (args) => {
      let cmd = `prd:create "${args.title}"`;
      if (args.description) cmd += ` --description "${args.description}"`;
      if (args.branching) cmd += ` --branching ${args.branching}`;
      return fromResult(runRudder(cmd));
    }
  },
  {
    tool: {
      name: 'prd_list',
      description: 'List PRDs',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const prds = getAllPrds();
      return ok(prds.map(p => ({
        id: p.id,
        title: p.data?.title,
        status: p.data?.status
      })));
    }
  },
  {
    tool: {
      name: 'prd_show',
      description: 'Get PRD details',
      inputSchema: {
        type: 'object',
        properties: { prd_id: { type: 'string', description: 'PRD ID (e.g., PRD001)' } },
        required: ['prd_id']
      }
    },
    handler: (args) => fromResult(runRudder(`prd:show ${args.prd_id} --json`))
  },

  // ========== Epic ==========
  {
    tool: {
      name: 'epic_create',
      description: 'Create epic',
      inputSchema: {
        type: 'object',
        properties: {
          prd_id: { type: 'string', description: 'PRD ID (e.g., PRD001)' },
          title: { type: 'string', description: 'Epic title' },
          description: { type: 'string', description: 'Epic description' }
        },
        required: ['prd_id', 'title']
      }
    },
    handler: (args) => {
      let cmd = `epic:create ${args.prd_id} "${args.title}"`;
      if (args.description) cmd += ` --description "${args.description}"`;
      return fromResult(runRudder(cmd));
    }
  },
  {
    tool: {
      name: 'epic_list',
      description: 'List epics',
      inputSchema: {
        type: 'object',
        properties: { prd_id: { type: 'string', description: 'Filter by PRD' } }
      }
    },
    handler: (args) => {
      const epics = args.prd_id ? getEpicsForPrd(args.prd_id) : getAllEpics();
      return ok(epics.map(e => ({
        id: e.id,
        title: e.data?.title,
        status: e.data?.status
      })));
    }
  },
  {
    tool: {
      name: 'epic_show',
      description: 'Get epic details',
      inputSchema: {
        type: 'object',
        properties: { epic_id: { type: 'string', description: 'Epic ID (e.g., E001)' } },
        required: ['epic_id']
      }
    },
    handler: (args) => fromResult(runRudder(`epic:show ${args.epic_id} --json`))
  },

  // ========== Dependencies ==========
  {
    tool: {
      name: 'deps_show',
      description: 'Get task dependencies',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => {
      const { tasks, blocks } = buildDependencyGraph();
      const task = tasks.get(args.task_id);
      if (!task) return err(`Task not found: ${args.task_id}`);

      const blockers = task.blockedBy || [];
      const dependents = [...blocks.entries()]
        .filter(([_, blockedBy]) => blockedBy.includes(args.task_id))
        .map(([id]) => id);

      return ok({
        task_id: args.task_id,
        blockers,
        dependents,
        ready: blockersResolved(task, tasks)
      });
    }
  },
  {
    tool: {
      name: 'deps_add',
      description: 'Add dependency',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID (e.g., T001)' },
          depends_on: { type: 'string', description: 'Dependency task ID' }
        },
        required: ['task_id', 'depends_on']
      }
    },
    handler: (args) => fromResult(runRudder(`deps:add ${args.task_id} ${args.depends_on}`))
  },

  // ========== Assignment ==========
  {
    tool: {
      name: 'assign_claim',
      description: 'Claim task',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => fromResult(runRudder(`assign:claim ${args.task_id}`))
  },
  {
    tool: {
      name: 'assign_release',
      description: 'Release task',
      inputSchema: {
        type: 'object',
        properties: { task_id: { type: 'string', description: 'Task ID (e.g., T001)' } },
        required: ['task_id']
      }
    },
    handler: (args) => fromResult(runRudder(`assign:release ${args.task_id}`))
  },

  // ========== Context ==========
  {
    tool: {
      name: 'context_load',
      description: 'Load context',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Operation or task ID' },
          role: { type: 'string', enum: ['agent', 'skill', 'coordinator'], description: 'Role type' }
        },
        required: ['operation']
      }
    },
    handler: (args) => {
      const result = composeContext({
        operation: args.operation,
        role: args.role || 'coordinator'
      });
      return result ? ok(result.content) : err(`Failed to load context: ${args.operation}`);
    }
  },

  // ========== System ==========
  {
    tool: {
      name: 'system_status',
      description: 'Project status',
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
        prds: prds.length,
        tasks: { total: tasks.length, byStatus },
        agents: {
          total: agentsList.length,
          running: agentsList.filter(a => a.status === 'running' || a.status === 'spawned').length
        }
      });
    }
  },
  {
    tool: {
      name: 'system_versions',
      description: 'Component versions',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const versions = getAllVersions();
      return ok(versions);
    }
  },
  {
    tool: {
      name: 'system_help',
      description: 'List all tools by category',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const toolsByCategory: Record<string, string[]> = {};
      CONDUCTOR_TOOLS.forEach(t => {
        const [cat] = t.tool.name.split('_');
        if (!toolsByCategory[cat]) toolsByCategory[cat] = [];
        toolsByCategory[cat].push(t.tool.name);
      });
      return ok({
        categories: Object.keys(toolsByCategory),
        tools: toolsByCategory,
        total: CONDUCTOR_TOOLS.length
      });
    }
  },

  // ========== CLI Passthrough ==========
  {
    tool: {
      name: 'cli',
      description: 'Execute rudder command',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Rudder command to execute' } },
        required: ['command']
      }
    },
    handler: (args) => fromResult(runRudder(args.command))
  }
];

// =============================================================================
// Tool Lookup
// =============================================================================

const agentToolMap = new Map(AGENT_TOOLS.map(t => [t.tool.name, t]));
const conductorToolMap = new Map(CONDUCTOR_TOOLS.map(t => [t.tool.name, t]));

/**
 * Get agent tools as MCP Tool array
 */
export function getAgentTools(): Tool[] {
  return AGENT_TOOLS.map(t => t.tool);
}

/**
 * Get conductor tools as MCP Tool array
 */
export function getConductorTools(): Tool[] {
  return CONDUCTOR_TOOLS.map(t => t.tool);
}

/**
 * Handle agent tool call
 */
export async function handleAgentTool(name: string, args: Record<string, any>): Promise<ToolResponse> {
  const toolDef = agentToolMap.get(name);
  if (!toolDef) {
    return err(`Unknown agent tool: ${name}`);
  }
  try {
    log('INFO', `Agent tool: ${name}`, args);
    return await toolDef.handler(args);
  } catch (error: any) {
    log('ERROR', `Agent tool failed: ${name}`, { error: error.message });
    return err(error.message);
  }
}

/**
 * Handle conductor tool call
 */
export async function handleConductorTool(name: string, args: Record<string, any>): Promise<ToolResponse> {
  const toolDef = conductorToolMap.get(name);
  if (!toolDef) {
    return err(`Unknown conductor tool: ${name}`);
  }
  try {
    log('INFO', `Conductor tool: ${name}`, args);
    return await toolDef.handler(args);
  } catch (error: any) {
    log('ERROR', `Conductor tool failed: ${name}`, { error: error.message });
    return err(error.message);
  }
}

// =============================================================================
// Help Formatting
// =============================================================================

/**
 * Format tool help for CLI display
 */
export function formatToolHelp(tools: ToolDefinition[], verbose = false): string {
  const lines: string[] = [];
  const byCategory: Record<string, ToolDefinition[]> = {};

  // Group by category
  for (const t of tools) {
    const [cat] = t.tool.name.split('_');
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(t);
  }

  // Format each category
  for (const [cat, catTools] of Object.entries(byCategory)) {
    lines.push(`\n${cat.toUpperCase()}`);
    for (const t of catTools) {
      const schema = t.tool.inputSchema as any;
      const props = schema?.properties || {};
      const required = schema?.required || [];

      // Format args
      const argParts: string[] = [];
      for (const [name, prop] of Object.entries(props) as [string, any][]) {
        const isRequired = required.includes(name);
        const suffix = isRequired ? '*' : '';
        argParts.push(`--${name}${suffix}`);
      }

      const argsStr = argParts.length > 0 ? argParts.join(' ') : '';
      lines.push(`  ${t.tool.name.padEnd(20)} ${t.tool.description}`);
      if (argsStr) {
        lines.push(`  ${''.padEnd(20)} ${argsStr}`);
      }

      if (verbose) {
        for (const [name, prop] of Object.entries(props) as [string, any][]) {
          const isRequired = required.includes(name);
          const reqStr = isRequired ? ' (required)' : '';
          lines.push(`    --${name}${reqStr}: ${prop.description || prop.type}`);
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Get tool schema for help
 */
export function getToolSchema(tools: ToolDefinition[], toolName: string): ToolDefinition | undefined {
  return tools.find(t => t.tool.name === toolName);
}
