/**
 * Dashboard API v2 - JSON endpoints for Vue dashboard
 *
 * Follows architecture: Routes call managers, not config directly.
 * This layer CAN import from managers and initializes cache with fetchers.
 */
import http from 'http';
import fs from 'fs';
import { json, parseBody } from './server.js';

// Import from managers (allowed at routes level)
import { getAllVersions, getMainVersion } from '../managers/version-manager.js';
import { getAllAgentsFromDb } from '../managers/db-manager.js';
import { getAllFullPrds, buildTaskIndex, buildEpicIndex, updateArtefact } from '../managers/artefacts/index.js';
import { checkPendingMemory, findPrdMemoryFile, findEpicMemoryFile } from '../managers/memory-manager.js';
import { archivePrd } from '../managers/archive-manager.js';
import { normalizeStatus, STATUS } from '../lib/lexicon.js';
import { getConfigValue, findProjectRoot } from '../managers/core-manager.js';
import os from 'os';

// Import from dashboard lib (PURE utilities)
import {
  initCache,
  getCachedPrdsData,
  getCachedBlockers,
  getCachedPendingMemory,
  generateStructuredPrdDag,
  generateStructuredEpicDag,
  generateStructuredTaskDag,
  generatePrdGantt,
  generateEpicGantt,
  generatePrdOverviewGantt,
} from './lib/index.js';

import type { GanttResult, SimpleGanttResult, PrdData, EpicData, TaskData, BlockerData, EffortConfig, StructuredDagResult } from './lib/types.js';

// Build effort config from managers (called once, reused)
function getEffortConfig(): EffortConfig {
  return {
    default_duration: getConfigValue<string>('task.default_duration') || '1h',
    effort_map: getConfigValue<string>('task.effort_map') || 'S=0.5h,M=1h,L=2h,XL=4h'
  };
}

// ============================================================================
// FETCHER FUNCTIONS (called by cache)
// ============================================================================

/**
 * Fetch PRDs data from managers (converts FullPrd to PrdData)
 */
function fetchPrdsData(): PrdData[] {
  const fullPrds = getAllFullPrds();
  return fullPrds.map(prd => ({
    id: prd.id,
    title: prd.title,
    status: prd.status,
    description: prd.description,
    meta: prd.meta,
    epics: prd.epics.map(epic => ({
      id: epic.id,
      title: epic.title,
      status: epic.status,
      description: epic.description,
      meta: epic.meta,
      tasks: epic.tasks.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        description: task.description,
        meta: task.meta,
        createdAt: task.createdAt,
        modifiedAt: task.modifiedAt,
      })),
      createdAt: epic.createdAt,
      modifiedAt: epic.modifiedAt,
    })),
    totalTasks: prd.totalTasks,
    doneTasks: prd.doneTasks,
    progress: prd.progress,
    createdAt: prd.createdAt,
    modifiedAt: prd.modifiedAt,
  }));
}

/**
 * Fetch blockers from managers
 */
function fetchBlockers(): BlockerData[] {
  const blockers: BlockerData[] = [];

  const epicIndex = buildEpicIndex();
  const taskIndex = buildTaskIndex();

  for (const [, epic] of epicIndex) {
    if (epic.data?.status === 'Blocked') {
      blockers.push({
        type: 'epic',
        id: epic.data?.id || `E${epic.key}`,
        title: epic.data?.title || 'Untitled',
        reason: (epic.data as Record<string, unknown>)?.blocked_reason as string || 'Unknown',
      });
    }
  }

  for (const [, task] of taskIndex) {
    if (task.data?.status === 'Blocked') {
      blockers.push({
        type: 'task',
        id: task.data?.id || `T${task.key}`,
        title: task.data?.title || 'Untitled',
        reason: (task.data as Record<string, unknown>)?.blocked_reason as string || 'Unknown',
      });
    }
  }

  return blockers;
}

/**
 * Fetch pending memory from managers
 */
function fetchPendingMemory(): string[] {
  const result = checkPendingMemory();
  return result.epics;
}

/**
 * Get memory content for an entity (called directly, not cached)
 */
function getMemoryContent(entityId: string, type: 'prd' | 'epic'): string {
  try {
    const found = type === 'prd'
      ? findPrdMemoryFile(entityId)
      : findEpicMemoryFile(entityId);

    if (found.exists && fs.existsSync(found.path)) {
      const content = fs.readFileSync(found.path, 'utf8');
      // Extract body (after frontmatter)
      const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
      return bodyMatch ? bodyMatch[1].trim() : content;
    }
  } catch {
    // Memory might not exist
  }
  return '';
}

// Initialize cache with fetchers
initCache({
  prds: fetchPrdsData,
  blockers: fetchBlockers,
  pendingMemory: fetchPendingMemory,
});

// Types for API responses
interface TreeResponse {
  prds: PrdData[];
}

interface ArtefactResponse {
  type: 'prd' | 'epic' | 'task';
  data: PrdData | EpicData | TaskData;
  dag?: StructuredDagResult;
  gantt?: ApiGanttData;
  parent?: {
    id: string;
    title: string;
    type: 'prd' | 'epic';
  };
}

// Simplified Gantt data for API (t0 as string)
interface ApiGanttData {
  tasks: ApiGanttTask[];
  criticalPath: string[];
  totalHours: number;
  t0: string;
  durationHours: number;
  criticalTimespanHours: number;
}

interface ApiGanttTask {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  durationHours: number;
  status: string;
  isCritical: boolean;
  dependencies: string[];
}

interface AgentInfo {
  taskId: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  reapedAt?: string;
  pid?: number;
  worktree?: string;
  exitCode?: number;
}

interface AgentsResponse {
  agents: AgentInfo[];
}

/** Convert GanttResult to API format (Date to string) */
function toApiGantt(result: GanttResult): ApiGanttData {
  return {
    tasks: result.tasks.map(t => ({
      id: t.id,
      name: t.name,
      startHour: t.startHour,
      endHour: t.endHour,
      durationHours: t.durationHours,
      status: t.status,
      isCritical: t.isCritical,
      dependencies: t.dependencies || [],
    })),
    criticalPath: result.criticalPath,
    totalHours: result.totalHours,
    t0: result.t0.toISOString(),
    durationHours: result.durationHours,
    criticalTimespanHours: result.criticalTimespanHours,
  };
}

// Simple Gantt data for overview (PRD-level timeline)
interface ApiSimpleGanttTask {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  durationHours: number;
  status: string;
  progress: number;
  criticalTimespanHours?: number;
  doneAt?: string;
}

interface ApiSimpleGanttData {
  tasks: ApiSimpleGanttTask[];
  totalHours: number;
  t0: string;
}

/** Convert SimpleGanttResult to API format */
function toApiSimpleGantt(result: SimpleGanttResult): ApiSimpleGanttData {
  return {
    tasks: result.tasks.map(t => ({
      id: t.id,
      name: t.name,
      startHour: t.startHour,
      endHour: t.endHour,
      durationHours: t.durationHours,
      status: t.status,
      progress: t.progress,
      criticalTimespanHours: t.criticalTimespanHours,
      doneAt: t.doneAt,
    })),
    totalHours: result.totalHours,
    t0: result.t0.toISOString(),
  };
}

/**
 * Create API v2 routes (JSON)
 */
export function createApiV2Routes(): Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> {
  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {};

  // GET /api/v2/tree - Full tree structure
  routes['/api/v2/tree'] = (_req, res) => {
    try {
      const prds = getCachedPrdsData();
      const response: TreeResponse = { prds };
      json(res, response);
    } catch (error) {
      console.error('API /api/v2/tree error:', error);
      json(res, { error: 'Failed to fetch tree' }, 500);
    }
  };

  // GET /api/v2/artefact/:id - Artefact details
  routes['/api/v2/artefact/:id'] = (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const id = decodeURIComponent(url.pathname.split('/').pop() || '');

      if (!id) {
        json(res, { error: 'Missing artefact ID' }, 400);
        return;
      }

      const prds = getCachedPrdsData();

      // Check if PRD
      if (id.startsWith('PRD-')) {
        const prd = prds.find(p => p.id === id);
        if (!prd) {
          json(res, { error: 'PRD not found' }, 404);
          return;
        }

        const ganttData = generatePrdGantt(prd, getEffortConfig());
        const dagData = generateStructuredPrdDag(prd, true, ganttData.criticalPath);

        const response: ArtefactResponse = {
          type: 'prd',
          data: prd,
          dag: dagData,
          gantt: toApiGantt(ganttData),
        };
        json(res, response);
        return;
      }

      // Check if Epic
      if (id.startsWith('E')) {
        for (const prd of prds) {
          const epic = prd.epics.find(e => e.id === id);
          if (epic) {
            const ganttData = generateEpicGantt(epic, getEffortConfig());
            const dagData = generateStructuredEpicDag(epic, { id: prd.id, title: prd.title, status: prd.status }, ganttData.criticalPath);

            const response: ArtefactResponse = {
              type: 'epic',
              data: epic,
              dag: dagData,
              gantt: toApiGantt(ganttData),
              parent: {
                id: prd.id,
                title: prd.title,
                type: 'prd',
              },
            };
            json(res, response);
            return;
          }
        }
        json(res, { error: 'Epic not found' }, 404);
        return;
      }

      // Check if Task
      if (id.startsWith('T')) {
        for (const prd of prds) {
          for (const epic of prd.epics) {
            const task = epic.tasks.find(t => t.id === id);
            if (task) {
              const dagData = generateStructuredTaskDag(
                task,
                { id: epic.id, title: epic.title, status: epic.status },
                { id: prd.id, title: prd.title, status: prd.status }
              );

              const response: ArtefactResponse = {
                type: 'task',
                data: task,
                dag: dagData,
                parent: {
                  id: epic.id,
                  title: epic.title,
                  type: 'epic',
                },
              };
              json(res, response);
              return;
            }
          }
        }
        json(res, { error: 'Task not found' }, 404);
        return;
      }

      json(res, { error: 'Invalid artefact ID format' }, 400);
    } catch (error) {
      console.error('API error:', error);
      json(res, { error: 'Failed to fetch artefact' }, 500);
    }
  };

  // GET /api/v2/agents - List all agents
  routes['/api/v2/agents'] = (_req, res) => {
    try {
      const agentsDb = getAllAgentsFromDb();

      const agentInfos: AgentInfo[] = Object.entries(agentsDb).map(([taskId, agent]) => ({
        taskId,
        status: agent.status || 'unknown',
        startedAt: agent.started_at,
        completedAt: agent.completed_at,
        reapedAt: agent.reaped_at,
        pid: agent.pid,
        worktree: agent.worktree?.path,
        exitCode: agent.exit_code,
      }));

      const response: AgentsResponse = { agents: agentInfos };
      json(res, response);
    } catch (error) {
      console.error('API error:', error);
      json(res, { error: 'Failed to fetch agents', agents: [] }, 200);
    }
  };

  // GET /api/v2/blockers - List blocked items
  routes['/api/v2/blockers'] = (_req, res) => {
    try {
      const blockers = getCachedBlockers();
      json(res, { blockers });
    } catch (error) {
      json(res, { error: 'Failed to fetch blockers' }, 500);
    }
  };

  // GET /api/v2/stats - Dashboard statistics
  routes['/api/v2/stats'] = (_req, res) => {
    try {
      const prds = getCachedPrdsData();
      const blockers = getCachedBlockers();
      const pendingMemory = getCachedPendingMemory();
      const versions = getAllVersions();

      const totalTasks = prds.reduce((acc, p) => acc + p.totalTasks, 0);
      const doneTasks = prds.reduce((acc, p) => acc + p.doneTasks, 0);

      json(res, {
        prdsCount: prds.length,
        totalTasks,
        doneTasks,
        progress: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
        blockersCount: blockers.length,
        pendingMemory,
        versionsCount: versions.length,
        mainVersion: getMainVersion(),
      });
    } catch (error) {
      json(res, { error: 'Failed to fetch stats' }, 500);
    }
  };

  // GET /api/v2/overview/gantt - Overview Gantt (all PRDs)
  routes['/api/v2/overview/gantt'] = (_req, res) => {
    try {
      const prds = getCachedPrdsData();
      const overviewGantt = generatePrdOverviewGantt(prds, getEffortConfig());
      json(res, toApiSimpleGantt(overviewGantt));
    } catch (error) {
      console.error('API error:', error);
      json(res, { error: 'Failed to generate overview gantt' }, 500);
    }
  };

  // GET /api/v2/project - Project info
  routes['/api/v2/project'] = (_req, res) => {
    try {
      const projectRoot = findProjectRoot();
      const homeDir = os.homedir();
      // Get path relative to home
      const relativePath = projectRoot.startsWith(homeDir)
        ? '~' + projectRoot.slice(homeDir.length)
        : projectRoot;

      json(res, {
        path: projectRoot,
        relativePath,
        name: projectRoot.split('/').pop() || 'Project',
      });
    } catch (error) {
      json(res, { error: 'Failed to get project info' }, 500);
    }
  };

  // GET /api/v2/memory/:type/:id - Get memory content
  routes['/api/v2/memory/:type/:id'] = (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const parts = url.pathname.split('/');
      const id = decodeURIComponent(parts.pop() || '');
      const type = parts.pop() as 'prd' | 'epic';

      if (!id || !type || !['prd', 'epic'].includes(type)) {
        json(res, { error: 'Invalid memory request (only prd/epic supported)' }, 400);
        return;
      }

      const content = getMemoryContent(id, type);
      json(res, { id, type, content: content || null });
    } catch (error) {
      json(res, { error: 'Failed to fetch memory' }, 500);
    }
  };

  // GET /api/v2/statuses - Valid status values per entity type
  routes['/api/v2/statuses'] = (_req, res) => {
    json(res, {
      prd: STATUS.prd,
      epic: STATUS.epic,
      task: STATUS.task,
    });
  };

  // POST /api/v2/artefact/:id/status - Update artefact status
  routes['POST /api/v2/artefact/:id/status'] = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const parts = url.pathname.split('/');
      // /api/v2/artefact/:id/status → id is at index -2
      const id = decodeURIComponent(parts[parts.length - 2] || '');

      if (!id) {
        json(res, { success: false, error: 'Missing artefact ID' }, 400);
        return;
      }

      const body = await parseBody(req) as { status?: string } | null;

      if (!body || !body.status) {
        json(res, { success: false, error: 'Missing status in request body' }, 400);
        return;
      }

      // Determine entity type from ID prefix
      let entityType: 'prd' | 'epic' | 'task';
      if (id.startsWith('PRD-')) {
        entityType = 'prd';
      } else if (id.startsWith('E')) {
        entityType = 'epic';
      } else if (id.startsWith('T')) {
        entityType = 'task';
      } else {
        json(res, { success: false, error: 'Invalid artefact ID format' }, 400);
        return;
      }

      // Validate and normalize the status
      const canonical = normalizeStatus(body.status, entityType);
      if (!canonical) {
        const valid = STATUS[entityType].join(', ');
        json(res, { success: false, error: `Invalid status "${body.status}" for ${entityType}. Valid: ${valid}` }, 400);
        return;
      }

      const result = updateArtefact(id, { status: canonical });
      json(res, { success: true, id: result.id, status: canonical });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to update status';
      console.error('API /api/v2/artefact/:id/status error:', error);
      json(res, { success: false, error: msg }, 500);
    }
  };

  // POST /api/v2/archive/:id - Archive a PRD
  routes['POST /api/v2/archive/:id'] = async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const id = decodeURIComponent(url.pathname.split('/').pop() || '');

      if (!id) {
        json(res, { success: false, error: 'Missing PRD ID' }, 400);
        return;
      }

      const body = await parseBody(req) as { confirm?: string } | null;

      if (!body || body.confirm !== id) {
        json(res, { success: false, error: 'Confirmation does not match PRD ID' }, 400);
        return;
      }

      const result = await archivePrd(id);
      if (result.success) {
        json(res, { success: true, prdId: result.prdId, movedFiles: result.movedFiles });
      } else {
        json(res, { success: false, error: result.error }, 400);
      }
    } catch (error) {
      console.error('API /api/v2/archive error:', error);
      json(res, { success: false, error: 'Failed to archive PRD' }, 500);
    }
  };

  return routes;
}
