/**
 * MCP Conductor Tools - Story operations
 */
import { runRudder } from '../../mcp-manager.js';
import {
  ok,
  fromRunResult,
  normalizeId
} from '../types.js';
import type { ToolDefinition, NextAction } from '../types.js';

export const STORY_TOOLS: ToolDefinition[] = [
  {
    tool: {
      name: 'story_orphans',
      description: 'List orphan stories (not referenced by any task)',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter by PRD (PRD-001)' }
        }
      }
    },
    handler: (args) => {
      let cmd = 'story:orphans';
      if (args.scope) cmd += ` ${normalizeId(args.scope)}`;
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        try {
          const orphans = JSON.parse(result.output || '[]');
          if (orphans.length > 0) {
            nextActions.push({
              tool: 'artefact_show',
              args: { id: orphans[0].id },
              reason: `Review first orphan story: ${orphans[0].id}`,
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
      name: 'story_validate',
      description: 'Validate stories (check for orphans and invalid references)',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Filter by PRD (PRD-001)' }
        }
      }
    },
    handler: (args) => {
      let cmd = 'story:validate';
      if (args.scope) cmd += ` ${normalizeId(args.scope)}`;
      cmd += ' --json';

      const result = runRudder(cmd, { json: false });
      const nextActions: NextAction[] = [];

      if (result.success) {
        try {
          const data = JSON.parse(result.output || '{}');
          if (!data.valid && data.issues?.length > 0) {
            // Suggest fixing orphans
            const orphanIssues = data.issues.filter((i: any) => i.type === 'orphan');
            if (orphanIssues.length > 0) {
              nextActions.push({
                tool: 'story_orphans',
                args: { scope: args.scope },
                reason: `${orphanIssues.length} orphan stories need linking`,
                priority: 'high'
              });
            }
          }
        } catch { /* ignore */ }
      }

      return fromRunResult(result, nextActions);
    }
  }
];
