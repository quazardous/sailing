/**
 * Dashboard routes - API endpoints
 */
import path from 'path';
import http from 'http';
import { html, json } from './server.js';
import { findProjectRoot } from '../managers/core-manager.js';
import { getConfigDisplay } from '../managers/core-manager.js';
import { getConfigInfo } from '../managers/core-manager.js';
import { getAllVersions, getMainVersion, getMainComponentName } from '../managers/version-manager.js';

// Import from lib modules
import {
  setCacheTTL,
  clearCache,
  getCachedPrdsData,
  getCachedBlockers,
  getCachedPendingMemory,
  getMemoryContent,
  loadView,
  render,
  getStatusBadge,
  markdownToHtml,
  entityLink,
  renderMeta,
  renderTabs,
  getProgressClass,
  getKpiClass,
  generatePrdDag,
  generateEpicDag,
  generateTaskDag,
  renderDag,
  renderPrdDag,
  generatePrdGantt,
  generateEpicGantt,
  generatePrdOverviewGantt,
  renderGantt,
  renderSimpleGantt,
  // Templates
  welcomeTemplate,
  versionCardTemplate,
  prdCardTemplate,
  epicCardTemplate,
  taskItemTemplate,
  detailHeaderTemplate,
  progressBarTemplate,
  kpiGridTemplate,
  taskStatsTemplate,
  versionDetailTemplate,
  blockerItemTemplate,
  memoryWarningTemplate,
  versionItemTemplate,
  settingsTemplate,
  pathRowTemplate,
  configRowTemplate,
  emptyTemplate
} from './lib/index.js';

// Routes configuration options
export interface RoutesOptions {
  cacheTTL?: number;
}

// Routes
export function createRoutes(options: RoutesOptions = {}) {
  setCacheTTL(options.cacheTTL || 0);
  clearCache();

  const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void> = {};

  // Main page
  routes['/'] = (_req, res) => {
    const template = loadView('index');
    const projectName = path.basename(findProjectRoot());
    const mainVersion = getMainVersion();
    const componentName = getMainComponentName();

    html(res, render(template, {
      projectName,
      mainVersion,
      componentName
    }));
  };

  // Welcome dashboard
  routes['/api/welcome'] = (_req, res) => {
    let versionsHtml = '';
    try {
      const versions = getAllVersions();
      versionsHtml = versions.map(v => versionCardTemplate(v.name, v.version, v.main)).join('');
    } catch {
      versionsHtml = emptyTemplate('No versions configured');
    }

    const prds = getCachedPrdsData();
    const totalTasks = prds.reduce((acc, p) => acc + p.totalTasks, 0);
    const doneTasks = prds.reduce((acc, p) => acc + p.doneTasks, 0);
    const blockers = getCachedBlockers();
    const pending = getCachedPendingMemory();

    const prdGantt = generatePrdOverviewGantt();
    const prdGanttHtml = prdGantt.tasks.length > 0
      ? renderSimpleGantt(prdGantt.tasks, prdGantt.totalHours, 'PRD Timeline', prdGantt.t0)
      : '';

    html(res, welcomeTemplate({
      prdsCount: prds.length,
      doneTasks,
      totalTasks,
      blockersCount: blockers.length,
      pendingMemory: pending,
      versionsHtml,
      prdGanttHtml
    }));
  };

  // Tree view
  routes['/api/tree'] = (_req, res) => {
    const prds = getCachedPrdsData();
    let content = '';

    if (prds.length === 0) {
      content = '<div style="padding: 12px; color: var(--text-dim);">No PRDs found</div>';
      html(res, content);
      return;
    }

    for (const prd of prds) {
      const prdIcon = prd.status === 'Done' ? '✓' : prd.status === 'Blocked' ? '✗' : '📋';

      content += `<details open>
        <summary class="prd-node" hx-get="/api/prd/${prd.id}" hx-target="#detail" hx-swap="innerHTML">
          <span class="node-icon">${prdIcon}</span>
          <span class="node-label"><strong>${prd.id}</strong> ${prd.title}</span>
          <span class="node-badge ${getStatusBadge(prd.status)}">${prd.progress}%</span>
        </summary>`;

      for (const epic of prd.epics) {
        const epicIcon = epic.status === 'Done' ? '✓' : epic.status === 'Blocked' ? '✗' : '📁';
        const hasNoTasks = epic.tasks.length === 0;
        const epicDone = epic.tasks.filter(t => t.status === 'Done').length;
        const epicTotal = epic.tasks.length;
        const epicProgress = epicTotal > 0 ? Math.round((epicDone / epicTotal) * 100) : 0;

        if (hasNoTasks) {
          content += `
            <div class="leaf level-1" hx-get="/api/epic/${epic.id}" hx-target="#detail" hx-swap="innerHTML">
              <span class="node-icon">${epicIcon}</span>
              <span class="node-label"><strong>${epic.id}</strong> ${epic.title}</span>
              <span class="node-badge ${getStatusBadge(epic.status)}">${epic.status}</span>
            </div>
          `;
        } else {
          content += `<details class="level-1">
            <summary hx-get="/api/epic/${epic.id}" hx-target="#detail" hx-swap="innerHTML">
              <span class="node-icon">${epicIcon}</span>
              <span class="node-label"><strong>${epic.id}</strong> ${epic.title}</span>
              <span class="node-badge ${getStatusBadge(epic.status)}">${epicProgress}%</span>
            </summary>`;

          for (const task of epic.tasks) {
            const taskIcon = task.status === 'Done' ? '✓' : task.status === 'Blocked' ? '✗' : task.status === 'In Progress' ? '▶' : '○';
            content += `
              <div class="leaf level-2" hx-get="/api/task/${task.id}" hx-target="#detail" hx-swap="innerHTML">
                <span class="node-icon">${taskIcon}</span>
                <span class="node-label"><strong>${task.id}</strong> ${task.title}</span>
                <span class="node-badge ${getStatusBadge(task.status)}">${task.status}</span>
              </div>
            `;
          }

          content += '</details>';
        }
      }

      content += '</details>';
    }

    html(res, content);
  };

  // PRD list fragment
  routes['/api/prds'] = (_req, res) => {
    const prds = getCachedPrdsData();
    const content = prds.length > 0
      ? prds.map(prd => prdCardTemplate(prd)).join('')
      : emptyTemplate('No PRDs found');
    html(res, content);
  };

  // PRD detail fragment
  routes['/api/prd/:id'] = (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const prdId = url.pathname.split('/').pop();
    const prds = getCachedPrdsData();
    const prd = prds.find(p => p.id === prdId);

    if (!prd) {
      html(res, emptyTemplate('PRD not found'), 404);
      return;
    }

    const blockedCount = prd.epics.reduce((acc, e) =>
      acc + e.tasks.filter(t => t.status === 'Blocked').length + (e.status === 'Blocked' ? 1 : 0), 0);
    const inProgressCount = prd.epics.reduce((acc, e) =>
      acc + e.tasks.filter(t => t.status === 'In Progress' || t.status === 'WIP').length, 0);

    const kpiHtml = kpiGridTemplate([
      { label: 'Progress', value: `${prd.progress}%`, colorClass: getKpiClass(prd.progress, { ok: 70, risk: 30 }) },
      { label: 'Tasks Done', value: `${prd.doneTasks}/${prd.totalTasks}` },
      { label: 'In Progress', value: inProgressCount, colorClass: inProgressCount > 0 ? 'ok' : '' },
      { label: 'Blocked', value: blockedCount, colorClass: blockedCount > 0 ? 'blocked' : 'ok' }
    ]);

    const epicsHtml = prd.epics.map(epic => {
      const epicDone = epic.tasks.filter(t => t.status === 'Done').length;
      const epicTotal = epic.tasks.length;
      const epicProgress = epicTotal > 0 ? Math.round((epicDone / epicTotal) * 100) : 0;
      const epicProgressClass = getProgressClass(epicProgress);
      const epicBorderColor = epic.status === 'Blocked' ? 'var(--blocked)' :
                              epic.status === 'Done' ? 'var(--ok)' :
                              epic.status === 'In Progress' ? 'var(--accent)' : 'var(--border)';
      const tasksHtml = epic.tasks.map(task => taskItemTemplate(task)).join('');
      return epicCardTemplate({
        id: epic.id,
        title: epic.title,
        status: epic.status,
        progress: epicProgress,
        progressClass: epicProgressClass,
        borderColor: epicBorderColor,
        doneCount: epicDone,
        totalCount: epicTotal,
        tasksHtml
      });
    }).join('');

    const progressClass = getProgressClass(prd.progress);

    const statsContent = `
      ${kpiHtml}
      ${progressBarTemplate(prd.progress, progressClass, 'lg')}
      <div class="epics-list">${epicsHtml}</div>
    `;

    const descContent = prd.description
      ? `<div class="description-content">${markdownToHtml(prd.description)}</div>`
      : emptyTemplate('No description');

    const metaContent = renderMeta(prd.meta);

    const memoryRaw = getMemoryContent(prd.id, 'prd');
    const memoryContent = memoryRaw
      ? `<div class="description-content">${markdownToHtml(memoryRaw)}</div>`
      : emptyTemplate('No memory');

    const dagWithTasks = generatePrdDag(prd, true);
    const dagWithoutTasks = generatePrdDag(prd, false);
    const schemaContent = renderPrdDag(dagWithTasks, dagWithoutTasks);

    const ganttData = generatePrdGantt(prd);
    const ganttContent = renderGantt(
      ganttData.tasks,
      ganttData.criticalPath,
      ganttData.title,
      ganttData.totalHours,
      ganttData.t0,
      ganttData.durationHours,
      ganttData.criticalTimespanHours
    );

    html(res, `
      ${detailHeaderTemplate({ id: prd.id, title: prd.title, status: prd.status })}
      ${renderTabs([
        { id: 'stats', label: 'Stats', content: statsContent, active: true },
        { id: 'desc', label: 'Description', content: descContent },
        { id: 'meta', label: 'Meta', content: metaContent },
        { id: 'schema', label: 'Schema', content: schemaContent },
        { id: 'gantt', label: 'Gantt', content: ganttContent },
        { id: 'memory', label: 'Memory', content: memoryContent }
      ])}
    `);
  };

  // Epic detail fragment
  routes['/api/epic/:id'] = (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const epicId = url.pathname.split('/').pop();
    const prds = getCachedPrdsData();

    let foundEpic = null;
    let parentPrd = null;
    for (const prd of prds) {
      const epic = prd.epics.find(e => e.id === epicId);
      if (epic) {
        foundEpic = epic;
        parentPrd = prd;
        break;
      }
    }

    if (!foundEpic || !parentPrd) {
      html(res, emptyTemplate('Epic not found'), 404);
      return;
    }

    const epicDone = foundEpic.tasks.filter(t => t.status === 'Done').length;
    const epicTotal = foundEpic.tasks.length;
    const epicProgress = epicTotal > 0 ? Math.round((epicDone / epicTotal) * 100) : 0;
    const progressClass = getProgressClass(epicProgress);

    const tasksHtml = foundEpic.tasks.map(task => taskItemTemplate(task)).join('');

    const statsContent = `
      ${kpiGridTemplate([
        { label: 'Progress', value: `${epicProgress}%`, colorClass: getKpiClass(epicProgress, { ok: 70, risk: 30 }) },
        { label: 'Tasks', value: `${epicDone}/${epicTotal}` }
      ])}
      ${progressBarTemplate(epicProgress, progressClass, 'lg')}
      <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text);">Tasks</h3>
      <div class="tasks-list" style="border-top: none; margin-top: 0; padding-top: 0;">
        ${tasksHtml || emptyTemplate('No tasks')}
      </div>
    `;

    const descContent = foundEpic.description
      ? `<div class="description-content">${markdownToHtml(foundEpic.description)}</div>`
      : emptyTemplate('No description');

    const metaContent = renderMeta(foundEpic.meta);

    const memoryRaw = getMemoryContent(foundEpic.id, 'epic');
    const memoryContent = memoryRaw
      ? `<div class="description-content">${markdownToHtml(memoryRaw)}</div>`
      : emptyTemplate('No memory');

    const dagResult = generateEpicDag(foundEpic, parentPrd);
    const schemaContent = renderDag(dagResult.code, dagResult.tooltips);

    const ganttData = generateEpicGantt(foundEpic);
    const ganttContent = renderGantt(
      ganttData.tasks,
      ganttData.criticalPath,
      ganttData.title,
      ganttData.totalHours,
      ganttData.t0,
      ganttData.durationHours,
      ganttData.criticalTimespanHours
    );

    html(res, `
      ${detailHeaderTemplate({
        id: foundEpic.id,
        title: foundEpic.title,
        status: foundEpic.status,
        parentInfo: `Part of ${entityLink(parentPrd.id)}: ${parentPrd.title}`
      })}
      ${renderTabs([
        { id: 'stats', label: 'Stats', content: statsContent, active: true },
        { id: 'desc', label: 'Description', content: descContent },
        { id: 'meta', label: 'Meta', content: metaContent },
        { id: 'schema', label: 'Schema', content: schemaContent },
        { id: 'gantt', label: 'Gantt', content: ganttContent },
        { id: 'memory', label: 'Memory', content: memoryContent }
      ])}
    `);
  };

  // Task detail fragment
  routes['/api/task/:id'] = (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const taskId = url.pathname.split('/').pop();
    const prds = getCachedPrdsData();

    let foundTask = null;
    let parentEpic = null;
    let parentPrd = null;
    for (const prd of prds) {
      for (const epic of prd.epics) {
        const task = epic.tasks.find(t => t.id === taskId);
        if (task) {
          foundTask = task;
          parentEpic = epic;
          parentPrd = prd;
          break;
        }
      }
      if (foundTask) break;
    }

    if (!foundTask) {
      html(res, emptyTemplate('Task not found'), 404);
      return;
    }

    const blockedBy = foundTask.meta?.blocked_by;
    const blockers = blockedBy ? (Array.isArray(blockedBy) ? blockedBy : [blockedBy]) : [];

    const formatDate = (iso?: string) => {
      if (!iso) return '-';
      const d = new Date(iso);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const statsContent = taskStatsTemplate({
      status: foundTask.status,
      effort: foundTask.meta?.effort as string | undefined,
      startedAt: foundTask.meta?.started_at as string | undefined,
      doneAt: foundTask.meta?.done_at as string | undefined,
      priority: foundTask.meta?.priority as string | undefined,
      assignee: foundTask.meta?.assignee as string | undefined,
      blockers: blockers as string[]
    }, formatDate);

    const descContent = foundTask.description
      ? `<div class="description-content">${markdownToHtml(foundTask.description)}</div>`
      : emptyTemplate('No description');

    const metaContent = renderMeta(foundTask.meta);

    const dagResult = generateTaskDag(foundTask, parentEpic, parentPrd);
    const schemaContent = renderDag(dagResult.code, dagResult.tooltips);

    const parentInfo = `${parentEpic ? entityLink(parentEpic.id) : ''}: ${parentEpic?.title}<br>${parentPrd ? entityLink(parentPrd.id) : ''}: ${parentPrd?.title}`;

    html(res, `
      ${detailHeaderTemplate({ id: foundTask.id, title: foundTask.title, status: foundTask.status, parentInfo })}
      ${renderTabs([
        { id: 'stats', label: 'Stats', content: statsContent, active: true },
        { id: 'desc', label: 'Description', content: descContent },
        { id: 'meta', label: 'Meta', content: metaContent },
        { id: 'schema', label: 'Schema', content: schemaContent }
      ])}
    `);
  };

  // Version detail fragment
  routes['/api/version/:name'] = (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const versionName = decodeURIComponent(url.pathname.split('/').pop() || '');

    try {
      const versions = getAllVersions();
      const version = versions.find(v => v.name === versionName);

      if (!version) {
        html(res, emptyTemplate('Version not found'), 404);
        return;
      }

      html(res, versionDetailTemplate(version.name, version.version, version.main));
    } catch {
      html(res, emptyTemplate('Error loading version'), 500);
    }
  };

  // Blockers fragment
  routes['/api/blockers'] = (_req, res) => {
    const blockers = getCachedBlockers();
    const content = blockers.length > 0
      ? blockers.map(blocker => blockerItemTemplate(blocker)).join('')
      : emptyTemplate('No blockers', true);
    html(res, content);
  };

  // Memory warnings fragment
  routes['/api/memory'] = (_req, res) => {
    const pending = getCachedPendingMemory();
    html(res, memoryWarningTemplate(pending));
  };

  // Versions fragment
  routes['/api/versions'] = (_req, res) => {
    try {
      const versions = getAllVersions();
      const sorted = [...versions].sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
      const shown = sorted.slice(0, 3);
      let content = shown.map(v => versionItemTemplate(v.name, v.version, v.main)).join('');

      if (versions.length > 3) {
        content += `<div class="version-item"><span class="version-name">+${versions.length - 3} more</span></div>`;
      }

      html(res, content || '');
    } catch {
      html(res, '');
    }
  };

  // JSON API for raw data
  routes['/api/data'] = (_req, res) => {
    json(res, {
      prds: getCachedPrdsData(),
      blockers: getCachedBlockers(),
      pendingMemory: getCachedPendingMemory()
    });
  };

  // Refresh cache endpoint
  routes['/api/refresh'] = (_req, res) => {
    clearCache();
    json(res, { status: 'ok', message: 'Cache cleared' });
  };

  // Settings/Config page
  routes['/api/settings'] = (_req, res) => {
    const configInfo = getConfigInfo();

    const pathsHtml = Object.entries(configInfo.paths)
      .map(([key, info]) => pathRowTemplate(key, info.path, info.configured, info.isCustom))
      .join('');

    let configHtml = '';
    try {
      const configDisplay = getConfigDisplay();
      configHtml = configDisplay
        .map(item => configRowTemplate(item.key, item.value, item.description, item.default, item.isDefault))
        .join('');
    } catch {
      configHtml = '<tr><td colspan="2" class="empty">Error loading config</td></tr>';
    }

    html(res, settingsTemplate({
      projectRoot: configInfo.projectRoot,
      sailingDir: configInfo.sailingDir,
      pathsConfigPath: configInfo.pathsConfigPath,
      pathsConfigExists: configInfo.pathsConfigExists,
      pathsHtml,
      configHtml
    }));
  };

  return routes;
}
