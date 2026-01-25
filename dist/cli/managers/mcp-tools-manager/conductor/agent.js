/**
 * MCP Conductor Tools - Agent operations
 */
import { getConductorManager } from '../../conductor-manager.js';
import { getAgentLifecycle } from '../../agent-manager.js';
import { updateArtefact } from '../../artefacts/common.js';
import { ok, err } from '../types.js';
import { normalizeId } from '../../../lib/normalize.js';
export const AGENT_CONDUCTOR_TOOLS = [
    {
        tool: {
            name: 'agent_spawn',
            description: 'Spawn agent for task execution',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    timeout: { type: 'number', description: 'Timeout in seconds' },
                    resume: { type: 'boolean', description: 'Resume existing worktree' },
                    worktree: { type: 'boolean', description: 'Use git worktree isolation' }
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
            const nextActions = [];
            if (result.success) {
                nextActions.push({
                    tool: 'agent_status',
                    args: { task_id: args.task_id },
                    reason: 'Monitor agent progress',
                    priority: 'normal'
                });
            }
            return ok({
                success: result.success,
                data: result,
                error: result.error,
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'agent_reap',
            description: 'Reap agent (wait, merge work, cleanup)',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
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
            const nextActions = [];
            if (result.success) {
                nextActions.push({
                    tool: 'workflow_ready',
                    args: {},
                    reason: 'Find next tasks to work on',
                    priority: 'high'
                });
                nextActions.push({
                    tool: 'memory_status',
                    args: {},
                    reason: 'Check memory consolidation status',
                    priority: 'normal'
                });
            }
            return ok({
                success: result.success,
                data: result,
                error: result.error,
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'agent_kill',
            description: 'Kill agent process',
            inputSchema: {
                type: 'object',
                properties: { task_id: { type: 'string', description: 'Task ID' } },
                required: ['task_id']
            }
        },
        handler: async (args) => {
            const conductor = getConductorManager();
            const result = await conductor.kill(args.task_id);
            return ok({ success: result.success, data: result, error: result.error });
        }
    },
    {
        tool: {
            name: 'agent_status',
            description: 'Get agent execution status',
            inputSchema: {
                type: 'object',
                properties: { task_id: { type: 'string', description: 'Task ID' } },
                required: ['task_id']
            }
        },
        handler: (args) => {
            const conductor = getConductorManager();
            const status = conductor.getStatus(args.task_id);
            if (!status) {
                return err('Agent not found');
            }
            const nextActions = [];
            if (status.status === 'completed' || status.status === 'error') {
                nextActions.push({
                    tool: 'agent_reap',
                    args: { task_id: args.task_id },
                    reason: 'Agent finished - reap to merge work',
                    priority: 'high'
                });
            }
            return ok({ success: true, data: status, next_actions: nextActions });
        }
    },
    {
        tool: {
            name: 'agent_log',
            description: 'Get agent output log',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    tail: { type: 'number', description: 'Number of lines from end' }
                },
                required: ['task_id']
            }
        },
        handler: (args) => {
            const conductor = getConductorManager();
            const lines = conductor.getLog(args.task_id, { tail: args.tail });
            return ok({ success: true, data: { lines, count: lines.length } });
        }
    },
    {
        tool: {
            name: 'agent_list',
            description: 'List all agents',
            inputSchema: {
                type: 'object',
                properties: {
                    status: { type: 'string', description: 'Filter by status (spawned, running, completed, error)' }
                }
            }
        },
        handler: (args) => {
            const conductor = getConductorManager();
            const agents = args.status
                ? conductor.getAgentsByStatus(args.status)
                : conductor.getAllAgents();
            return ok({ success: true, data: agents });
        }
    },
    {
        tool: {
            name: 'agent_reset',
            description: 'Reset agent state: kill process, discard work, clear db entry, reset task to Not Started. Use this instead of rm -rf on agent directories.',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    reason: { type: 'string', description: 'Reason for reset (optional)' }
                },
                required: ['task_id']
            }
        },
        handler: async (args) => {
            const taskId = normalizeId(args.task_id, undefined, 'task');
            const reason = args.reason;
            const conductor = getConductorManager();
            const lifecycle = getAgentLifecycle(taskId);
            const results = [];
            // 1. Kill agent if running
            const status = conductor.getStatus(taskId);
            if (status?.isRunning && status.pid) {
                const killResult = await conductor.kill(taskId);
                if (killResult.success) {
                    results.push(`Killed process ${status.pid}`);
                }
            }
            // 2. Reject work (removes worktree, marks as rejected)
            const rejectResult = await lifecycle.reject(reason || 'Reset by agent_reset');
            if (rejectResult.success) {
                results.push('Discarded worktree and work');
            }
            // 3. Clear agent from db
            const cleared = await lifecycle.clear();
            if (cleared) {
                results.push('Cleared agent from db');
            }
            // 4. Reset task status to Not Started
            try {
                updateArtefact(taskId, { status: 'Not Started', assignee: '' });
                results.push('Reset task status to Not Started');
            }
            catch (e) {
                results.push(`Warning: Could not reset task status: ${e instanceof Error ? e.message : e}`);
            }
            return ok({
                success: true,
                data: {
                    task_id: taskId,
                    actions: results,
                    message: `Agent ${taskId} reset successfully`
                }
            });
        }
    }
];
