/**
 * MCP Conductor Tools - Workflow operations
 */
import { getTask } from '../../artefacts-manager.js';
import { getStore } from '../../artefacts-manager.js';
import { getReadyTasks, validateDeps, startTask, completeTask } from '../../../operations/index.js';
import { ok, err, detectType, canonicalId } from '../types.js';
import { normalizeId } from '../../../lib/normalize.js';
import { getAgentConfig } from '../../config-manager.js';
import { isStatusBreakdown, isStatusInProgress, isStatusDone, isStatusAutoDone } from '../../../lib/lexicon.js';
const MIN_TASKS_PER_EPIC = 3;
/**
 * Check epic health within a scope (PRD or single epic)
 * Returns warnings for epics that aren't ready for execution
 */
function getEpicHealthWarnings(scope) {
    const warnings = [];
    const store = getStore();
    let epics;
    if (scope?.epic) {
        const epic = store.getEpic(scope.epic);
        epics = epic ? [epic] : [];
    }
    else if (scope?.prd) {
        const prdMatch = /PRD-0*(\d+)/i.exec(scope.prd);
        epics = prdMatch ? store.getEpicsForPrd(parseInt(prdMatch[1], 10)) : [];
    }
    else {
        epics = store.getAllEpics();
    }
    for (const epic of epics) {
        const status = epic.data?.status;
        // Skip done/auto-done epics
        if (isStatusDone(status) || isStatusAutoDone(status))
            continue;
        const tasks = store.getTasksForEpic(epic.id);
        const cid = canonicalId(epic.id);
        if (tasks.length === 0) {
            // Epic not yet in Breakdown is expected to have no tasks
            if (isStatusBreakdown(status) || isStatusInProgress(status)) {
                warnings.push({
                    epicId: cid,
                    type: 'no_tasks',
                    message: `${cid} is "${status}" but has 0 tasks`,
                    suggestion: `/dev:epic-breakdown ${cid}`
                });
            }
            else {
                warnings.push({
                    epicId: cid,
                    type: 'not_breakdown',
                    message: `${cid} is "${status}" — needs review + breakdown before execution`,
                    suggestion: `/dev:epic-review ${cid}`
                });
            }
        }
        else if (tasks.length < MIN_TASKS_PER_EPIC) {
            warnings.push({
                epicId: cid,
                type: 'too_few_tasks',
                message: `${cid} has only ${tasks.length} task(s) (minimum ${MIN_TASKS_PER_EPIC})`,
                suggestion: `Review breakdown for ${cid} — may need more granularity`
            });
        }
    }
    return warnings;
}
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
            // Check epic health warnings
            const epicWarnings = getEpicHealthWarnings({
                prd: type === 'prd' ? args.scope : undefined,
                epic: type === 'epic' ? args.scope : undefined
            });
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
                data: {
                    tasks: result.tasks.map(t => ({ ...t, id: canonicalId(t.id) })),
                    total: result.total,
                    ...(epicWarnings.length > 0 ? { warnings: epicWarnings } : {})
                },
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
            // Check epic health warnings
            const epicWarnings = getEpicHealthWarnings({
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
                data: {
                    ...result,
                    ...(epicWarnings.length > 0 ? { epicWarnings } : {})
                },
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
                const config = getAgentConfig();
                const nextActions = config.use_subprocess
                    ? [{
                            tool: 'agent_spawn',
                            args: { task_id: result.id },
                            reason: 'Spawn agent to execute task',
                            priority: 'high'
                        }]
                    : [{
                            tool: 'artefact_show',
                            args: { id: result.id, raw: true },
                            reason: 'Read task spec to begin implementation',
                            priority: 'high'
                        }];
                return ok({
                    success: true,
                    data: { ...result, id: canonicalId(result.id) },
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
                const rawEpicId = task?.data?.parent ? /E\d+/.exec(task.data.parent)?.[0] : undefined;
                const epicId = rawEpicId ? canonicalId(rawEpicId) : undefined;
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
                // Build warnings for Auto-Done cascades
                const warnings = [];
                for (const cascade of result.cascades) {
                    if (cascade.includes('Auto-Done')) {
                        warnings.push(`${cascade} — review and mark Done when validated`);
                    }
                }
                return ok({
                    success: true,
                    data: {
                        ...result,
                        id: canonicalId(result.id),
                        cascades: result.cascades.map(canonicalId),
                        ...(warnings.length > 0 ? { warnings } : {})
                    },
                    next_actions: nextActions
                });
            }
            catch (error) {
                return err(error instanceof Error ? error.message : String(error));
            }
        }
    }
];
