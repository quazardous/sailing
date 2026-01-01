#!/usr/bin/env node
/**
 * Rudder MCP Server
 *
 * Exposes rudder CLI commands as MCP tools for sandboxed agents.
 * Agents can interact with rudder without needing filesystem write access.
 *
 * Usage:
 *   node mcp/rudder-server.js [--task-id TNNN] [--project-root /path]
 *
 * The --task-id option restricts operations to a specific task (for agent isolation).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line args
const args = process.argv.slice(2);
let taskId = null;
let projectRoot = path.resolve(__dirname, '..');

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--task-id' && args[i + 1]) {
    taskId = args[++i];
  } else if (args[i] === '--project-root' && args[i + 1]) {
    projectRoot = args[++i];
  }
}

const RUDDER_BIN = path.join(projectRoot, 'bin', 'rudder');

/**
 * Execute rudder command and return result
 */
function runRudder(command, options = {}) {
  const { allowedTaskId, json = false } = options;

  try {
    const fullCmd = `${RUDDER_BIN} ${command}${json ? ' --json' : ''}`;
    const result = execSync(fullCmd, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SAILING_PROJECT: projectRoot
      }
    });
    return { success: true, output: result.trim() };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr?.toString() || ''
    };
  }
}

/**
 * Validate task ID matches allowed task (if restriction is set)
 */
function validateTaskAccess(requestedTaskId) {
  if (!taskId) return true; // No restriction
  return requestedTaskId === taskId;
}

// Define available tools
const TOOLS = [
  {
    name: 'task_log',
    description: 'Log a message for a task. Use during work to record progress, tips, warnings, or errors.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' },
        message: { type: 'string', description: 'Log message' },
        level: {
          type: 'string',
          enum: ['info', 'tip', 'warn', 'error', 'critical'],
          description: 'Log level (default: info)'
        },
        file: { type: 'string', description: 'Related file path (optional)' },
        command: { type: 'string', description: 'Related command (optional)' }
      },
      required: ['task_id', 'message']
    }
  },
  {
    name: 'task_show',
    description: 'Show task details including metadata, description, and deliverables.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_show_memory',
    description: 'Show memory/context for a task (tips and learnings from previous work on the epic).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'assign_claim',
    description: 'Claim a task assignment. Returns full context for the agent to work on the task.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'assign_release',
    description: 'Release a task assignment when work is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'deps_show',
    description: 'Show dependencies for a task (what blocks it and what it blocks).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'task_targets',
    description: 'Show target versions for a task (components to bump when task is done).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task ID (e.g., T042)' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'context_load',
    description: 'Load context for a specific operation (agent bootstrap).',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', description: 'Operation name (e.g., task-start)' },
        role: {
          type: 'string',
          enum: ['agent', 'skill'],
          description: 'Context role (default: agent)'
        }
      },
      required: ['operation']
    }
  },
  {
    name: 'versions',
    description: 'Show current component versions.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'status',
    description: 'Show project status overview (PRDs, epics, tasks).',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// Create server
const server = new Server(
  {
    name: 'rudder-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Validate task access for task-specific operations
  const taskOps = ['task_log', 'task_show', 'task_show_memory', 'assign_claim', 'assign_release', 'deps_show', 'task_targets'];
  if (taskOps.includes(name) && args.task_id) {
    if (!validateTaskAccess(args.task_id)) {
      return {
        content: [{
          type: 'text',
          text: `Access denied: This agent can only access task ${taskId}`
        }],
        isError: true
      };
    }
  }

  let result;

  switch (name) {
    case 'task_log': {
      let cmd = `task:log ${args.task_id} "${args.message.replace(/"/g, '\\"')}"`;
      if (args.level) cmd += ` --${args.level}`;
      if (args.file) cmd += ` -f "${args.file}"`;
      if (args.command) cmd += ` -c "${args.command}"`;
      result = runRudder(cmd);
      break;
    }

    case 'task_show':
      result = runRudder(`task:show ${args.task_id}`);
      break;

    case 'task_show_memory':
      result = runRudder(`task:show-memory ${args.task_id}`);
      break;

    case 'assign_claim':
      result = runRudder(`assign:claim ${args.task_id}`);
      break;

    case 'assign_release':
      result = runRudder(`assign:release ${args.task_id}`);
      break;

    case 'deps_show':
      result = runRudder(`deps:show ${args.task_id}`);
      break;

    case 'task_targets':
      result = runRudder(`task:targets ${args.task_id}`);
      break;

    case 'context_load': {
      const role = args.role || 'agent';
      result = runRudder(`context:load ${args.operation} --role ${role}`);
      break;
    }

    case 'versions':
      result = runRudder('versions');
      break;

    case 'status':
      result = runRudder('status');
      break;

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true
      };
  }

  if (result.success) {
    return {
      content: [{ type: 'text', text: result.output }]
    };
  } else {
    return {
      content: [{
        type: 'text',
        text: `Error: ${result.error}\n${result.stderr}`
      }],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (not stdout, which is for MCP protocol)
  console.error(`Rudder MCP Server started`);
  if (taskId) {
    console.error(`  Restricted to task: ${taskId}`);
  }
  console.error(`  Project root: ${projectRoot}`);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
