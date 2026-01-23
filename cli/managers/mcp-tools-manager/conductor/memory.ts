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
          if (data.pending || data.logs?.length > 0) {
            nextActions.push({
              tool: 'memory_sync',
              args: { scope: args.scope },
              reason: 'Pending logs need consolidation',
              priority: 'high'
            });
          }
        } catch { /* ignore */ }
      }

      return fromRunResult(result, nextActions);
    }
  },
  {
    tool: {
      name: 'memory_sync',
      description: 'Sync memory: merge task→epic logs, archive orphans, create missing .md files',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter by Epic (E001) or Task (T001)' },
          create: { type: 'boolean', description: 'Create missing memory .md files (default: true)' }
        }
      }
    },
    handler: (args) => {
      let cmd = 'memory:sync';
      if (args.scope) cmd += ` ${args.scope}`;
      if (args.create === false) cmd += ' --no-create';
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        try {
          const data = JSON.parse(result.output || '{}');

          // Suggest consolidation if there are pending logs
          if (data.pending && data.logs?.length > 0) {
            for (const log of data.logs.slice(0, 3)) {
              nextActions.push({
                tool: 'memory_read',
                args: { scope: log.id, full: true },
                reason: `Review pending logs for ${log.id} (${log.entries} entries)`,
                priority: 'normal'
              });
            }
          }

          // Suggest workflow_ready if no pending logs
          if (!data.pending) {
            nextActions.push({
              tool: 'workflow_ready',
              args: {},
              reason: 'Memory synced - find ready tasks',
              priority: 'normal'
            });
          }
        } catch { /* ignore */ }
      }

      return fromRunResult(result, nextActions);
    }
  }
];
