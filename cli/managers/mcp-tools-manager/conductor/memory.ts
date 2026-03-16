/**
 * MCP Conductor Tools - Memory operations
 */
import {
  showMemory,
  consolidateMemory,
  flushEpicLogs,
  syncMemory
} from '../../../operations/memory-ops.js';
import type { MemoryLevel, MemorySectionName } from '../../../operations/memory-ops.js';
import {
  ok,
  err
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
      name: 'memory_sync',
      description: 'Sync memory: merge task→epic logs. Without scope: returns lightweight index (epic IDs, counts, levels). With scope (E001): returns full parsedEntries for that epic. Flow: sync() → check pending → sync(scope) per epic → consolidate.',
      inputSchema: {
        type: 'object',
        properties: {
          scope: { type: 'string', description: 'Epic (E001) or Task (T001). When set, includes parsedEntries for detailed review. Without scope, returns summary only.' }
        }
      }
    },
    handler: (args) => {
      const scope = args.scope as string | undefined;
      const result = syncMemory({ scope });
      const hasScope = !!scope;

      const nextActions: NextAction[] = [];

      if (result.pending && result.logs.length > 0) {
        if (hasScope) {
          // Scoped: suggest consolidation with entries available
          for (const log of result.logs.slice(0, 3)) {
            nextActions.push({
              tool: 'memory_consolidate',
              args: { level: 'epic', target_id: log.id, section: 'Gotchas' },
              reason: `Consolidate ${log.entries} pending entries for ${log.id} (entries in data.logs[].parsedEntries)`,
              priority: 'high'
            });

            // Check for errors/critical that need escalation
            const hasErrors = log.parsedEntries?.some(e => e.level === 'ERROR' || e.level === 'CRITICAL');
            if (hasErrors) {
              nextActions.push({
                tool: 'memory_consolidate',
                args: { level: 'epic', target_id: log.id, section: 'Escalation' },
                reason: `Escalate errors/critical issues for ${log.id}`,
                priority: 'high'
              });
            }
          }
        } else {
          // Unscoped: suggest scoped sync for each pending epic
          for (const log of result.logs.slice(0, 3)) {
            nextActions.push({
              tool: 'memory_sync',
              args: { scope: log.id },
              reason: `Get detailed entries for ${log.id} (${log.entries} pending)`,
              priority: 'high'
            });
          }
        }
      }

      return ok({
        success: true,
        data: result,
        next_actions: nextActions
      });
    }
  },
  {
    tool: {
      name: 'memory_consolidate',
      description: 'Write synthesized content to a memory section (epic, PRD, or project). Default: replaces section content and auto-flushes epic logs. Use append: true for additive writes. Use flush: false to skip auto-flush.',
      inputSchema: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['epic', 'prd', 'project'], description: 'Memory level' },
          target_id: { type: 'string', description: 'Target ID (E001, PRD-001, or PROJECT)' },
          section: {
            type: 'string',
            enum: [
              'Key Files', 'Gotchas', 'Decisions', 'Cross-refs', 'Escalation', 'Changelog',
              'Agent Context',
              'Cross-Epic Patterns',
              'Architecture Decisions', 'Patterns & Conventions', 'Lessons Learned'
            ],
            description: 'Section to write to (epic: Key Files/Gotchas/Decisions/Cross-refs/Escalation/Changelog, PRD: Cross-Epic Patterns/Decisions/Escalation, project: Architecture Decisions/Patterns & Conventions/Lessons Learned)'
          },
          content: { type: 'string', description: 'Synthesized content to write' },
          append: { type: 'boolean', description: 'If true, append instead of replace (default: false)' },
          flush: { type: 'boolean', description: 'Auto-flush epic logs after write (default: true)' },
          operation: { type: 'string', enum: ['append', 'prepend', 'replace'], description: '[DEPRECATED — use append param] How to add content' }
        },
        required: ['level', 'target_id', 'section', 'content']
      }
    },
    handler: (args) => {
      // Priority: append param > operation param > default (replace)
      let operation: 'append' | 'prepend' | 'replace';
      if (typeof args.append === 'boolean') {
        operation = args.append ? 'append' : 'replace';
      } else if (args.operation) {
        operation = args.operation as 'append' | 'prepend' | 'replace';
      } else {
        operation = 'replace';
      }

      const result = consolidateMemory(
        args.level as MemoryLevel,
        args.target_id as string,
        args.section as MemorySectionName,
        args.content as string,
        { operation, flush: args.flush as boolean | undefined }
      );

      const nextActions: NextAction[] = [];

      if (result.success) {
        // Suggest escalating to PRD if important patterns
        if (args.level === 'epic' && (args.section === 'Escalation' || args.section === 'Cross-Epic Patterns')) {
          nextActions.push({
            tool: 'memory_consolidate',
            args: { level: 'prd', section: args.section },
            reason: 'Consider escalating important patterns to PRD level',
            priority: 'low'
          });
        }
      }

      if (!result.success) {
        return err(result.message);
      }

      return ok({
        success: true,
        data: result,
        next_actions: nextActions
      });
    }
  },
  {
    tool: {
      name: 'memory_flush_logs',
      description: 'Manually flush/clear epic logs. Use for cleanup when logs are stale, orphaned, or already consolidated. Normally not needed — memory_consolidate auto-flushes.',
      inputSchema: {
        type: 'object',
        properties: {
          epic_id: { type: 'string', description: 'Epic ID (E001)' }
        },
        required: ['epic_id']
      }
    },
    handler: (args) => {
      const result = flushEpicLogs(args.epic_id as string);

      if (!result.flushed) {
        return ok({
          success: true,
          data: { message: `No logs to flush for ${result.epicId}` }
        });
      }

      return ok({
        success: true,
        data: {
          message: `Flushed ${result.entriesCleared} log entries for ${result.epicId}`,
          ...result
        }
      });
    }
  }
];
