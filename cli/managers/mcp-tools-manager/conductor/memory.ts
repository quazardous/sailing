/**
 * MCP Conductor Tools - Memory operations
 */
import { runRudder } from '../../mcp-manager.js';
import {
  fromRunResult
} from '../types.js';
import type { ToolDefinition, NextAction } from '../types.js';

export const MEMORY_TOOLS: ToolDefinition[] = [
  {
    tool: {
      name: 'memory_read',
      description: 'Read memory hierarchy (project → PRD → epic)',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Scope: PROJECT, PRD-001, E001, or T001' },
          full: { type: 'boolean', description: 'Include all sections' }
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
      name: 'memory_write',
      description: 'Add entry to epic memory',
      inputSchema: {
        type: 'object',
        properties: {
          epic_id: { type: 'string', description: 'Epic ID (E001)' },
          category: { type: 'string', enum: ['tip', 'issue', 'command', 'solution'], description: 'Entry category' },
          content: { type: 'string', description: 'Memory content' }
        },
        required: ['epic_id', 'category', 'content']
      }
    },
    handler: (args) => {
      const cmd = `epic:memory ${args.epic_id} "${args.content.replace(/"/g, '\\"')}" --${args.category}`;
      return fromRunResult(runRudder(cmd));
    }
  },
  {
    tool: {
      name: 'memory_status',
      description: 'Check memory consolidation status (pending logs)',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter by PRD or Epic' }
        }
      }
    },
    handler: (args) => {
      let cmd = 'memory:sync';
      if (args.scope) cmd += ` ${args.scope}`;
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        try {
          const data = JSON.parse(result.output || '{}');
          if (data.pending_count > 0 || data.needs_sync) {
            nextActions.push({
              tool: 'memory_read',
              args: { scope: args.scope || 'PROJECT', full: true },
              reason: 'Review pending logs before consolidation',
              priority: 'high'
            });
          }
        } catch { /* ignore */ }
      }

      return fromRunResult(result, nextActions);
    }
  }
];
