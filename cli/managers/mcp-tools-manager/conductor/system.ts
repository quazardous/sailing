/**
 * MCP Conductor Tools - System and context operations
 */
import { getConductorManager } from '../../conductor-manager.js';
import { getAllPrds, getAllTasks, getStore } from '../../artefacts-manager.js';
import { getAllVersions } from '../../version-manager.js';
import { getAgentConfig } from '../../config-manager.js';
import { isStatusDone, isStatusCancelled, isStatusAutoDone } from '../../../lib/lexicon.js';
import { getReadyTasks } from '../../../operations/index.js';
import {
  ok,
  err,
  normalizeId,
  canonicalId
} from '../types.js';
import type { ToolDefinition, NextAction } from '../types.js';

// Import CONDUCTOR_TOOLS reference for help - will be set by index.ts
let conductorToolsRef: ToolDefinition[] = [];
export function setConductorToolsRef(tools: ToolDefinition[]): void {
  conductorToolsRef = tools;
}

export const SYSTEM_TOOLS: ToolDefinition[] = [
  // ========== SYSTEM ==========
  {
    tool: {
      name: 'system_status',
      description: 'Get project status overview',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const prds = getAllPrds();
      const tasks = getAllTasks();
      const conductor = getConductorManager();
      const agentsRecord = conductor.getAllAgents();
      const agentsList = Object.values(agentsRecord);

      const byStatus: Record<string, number> = {};
      tasks.forEach(t => {
        const status = t.data?.status || 'Unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
      });

      const config = getAgentConfig();
      const nextActions: NextAction[] = [];
      if (byStatus['In Progress'] > 0 && config.use_subprocess) {
        nextActions.push({
          tool: 'agent_list',
          args: { status: 'running' },
          reason: 'Check running agents',
          priority: 'normal'
        });
      }
      nextActions.push({
        tool: 'workflow_ready',
        args: {},
        reason: 'Find tasks ready to start',
        priority: 'normal'
      });

      return ok({
        success: true,
        data: {
          prds: prds.length,
          tasks: { total: tasks.length, byStatus },
          agents: {
            total: agentsList.length,
            running: agentsList.filter(a => a.status === 'running' || a.status === 'spawned').length
          }
        },
        next_actions: nextActions
      });
    }
  },
  {
    tool: {
      name: 'system_versions',
      description: 'Get component versions',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const versions = getAllVersions();
      return ok({ success: true, data: versions });
    }
  },
  {
    tool: {
      name: 'system_help',
      description: 'List all available tools by category',
      inputSchema: { type: 'object', properties: {} }
    },
    handler: () => {
      const toolsByCategory: Record<string, Array<{ name: string; description: string }>> = {};
      conductorToolsRef.forEach(t => {
        const [cat] = t.tool.name.split('_');
        if (!toolsByCategory[cat]) toolsByCategory[cat] = [];
        toolsByCategory[cat].push({
          name: t.tool.name,
          description: t.tool.description || ''
        });
      });
      return ok({
        success: true,
        data: {
          categories: Object.keys(toolsByCategory),
          tools: toolsByCategory,
          total: conductorToolsRef.length
        }
      });
    }
  },
  {
    tool: {
      name: 'prd_overview',
      description: 'Full PRD dashboard in one call: PRD status, epics (status + task counts), ready tasks, blockers',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'PRD ID (e.g., PRD-001)' }
        },
        required: ['id']
      }
    },
    handler: (args) => {
      const { id } = args as { id: string };
      const prdId = normalizeId(id);
      const store = getStore();
      const prd = store.getPrd(prdId);

      if (!prd) {
        return err(`PRD not found: ${prdId}`);
      }

      const prdFile = store.loadFile(prd.file);
      const prdMatch = /PRD-0*(\d+)/i.exec(prdId);
      const epics = prdMatch ? store.getEpicsForPrd(parseInt(prdMatch[1], 10)) : [];

      // Build epic summaries
      const epicSummaries = epics.map(epic => {
        const tasks = store.getTasksForEpic(epic.id);
        const tasksByStatus: Record<string, number> = {};
        const blockedTasks: string[] = [];
        tasks.forEach(t => {
          const status = t.data?.status || 'Unknown';
          tasksByStatus[status] = (tasksByStatus[status] || 0) + 1;
          if (status === 'Blocked') blockedTasks.push(canonicalId(t.id));
        });

        return {
          id: canonicalId(epic.id),
          title: epic.data?.title,
          status: epic.data?.status,
          taskCount: tasks.length,
          tasksByStatus,
          blockedTasks: blockedTasks.length > 0 ? blockedTasks : undefined
        };
      });

      // Get ready tasks for this PRD
      const ready = getReadyTasks({ prd: prdId, limit: 10 });

      // Compute blockers (epics not in Breakdown+ with 0 tasks)
      const warnings: string[] = [];
      for (const es of epicSummaries) {
        const status = es.status as string;
        if (isStatusDone(status) || isStatusAutoDone(status) || isStatusCancelled(status)) continue;
        if (es.taskCount === 0 && (status === 'Breakdown' || status === 'In Progress')) {
          warnings.push(`${es.id} is "${status}" but has 0 tasks`);
        } else if (es.taskCount === 0) {
          warnings.push(`${es.id} is "${status}" — needs review + breakdown`);
        } else if (es.taskCount < 3) {
          warnings.push(`${es.id} has only ${es.taskCount} task(s) — may need more granularity`);
        }
      }

      // PRD-level stats
      const allTasks = store.getTasksForPrd(prdId);
      const totalByStatus: Record<string, number> = {};
      allTasks.forEach(t => {
        const status = t.data?.status || 'Unknown';
        totalByStatus[status] = (totalByStatus[status] || 0) + 1;
      });

      const totalDone = allTasks.filter(t => isStatusDone(t.data?.status) || isStatusCancelled(t.data?.status)).length;
      const progress = allTasks.length > 0 ? Math.round((totalDone / allTasks.length) * 100) : 0;

      const nextActions: NextAction[] = [];
      if (ready.tasks.length > 0) {
        nextActions.push({
          tool: 'workflow_start',
          args: { task_id: ready.tasks[0].id },
          reason: 'Start highest impact task',
          priority: 'high'
        });
      }

      return ok({
        success: true,
        data: {
          prd: {
            id: canonicalId(prdId),
            title: prdFile?.data?.title,
            status: prdFile?.data?.status,
            progress: `${progress}%`,
            totalTasks: allTasks.length,
            tasksByStatus: totalByStatus
          },
          epics: epicSummaries,
          readyTasks: ready.tasks.map(t => ({ id: canonicalId(t.id), title: t.title, impact: t.impact })),
          ...(warnings.length > 0 ? { warnings } : {})
        },
        next_actions: nextActions
      });
    }
  }
];
