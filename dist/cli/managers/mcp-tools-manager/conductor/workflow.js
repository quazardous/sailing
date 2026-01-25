/**
 * MCP Conductor Tools - Workflow operations
 */
import { getTask } from '../../artefacts-manager.js';
import { getReadyTasks, validateDeps, startTask, completeTask } from '../../../operations/index.js';
import { ok, err, detectType } from '../types.js';
import { normalizeId } from '../../../lib/normalize.js';
export const WORKFLOW_TOOLS = [
    {
        tool: {
            name: 'workflow_ready',
            description: 'Get ready tasks (unblocked, not started) with impact scores',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by PRD-001 or E001' },
                    limit: { type: 'number', description: 'Max results (default: 6)' },
                    include_started: { type: 'boolean', description: 'Include In Progress tasks for resume' }
                }
            }
        },
        handler: (args) => {
            const type = args.scope ? detectType(args.scope) : null;
            const result = getReadyTasks({
                prd: type === 'prd' ? args.scope : undefined,
                epic: type === 'epic' ? args.scope : undefined,
                limit: args.limit || 6,
                includeStarted: args.include_started
            });
            const nextActions = [];
            if (result.tasks.length > 0) {
                nextActions.push({
                    tool: 'workflow_start',
                    args: { task_id: result.tasks[0].id },
                    reason: `Start highest impact task`,
                    priority: 'high'
                });
            }
            if (result.tasks.length === 0) {
                nextActions.push({
                    tool: 'memory_status',
                    args: {},
                    reason: 'No ready tasks - check if logs need consolidation',
                    priority: 'normal'
                });
            }
            return ok({
                success: true,
                data: result.tasks,
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'workflow_validate',
            description: 'Validate dependencies and report issues',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by PRD' }
                }
            }
        },
        handler: (args) => {
            const result = validateDeps({
                prd: args.scope
            });
            const nextActions = [];
            if (result.valid) {
                nextActions.push({
                    tool: 'workflow_ready',
                    args: { scope: args.scope },
                    reason: 'Find tasks ready to start after validation',
                    priority: 'normal'
                });
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
            name: 'workflow_start',
            description: 'Start task (atomically sets status + assignee + checks blockers)',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    assignee: { type: 'string', description: 'Assignee (default: agent)' }
                },
                required: ['task_id']
            }
        },
        handler: (args) => {
            try {
                const result = startTask(args.task_id, {
                    assignee: args.assignee || 'agent'
                });
                const nextActions = [{
                        tool: 'agent_spawn',
                        args: { task_id: result.id },
                        reason: 'Spawn agent to execute task',
                        priority: 'high'
                    }];
                return ok({
                    success: true,
                    data: result,
                    next_actions: nextActions
                });
            }
            catch (error) {
                return err(error instanceof Error ? error.message : String(error));
            }
        }
    },
    {
        tool: {
            name: 'workflow_complete',
            description: 'Complete task (atomically sets Done + logs message)',
            inputSchema: {
                type: 'object',
                properties: {
                    task_id: { type: 'string', description: 'Task ID' },
                    message: { type: 'string', description: 'Completion message' }
                },
                required: ['task_id']
            }
        },
        handler: (args) => {
            try {
                const id = normalizeId(args.task_id, undefined, 'task');
                const result = completeTask(id, {
                    message: args.message
                });
                const nextActions = [];
                // Get epic from task to suggest memory sync
                const task = getTask(id);
                const epicId = task?.data?.parent?.match(/E\d+/)?.[0];
                nextActions.push({
                    tool: 'workflow_ready',
                    args: { scope: epicId },
                    reason: 'Check for newly unblocked tasks',
                    priority: 'high'
                });
                nextActions.push({
                    tool: 'memory_status',
                    args: { scope: epicId },
                    reason: 'Check if logs need consolidation',
                    priority: 'normal'
                });
                return ok({
                    success: true,
                    data: result,
                    next_actions: nextActions
                });
            }
            catch (error) {
                return err(error instanceof Error ? error.message : String(error));
            }
        }
    }
];
