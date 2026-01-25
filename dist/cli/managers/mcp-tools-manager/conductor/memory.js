/**
 * MCP Conductor Tools - Memory operations
 */
import { showMemory, getEpicPendingLogs, consolidateMemory, flushEpicLogs, syncMemory } from '../../../operations/memory-ops.js';
import { ok, err } from '../types.js';
export const MEMORY_TOOLS = [
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
            const result = showMemory(args.scope, {
                full: args.full
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
            description: 'Sync memory: merge task→epic logs (mechanical). After sync, use memory_pending_logs to review unprocessed epic logs.',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by Epic (E001) or Task (T001)' }
                }
            }
        },
        handler: (args) => {
            const result = syncMemory({
                scope: args.scope
            });
            const nextActions = [];
            // Suggest reviewing pending logs if any epic has logs
            if (result.pending && result.logs.length > 0) {
                for (const log of result.logs.slice(0, 3)) {
                    nextActions.push({
                        tool: 'memory_pending_logs',
                        args: { epic_id: log.id },
                        reason: `Review ${log.entries} pending log entries for ${log.id}`,
                        priority: 'high'
                    });
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
            name: 'memory_pending_logs',
            description: 'Get pending epic logs for AI review. After memory_sync merges task logs into epic, use this to see what needs consolidation into memory.',
            inputSchema: {
                type: 'object',
                properties: {
                    epic_id: { type: 'string', description: 'Epic ID (E001)' }
                },
                required: ['epic_id']
            }
        },
        handler: (args) => {
            const result = getEpicPendingLogs(args.epic_id);
            const nextActions = [];
            if (result.hasLogs && result.entries.length > 0) {
                // Suggest consolidation
                nextActions.push({
                    tool: 'memory_consolidate',
                    args: { level: 'epic', target_id: result.epicId, section: 'Agent Context' },
                    reason: 'Synthesize logs into Agent Context section',
                    priority: 'high'
                });
                // Check for errors/warnings that might need escalation
                const hasErrors = result.entries.some(e => e.level === 'ERROR' || e.level === 'CRITICAL');
                if (hasErrors) {
                    nextActions.push({
                        tool: 'memory_consolidate',
                        args: { level: 'epic', target_id: result.epicId, section: 'Escalation' },
                        reason: 'Escalate errors/critical issues',
                        priority: 'high'
                    });
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
            description: 'Write synthesized content to a memory section (epic, PRD, or project). Use after reviewing pending logs with memory_pending_logs.',
            inputSchema: {
                type: 'object',
                properties: {
                    level: { type: 'string', enum: ['epic', 'prd', 'project'], description: 'Memory level' },
                    target_id: { type: 'string', description: 'Target ID (E001, PRD-001, or PROJECT)' },
                    section: {
                        type: 'string',
                        enum: ['Agent Context', 'Escalation', 'Cross-Epic Patterns', 'Architecture Decisions', 'Patterns & Conventions', 'Changelog'],
                        description: 'Section to write to'
                    },
                    content: { type: 'string', description: 'Synthesized content to add' },
                    operation: { type: 'string', enum: ['append', 'prepend', 'replace'], description: 'How to add content (default: append)' }
                },
                required: ['level', 'target_id', 'section', 'content']
            }
        },
        handler: (args) => {
            const result = consolidateMemory(args.level, args.target_id, args.section, args.content, { operation: args.operation || 'append' });
            const nextActions = [];
            if (result.success) {
                // Suggest flushing logs after consolidation
                if (args.level === 'epic') {
                    nextActions.push({
                        tool: 'memory_flush_logs',
                        args: { epic_id: args.target_id },
                        reason: 'Flush logs after consolidation (only if all logs are processed)',
                        priority: 'normal'
                    });
                }
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
            description: 'Clear epic logs after AI has consolidated them into memory. Only use when all relevant logs have been synthesized.',
            inputSchema: {
                type: 'object',
                properties: {
                    epic_id: { type: 'string', description: 'Epic ID (E001)' }
                },
                required: ['epic_id']
            }
        },
        handler: (args) => {
            const result = flushEpicLogs(args.epic_id);
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
