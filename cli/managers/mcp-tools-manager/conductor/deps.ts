/**
 * MCP Conductor Tools - Dependency operations
 */
import { runRudder } from '../../mcp-manager.js';
import { buildDependencyGraph, blockersResolved, longestPath } from '../../graph-manager.js';
import { isStatusDone, isStatusCancelled } from '../../../lib/lexicon.js';
import {
  ok,
  err,
  fromRunResult,
  normalizeId
} from '../types.js';
import type { ToolDefinition, NextAction } from '../types.js';

export const DEPS_TOOLS: ToolDefinition[] = [
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
      const id = normalizeId(args.id);
      const { tasks, blocks } = buildDependencyGraph();
      const task = tasks.get(id);

      if (!task) {
        return err(`Not found: ${id}`);
      }

      const blockers = task.blockedBy || [];
      const dependents = [...blocks.entries()]
        .filter(([_, blockedBy]) => blockedBy.includes(id))
        .map(([taskId]) => taskId);

      return ok({
        success: true,
        data: {
          id,
          blockers,
          blockers_resolved: blockersResolved(task, tasks),
          dependents,
          impact: dependents.length
        }
      });
    }
  },
  {
    tool: {
      name: 'deps_add',
      description: 'Add dependency between tasks',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'Task ID' },
          blocked_by: { type: 'string', description: 'Blocking task ID' }
        },
        required: ['task_id', 'blocked_by']
      }
    },
    handler: (args) => {
      const result = runRudder(`deps:add ${normalizeId(args.task_id)} --blocked-by ${normalizeId(args.blocked_by)}`);
      const nextActions: NextAction[] = [{
        tool: 'workflow_validate',
        args: {},
        reason: 'Validate dependency graph after adding',
        priority: 'normal'
      }];
      return fromRunResult(result, nextActions);
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

      const scores: Array<{
        id: string;
        title: string;
        status: string;
        dependents: number;
        criticalPath: number;
        score: number;
      }> = [];

      for (const [id, task] of tasks) {
        if (isStatusDone(task.status) || isStatusCancelled(task.status)) continue;
        if (prdFilter && !task.prd?.includes(prdFilter)) continue;

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

      const nextActions: NextAction[] = [];
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
