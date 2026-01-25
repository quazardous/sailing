/**
 * MCP Conductor Tools - Dependency operations
 */
import { showDeps } from '../../../operations/deps-ops.js';
import { addArtefactDependency } from '../../artefacts/common.js';
import { buildDependencyGraph, longestPath } from '../../graph-manager.js';
import { isStatusDone, isStatusCancelled } from '../../../lib/lexicon.js';
import { ok, err, normalizeId } from '../types.js';
export const DEPS_TOOLS = [
    {
        tool: {
            name: 'deps_show',
            description: 'Get dependencies for task or epic',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Task or Epic ID' }
                },
                required: ['id']
            }
        },
        handler: (args) => {
            const result = showDeps(args.id);
            if (!result) {
                return err(`Not found: ${args.id}`);
            }
            return ok({
                success: true,
                data: {
                    id: result.id,
                    blockers: result.blockers,
                    blockers_resolved: result.blockersResolved,
                    dependents: result.dependents,
                    impact: result.impact
                }
            });
        }
    },
    {
        tool: {
            name: 'deps_add',
            description: 'Add dependency between Tasks (T001) or Epics (E001). NOT for PRDs.',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Task or Epic ID (T001, E001)' },
                    blocked_by: { type: 'string', description: 'Blocking Task or Epic ID (T001, E001)' }
                },
                required: ['id', 'blocked_by']
            }
        },
        handler: (args) => {
            const id = normalizeId(args.id);
            const blockedBy = normalizeId(args.blocked_by);
            // Validate IDs are tasks or epics, not PRDs or stories
            if (!id.startsWith('T') && !id.startsWith('E')) {
                return err(`Invalid id: ${id}. Must be a Task (T001) or Epic (E001), not a PRD or Story.`);
            }
            if (!blockedBy.startsWith('T') && !blockedBy.startsWith('E')) {
                return err(`Invalid blocked_by: ${blockedBy}. Must be a Task (T001) or Epic (E001), not a PRD or Story.`);
            }
            const result = addArtefactDependency(id, blockedBy);
            const nextActions = [{
                    tool: 'workflow_validate',
                    args: {},
                    reason: 'Validate dependency graph after adding',
                    priority: 'normal'
                }];
            if (!result.added) {
                return err(result.message, nextActions);
            }
            return ok({
                success: true,
                data: { message: result.message },
                next_actions: nextActions
            });
        }
    },
    {
        tool: {
            name: 'deps_critical',
            description: 'Find bottlenecks (tasks blocking the most work)',
            inputSchema: {
                type: 'object',
                properties: {
                    scope: { type: 'string', description: 'Filter by PRD (PRD-001)' },
                    limit: { type: 'number', description: 'Max results (default: 5)' }
                }
            }
        },
        handler: (args) => {
            const { tasks, blocks } = buildDependencyGraph();
            const limit = args.limit || 5;
            const prdFilter = args.scope ? normalizeId(args.scope) : null;
            const scores = [];
            for (const [id, task] of tasks) {
                if (isStatusDone(task.status) || isStatusCancelled(task.status))
                    continue;
                if (prdFilter && !task.prd?.includes(prdFilter))
                    continue;
                const dependents = blocks.get(id) || [];
                const { length: criticalPathLen } = longestPath(id, tasks, blocks);
                scores.push({
                    id,
                    title: task.title,
                    status: task.status,
                    dependents: dependents.length,
                    criticalPath: criticalPathLen,
                    score: dependents.length * criticalPathLen
                });
            }
            scores.sort((a, b) => b.score - a.score);
            const top = scores.slice(0, limit);
            const nextActions = [];
            if (top.length > 0) {
                nextActions.push({
                    tool: 'workflow_start',
                    args: { task_id: top[0].id },
                    reason: `Start top bottleneck task (blocks ${top[0].dependents} tasks)`,
                    priority: 'high'
                });
            }
            return ok({
                success: true,
                data: {
                    bottlenecks: top,
                    total_incomplete: scores.length
                },
                next_actions: nextActions
            });
        }
    }
];
