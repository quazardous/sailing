/**
 * Dashboard DAG (Mermaid) generation
 */
import type { PrdData, EpicData, TaskData, DagResult } from './types.js';
import { getStatusClass } from './render.js';

/**
 * Escape title for mermaid tooltip
 */
export function escapeTitle(title: string): string {
  return title
    .replace(/"/g, "'")
    .replace(/\n/g, ' ')
    .replace(/[[\](){}:<>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 50);
}

/**
 * Generate Mermaid DAG for a PRD
 */
export function generatePrdDag(prd: PrdData, showTasks: boolean = true): DagResult {
  const lines: string[] = ['flowchart TB'];
  const clicks: string[] = [];
  const tooltips: Record<string, string> = {};

  // Style definitions
  lines.push('  classDef prd fill:#3B82F6,stroke:#1E40AF,color:#fff');
  lines.push('  classDef epic fill:#10B981,stroke:#047857,color:#fff');
  lines.push('  classDef task fill:#4B5563,stroke:#374151,color:#fff');
  lines.push('  classDef done fill:#059669,stroke:#047857,color:#fff');
  lines.push('  classDef blocked fill:#EF4444,stroke:#DC2626,color:#fff');
  lines.push('  classDef wip fill:#F59E0B,stroke:#D97706,color:#fff');
  lines.push('  classDef ready fill:#3B82F6,stroke:#1E40AF,color:#fff');
  lines.push('');

  const prdNodeId = prd.id.replace(/-/g, '_');
  lines.push(`  ${prdNodeId}["${prd.id}"]`);
  clicks.push(`  click ${prdNodeId} href "javascript:nodeClick('prd:${prd.id}')"`);
  tooltips[prdNodeId] = prd.title;

  const blockedByEdges: string[] = [];

  for (const epic of prd.epics) {
    const epicNodeId = epic.id;
    lines.push(`  ${epicNodeId}["${epic.id}"]`);
    lines.push(`  ${prdNodeId} --> ${epicNodeId}`);
    clicks.push(`  click ${epicNodeId} href "javascript:nodeClick('epic:${epic.id}')"`);
    tooltips[epicNodeId] = epic.title;

    const statusClass = getStatusClass(epic.status);
    lines.push(`  class ${epicNodeId} ${statusClass || 'epic'}`);

    if (showTasks) {
      for (const task of epic.tasks) {
        const taskNodeId = task.id;
        lines.push(`  ${taskNodeId}["${task.id}"]`);
        lines.push(`  ${epicNodeId} --> ${taskNodeId}`);
        clicks.push(`  click ${taskNodeId} href "javascript:nodeClick('task:${task.id}')"`);
        tooltips[taskNodeId] = task.title;

        const taskStatusClass = getStatusClass(task.status);
        lines.push(`  class ${taskNodeId} ${taskStatusClass || 'task'}`);

        const blockedBy = task.meta?.blocked_by;
        if (blockedBy) {
          const blockers = Array.isArray(blockedBy) ? blockedBy : [blockedBy];
          for (const blocker of blockers) {
            if (blocker && typeof blocker === 'string') {
              blockedByEdges.push(`  ${blocker} -.->|blocks| ${taskNodeId}`);
            }
          }
        }
      }
    }
  }

  const edgeIndex = lines.filter(l => l.includes('-->')).length;

  if (blockedByEdges.length > 0) {
    lines.push('');
    lines.push(...blockedByEdges);
    for (let i = 0; i < blockedByEdges.length; i++) {
      lines.push(`  linkStyle ${edgeIndex + i} stroke:#F59E0B,stroke-width:2px`);
    }
  }

  lines.push(`  class ${prdNodeId} prd`);
  lines.push('');
  lines.push(...clicks);

  return { code: lines.join('\n'), tooltips };
}

/**
 * Generate Mermaid DAG for an Epic
 */
export function generateEpicDag(
  epic: EpicData,
  parentPrd: { id: string; title: string }
): DagResult {
  const lines: string[] = ['flowchart TB'];
  const clicks: string[] = [];
  const tooltips: Record<string, string> = {};

  lines.push('  classDef prd fill:#3B82F6,stroke:#1E40AF,color:#fff');
  lines.push('  classDef epic fill:#10B981,stroke:#047857,color:#fff');
  lines.push('  classDef task fill:#4B5563,stroke:#374151,color:#fff');
  lines.push('  classDef done fill:#059669,stroke:#047857,color:#fff');
  lines.push('  classDef blocked fill:#EF4444,stroke:#DC2626,color:#fff');
  lines.push('  classDef wip fill:#F59E0B,stroke:#D97706,color:#fff');
  lines.push('  classDef ready fill:#3B82F6,stroke:#1E40AF,color:#fff');
  lines.push('');

  const prdNodeId = parentPrd.id.replace(/-/g, '_');
  lines.push(`  ${prdNodeId}["${parentPrd.id}"]:::prd`);
  clicks.push(`  click ${prdNodeId} href "javascript:nodeClick('prd:${parentPrd.id}')"`);
  tooltips[prdNodeId] = parentPrd.title;

  const epicNodeId = epic.id;
  lines.push(`  ${epicNodeId}["${epic.id}"]`);
  lines.push(`  ${prdNodeId} --> ${epicNodeId}`);
  clicks.push(`  click ${epicNodeId} href "javascript:nodeClick('epic:${epic.id}')"`);
  tooltips[epicNodeId] = epic.title;
  const epicStatusClass = getStatusClass(epic.status);
  lines.push(`  class ${epicNodeId} ${epicStatusClass || 'epic'}`);

  const blockedByEdges: string[] = [];

  for (const task of epic.tasks) {
    const taskNodeId = task.id;
    lines.push(`  ${taskNodeId}["${task.id}"]`);
    lines.push(`  ${epicNodeId} --> ${taskNodeId}`);
    clicks.push(`  click ${taskNodeId} href "javascript:nodeClick('task:${task.id}')"`);
    tooltips[taskNodeId] = task.title;

    const taskStatusClass = getStatusClass(task.status);
    lines.push(`  class ${taskNodeId} ${taskStatusClass || 'task'}`);

    const blockedBy = task.meta?.blocked_by;
    if (blockedBy) {
      const blockers = Array.isArray(blockedBy) ? blockedBy : [blockedBy];
      for (const blocker of blockers) {
        if (blocker && typeof blocker === 'string') {
          blockedByEdges.push(`  ${blocker} -.->|blocks| ${taskNodeId}`);
        }
      }
    }
  }

  const edgeIndex = lines.filter(l => l.includes('-->')).length;

  if (blockedByEdges.length > 0) {
    lines.push('');
    lines.push(...blockedByEdges);
    for (let i = 0; i < blockedByEdges.length; i++) {
      lines.push(`  linkStyle ${edgeIndex + i} stroke:#F59E0B,stroke-width:2px`);
    }
  }

  lines.push('');
  lines.push(...clicks);

  return { code: lines.join('\n'), tooltips };
}

/**
 * Generate Mermaid DAG for a Task
 */
export function generateTaskDag(
  task: TaskData,
  parentEpic: { id: string; title: string } | null,
  parentPrd: { id: string; title: string } | null
): DagResult {
  const parentEpicId = parentEpic?.id || '';
  const parentPrdId = parentPrd?.id || '';
  const lines: string[] = ['flowchart TB'];
  const clicks: string[] = [];
  const tooltips: Record<string, string> = {};

  lines.push('  classDef prd fill:#3B82F6,stroke:#1E40AF,color:#fff');
  lines.push('  classDef epic fill:#10B981,stroke:#047857,color:#fff');
  lines.push('  classDef task fill:#4B5563,stroke:#374151,color:#fff');
  lines.push('  classDef done fill:#059669,stroke:#047857,color:#fff');
  lines.push('  classDef blocked fill:#EF4444,stroke:#DC2626,color:#fff');
  lines.push('  classDef wip fill:#F59E0B,stroke:#D97706,color:#fff');
  lines.push('');

  const prdNodeId = parentPrdId.replace(/-/g, '_');
  lines.push(`  ${prdNodeId}["${parentPrdId}"]:::prd`);
  clicks.push(`  click ${prdNodeId} href "javascript:nodeClick('prd:${parentPrdId}')"`);
  tooltips[prdNodeId] = parentPrd?.title || parentPrdId;

  lines.push(`  ${parentEpicId}["${parentEpicId}"]:::epic`);
  lines.push(`  ${prdNodeId} --> ${parentEpicId}`);
  clicks.push(`  click ${parentEpicId} href "javascript:nodeClick('epic:${parentEpicId}')"`);
  tooltips[parentEpicId] = parentEpic?.title || parentEpicId;

  const taskNodeId = task.id;
  lines.push(`  ${taskNodeId}["${task.id}"]`);
  lines.push(`  ${parentEpicId} --> ${taskNodeId}`);
  clicks.push(`  click ${taskNodeId} href "javascript:nodeClick('task:${task.id}')"`);
  tooltips[taskNodeId] = task.title;
  const taskStatusClass = getStatusClass(task.status);
  lines.push(`  class ${taskNodeId} ${taskStatusClass || 'task'}`);

  const blockedBy = task.meta?.blocked_by;
  const edgeIndex = lines.filter(l => l.includes('-->')).length;
  const blockedByEdges: string[] = [];

  if (blockedBy) {
    const blockers = Array.isArray(blockedBy) ? blockedBy : [blockedBy];
    for (const blocker of blockers) {
      if (blocker && typeof blocker === 'string') {
        lines.push(`  ${blocker}["${blocker}"]:::task`);
        blockedByEdges.push(`  ${blocker} -.->|blocks| ${taskNodeId}`);
        clicks.push(`  click ${blocker} href "javascript:nodeClick('task:${blocker}')"`);
        tooltips[blocker] = blocker;
      }
    }
  }

  if (blockedByEdges.length > 0) {
    lines.push(...blockedByEdges);
    for (let i = 0; i < blockedByEdges.length; i++) {
      lines.push(`  linkStyle ${edgeIndex + i} stroke:#F59E0B,stroke-width:2px`);
    }
  }

  lines.push('');
  lines.push(...clicks);

  return { code: lines.join('\n'), tooltips };
}

/**
 * Render DAG container with legend
 */
export function renderDag(mermaidCode: string, tooltips?: Record<string, string>): string {
  const tooltipScript = tooltips ? `<script>window._dagTooltips = ${JSON.stringify(tooltips)};</script>` : '';
  return `
    <div class="dag-legend">
      <div class="dag-legend-item"><div class="dag-legend-color prd"></div> PRD</div>
      <div class="dag-legend-item"><div class="dag-legend-color epic"></div> Epic</div>
      <div class="dag-legend-item"><div class="dag-legend-color task"></div> Task</div>
      <div class="dag-legend-item"><div class="dag-legend-color done"></div> Done</div>
      <div class="dag-legend-item"><div class="dag-legend-color wip"></div> In Progress</div>
      <div class="dag-legend-item"><div class="dag-legend-color blocked"></div> Blocked</div>
    </div>
    <div class="dag-container">
      <div class="mermaid">${mermaidCode}</div>
    </div>
    ${tooltipScript}
  `;
}

/**
 * Render PRD DAG with toggle for tasks
 */
export function renderPrdDag(
  dagWithTasks: DagResult,
  dagWithoutTasks: DagResult
): string {
  const allTooltips = { ...dagWithTasks.tooltips, ...dagWithoutTasks.tooltips };
  const tooltipScript = `<script>window._dagTooltips = ${JSON.stringify(allTooltips)};</script>`;
  return `
    <div class="dag-legend">
      <div class="dag-legend-item"><div class="dag-legend-color prd"></div> PRD</div>
      <div class="dag-legend-item"><div class="dag-legend-color epic"></div> Epic</div>
      <div class="dag-legend-item"><div class="dag-legend-color task"></div> Task</div>
      <div class="dag-legend-item"><div class="dag-legend-color done"></div> Done</div>
      <div class="dag-legend-item"><div class="dag-legend-color wip"></div> In Progress</div>
      <div class="dag-legend-item"><div class="dag-legend-color blocked"></div> Blocked</div>
      <label class="dag-toggle" style="margin-left: auto;">
        <input type="checkbox" checked onchange="toggleTasks(this)"> Show Tasks
      </label>
    </div>
    <div class="dag-container" id="dag-with-tasks">
      <div class="mermaid">${dagWithTasks.code}</div>
    </div>
    <div class="dag-container" id="dag-without-tasks" style="display: none;">
      <div class="mermaid">${dagWithoutTasks.code}</div>
    </div>
    ${tooltipScript}
  `;
}
