/**
 * MCP Conductor Tools - Dependency operations
 */
import { runRudder } from '../../mcp-manager.js';
import { buildDependencyGraph, blockersResolved } from '../../graph-manager.js';
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
  }
];
