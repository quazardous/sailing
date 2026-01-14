/**
 * Dashboard routes - API endpoints
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { html, json } from './server.js';
import { findFiles, loadFile, getMemoryDir, findProjectRoot } from '../lib/core.js';
import { getConfigDisplay } from '../lib/config.js';
import { getConfigInfo } from '../lib/core.js';
import { getAllVersions, getMainVersion, getMainComponentName } from '../lib/version.js';
import { buildPrdIndex, buildEpicIndex, buildTaskIndex } from '../lib/index.js';
import { extractEpicId } from '../lib/entities.js';
import { marked } from 'marked';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Find views directory (works in both dev and dist)
function getViewsDir() {
    // Try dist location first
    const distViews = path.join(__dirname, 'views');
    if (fs.existsSync(distViews))
        return distViews;
    // Try source location (cli/dashboard/views)
    const srcViews = path.resolve(__dirname, '../../cli/dashboard/views');
    if (fs.existsSync(srcViews))
        return srcViews;
    // Fallback to __dirname/views
    return distViews;
}
// Load HTML template
function loadView(name) {
    const viewPath = path.join(getViewsDir(), `${name}.html`);
    return fs.readFileSync(viewPath, 'utf8');
}
// Template helper - simple {{var}} replacement
function render(template, data) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const value = data[key];
        return value !== undefined ? String(value) : '';
    });
}
// Get all PRDs with their epics and tasks using indexes
function getPrdsData() {
    const prdIndex = buildPrdIndex();
    const epicIndex = buildEpicIndex();
    const taskIndex = buildTaskIndex();
    const prds = [];
    // Build PRD -> Epics -> Tasks structure
    for (const [, prd] of prdIndex) {
        const prdId = prd.data?.id || prd.id || `PRD-${prd.num}`;
        const prdDir = prd.dir;
        // Find epics for this PRD
        const prdEpics = [];
        let totalTasks = 0;
        let doneTasks = 0;
        for (const [, epic] of epicIndex) {
            // Check if epic belongs to this PRD
            if (epic.prdDir !== prdDir)
                continue;
            const epicId = epic.data?.id || `E${epic.key}`;
            // Find tasks for this epic
            const epicTasks = [];
            for (const [, task] of taskIndex) {
                // Check if task belongs to this PRD and epic
                if (task.prdDir !== prdDir)
                    continue;
                const taskParent = task.data?.parent || '';
                const taskEpicId = extractEpicId(taskParent);
                // Match epic by extracted ID or by key
                if (taskEpicId === epicId || taskEpicId === `E${epic.key}` ||
                    (taskEpicId && epic.key === taskEpicId.replace(/^E0*/, ''))) {
                    // Load task file to get markdown body
                    const taskLoaded = loadFile(task.file);
                    epicTasks.push({
                        id: task.data?.id || `T${task.key}`,
                        title: task.data?.title || 'Untitled',
                        status: task.data?.status || 'Draft',
                        description: taskLoaded?.body || '',
                        meta: task.data || {}
                    });
                    totalTasks++;
                    if (task.data?.status === 'Done')
                        doneTasks++;
                }
            }
            // Load epic file to get markdown body
            const epicLoaded = loadFile(epic.file);
            prdEpics.push({
                id: epicId,
                title: epic.data?.title || 'Untitled',
                status: epic.data?.status || 'Draft',
                description: epicLoaded?.body || '',
                meta: epic.data || {},
                tasks: epicTasks
            });
        }
        // Load PRD file to get markdown body
        const prdLoaded = loadFile(prd.file);
        prds.push({
            id: prdId,
            title: prd.data?.title || 'Untitled',
            status: prd.data?.status || 'Draft',
            description: prdLoaded?.body || '',
            meta: prd.data || {},
            epics: prdEpics,
            totalTasks,
            doneTasks,
            progress: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
        });
    }
    return prds;
}
// Get blockers (blocked tasks/epics) using indexes
function getBlockers() {
    const blockers = [];
    const epicIndex = buildEpicIndex();
    const taskIndex = buildTaskIndex();
    // Check blocked epics
    for (const [, epic] of epicIndex) {
        if (epic.data?.status === 'Blocked') {
            blockers.push({
                type: 'epic',
                id: epic.data?.id || `E${epic.key}`,
                title: epic.data?.title || 'Untitled',
                reason: epic.data?.blocked_reason || 'Unknown'
            });
        }
    }
    // Check blocked tasks
    for (const [, task] of taskIndex) {
        if (task.data?.status === 'Blocked') {
            blockers.push({
                type: 'task',
                id: task.data?.id || `T${task.key}`,
                title: task.data?.title || 'Untitled',
                reason: task.data?.blocked_reason || 'Unknown'
            });
        }
    }
    return blockers;
}
// Get pending memory consolidations
function getPendingMemory() {
    const pending = [];
    try {
        const memoryDir = getMemoryDir();
        const logFiles = findFiles(memoryDir, '*.log');
        for (const logFile of logFiles) {
            const content = fs.readFileSync(logFile, 'utf8');
            if (content.trim()) {
                pending.push(path.basename(logFile, '.log'));
            }
        }
    }
    catch {
        // Memory dir might not exist
    }
    return pending;
}
// Helper to get status badge class
function getStatusBadge(status) {
    const s = status.toLowerCase();
    if (s === 'done' || s === 'approved' || s === 'ready')
        return 'badge-ok';
    if (s === 'blocked')
        return 'badge-blocked';
    if (s === 'review' || s === 'in progress' || s === 'wip')
        return 'badge-wip';
    return 'badge-draft';
}
// Markdown to HTML converter using marked (with entity linking)
function markdownToHtml(md) {
    if (!md)
        return '';
    const html = marked.parse(md);
    // Apply entity linking: PRD-NNN, ENNN, TNNN (not already in links)
    return html.replace(/(?<!["'>])(PRD-\d+|E\d{4,}|T\d{4,})(?![^<]*<\/a>)/g, (match) => entityLink(match));
}
// Render metadata as HTML table
function renderMeta(meta) {
    if (!meta || Object.keys(meta).length === 0)
        return '<div class="empty">No metadata</div>';
    const rows = Object.entries(meta)
        .filter(([key]) => !['id', 'title', 'status'].includes(key)) // Exclude already shown fields
        .map(([key, value]) => {
        let displayValue;
        if (typeof value === 'object' && value !== null) {
            displayValue = JSON.stringify(value, null, 2);
        }
        else {
            displayValue = String(value);
        }
        // Apply entity linking to values that contain entity refs
        if (/PRD-\d+|E\d{4,}|T\d{4,}/.test(displayValue)) {
            displayValue = displayValue.replace(/(PRD-\d+|E\d{4,}|T\d{4,})/g, (match) => entityLink(match));
            return `<tr><td class="meta-key">${key}</td><td class="meta-value">${displayValue}</td></tr>`;
        }
        return `<tr><td class="meta-key">${key}</td><td class="meta-value"><code>${displayValue}</code></td></tr>`;
    }).join('');
    if (!rows)
        return '<div class="empty">No additional metadata</div>';
    return `<table class="meta-table">${rows}</table>`;
}
// Helper to create clickable link for entity
function entityLink(id) {
    // Handle compound parent format like "PRD-013 / E0082"
    if (id.includes('/')) {
        const parts = id.split('/').map(p => p.trim());
        return parts.map(p => entityLink(p)).join(' / ');
    }
    // Determine entity type from ID format
    let apiPath = '';
    if (id.startsWith('PRD-')) {
        apiPath = `/api/prd/${id}`;
    }
    else if (id.startsWith('E') && /^E\d+/.test(id)) {
        apiPath = `/api/epic/${id}`;
    }
    else if (id.startsWith('T') && /^T\d+/.test(id)) {
        apiPath = `/api/task/${id}`;
    }
    else {
        // Unknown format, just display text
        return `<span>${id}</span>`;
    }
    return `<a href="#" class="entity-link" hx-get="${apiPath}" hx-target="#detail" hx-swap="innerHTML">${id}</a>`;
}
// Render graph/relations as HTML
function renderGraph(meta, entityType) {
    const sections = [];
    // Parent
    if (meta.parent) {
        sections.push(`
      <div class="graph-section">
        <h4>Parent</h4>
        <div class="graph-item parent">${entityLink(meta.parent)}</div>
      </div>
    `);
    }
    // Children (for PRD: epics, for Epic: tasks)
    if (entityType === 'prd' && meta.epics) {
        const epics = Array.isArray(meta.epics) ? meta.epics : [];
        if (epics.length > 0) {
            sections.push(`
        <div class="graph-section">
          <h4>Children (Epics)</h4>
          ${epics.map((e) => `<div class="graph-item child">${entityLink(e)}</div>`).join('')}
        </div>
      `);
        }
    }
    // Blocked by
    if (meta.blocked_by) {
        const blockers = Array.isArray(meta.blocked_by) ? meta.blocked_by : [meta.blocked_by];
        if (blockers.length > 0) {
            sections.push(`
        <div class="graph-section">
          <h4>Blocked By</h4>
          ${blockers.map((b) => `<div class="graph-item blocker">${entityLink(b)}</div>`).join('')}
        </div>
      `);
        }
    }
    // Stories
    if (meta.stories) {
        const stories = Array.isArray(meta.stories) ? meta.stories : [meta.stories];
        if (stories.length > 0) {
            sections.push(`
        <div class="graph-section">
          <h4>Stories</h4>
          ${stories.map((s) => `<div class="graph-item story">${s}</div>`).join('')}
        </div>
      `);
        }
    }
    // Milestone
    if (meta.milestone) {
        sections.push(`
      <div class="graph-section">
        <h4>Milestone</h4>
        <div class="graph-item milestone">${meta.milestone}</div>
      </div>
    `);
    }
    if (sections.length === 0) {
        return '<div class="empty">No relations</div>';
    }
    return `<div class="graph-container">${sections.join('')}</div>`;
}
// Get memory content for an entity (returns markdown body without frontmatter)
function getMemoryContent(entityId, type) {
    try {
        const memoryDir = getMemoryDir();
        const memoryFile = path.join(memoryDir, `${entityId}.md`);
        if (fs.existsSync(memoryFile)) {
            // Use loadFile to properly parse frontmatter
            const loaded = loadFile(memoryFile);
            return loaded?.body || '';
        }
    }
    catch {
        // Memory might not exist
    }
    return '';
}
// Helper to escape title for mermaid tooltip
function escapeTitle(title) {
    // Escape characters that could break mermaid syntax
    return title
        .replace(/"/g, "'")
        .replace(/\n/g, ' ')
        .replace(/[[\](){}:<>#]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 50);
}
// Helper to escape label for Gantt (more restrictive)
function escapeGanttLabel(text) {
    return text
        .replace(/[:<>#"'[\](){}/\\;,]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 35);
}
// Helper to get status class
function getStatusClass(status) {
    const s = status.toLowerCase();
    if (s === 'done' || s === 'auto-done')
        return 'done';
    if (s === 'blocked')
        return 'blocked';
    if (s === 'in progress' || s === 'wip')
        return 'wip';
    if (s === 'ready')
        return 'ready';
    return '';
}
// Generate Mermaid DAG for a PRD (with optional tasks)
function generatePrdDag(prd, showTasks = true) {
    const lines = ['flowchart TB'];
    const clicks = [];
    const tooltips = {};
    // Style definitions
    lines.push('  classDef prd fill:#3B82F6,stroke:#1E40AF,color:#fff');
    lines.push('  classDef epic fill:#10B981,stroke:#047857,color:#fff');
    lines.push('  classDef task fill:#4B5563,stroke:#374151,color:#fff');
    lines.push('  classDef done fill:#059669,stroke:#047857,color:#fff');
    lines.push('  classDef blocked fill:#EF4444,stroke:#DC2626,color:#fff');
    lines.push('  classDef wip fill:#F59E0B,stroke:#D97706,color:#fff');
    lines.push('  classDef ready fill:#3B82F6,stroke:#1E40AF,color:#fff');
    lines.push('');
    // PRD node
    const prdNodeId = prd.id.replace(/-/g, '_');
    lines.push(`  ${prdNodeId}["${prd.id}"]`);
    clicks.push(`  click ${prdNodeId} href "javascript:nodeClick('prd:${prd.id}')"`);
    tooltips[prdNodeId] = prd.title;
    const blockedByEdges = [];
    for (const epic of prd.epics) {
        const epicNodeId = epic.id;
        lines.push(`  ${epicNodeId}["${epic.id}"]`);
        lines.push(`  ${prdNodeId} --> ${epicNodeId}`);
        clicks.push(`  click ${epicNodeId} href "javascript:nodeClick('epic:${epic.id}')"`);
        tooltips[epicNodeId] = epic.title;
        const statusClass = getStatusClass(epic.status);
        lines.push(`  class ${epicNodeId} ${statusClass || 'epic'}`);
        // Only include tasks if showTasks is true
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
    // Count edges for linkStyle indexing
    let edgeIndex = lines.filter(l => l.includes('-->')).length;
    if (blockedByEdges.length > 0) {
        lines.push('');
        lines.push(...blockedByEdges);
        // Style blocked_by edges in orange
        for (let i = 0; i < blockedByEdges.length; i++) {
            lines.push(`  linkStyle ${edgeIndex + i} stroke:#F59E0B,stroke-width:2px`);
        }
    }
    lines.push(`  class ${prdNodeId} prd`);
    lines.push('');
    lines.push(...clicks);
    return { code: lines.join('\n'), tooltips };
}
// Generate Mermaid DAG for an Epic (epic + tasks)
function generateEpicDag(epic, parentPrd) {
    const parentPrdId = parentPrd.id;
    const lines = ['flowchart TB'];
    const clicks = [];
    const tooltips = {};
    lines.push('  classDef prd fill:#3B82F6,stroke:#1E40AF,color:#fff');
    lines.push('  classDef epic fill:#10B981,stroke:#047857,color:#fff');
    lines.push('  classDef task fill:#4B5563,stroke:#374151,color:#fff');
    lines.push('  classDef done fill:#059669,stroke:#047857,color:#fff');
    lines.push('  classDef blocked fill:#EF4444,stroke:#DC2626,color:#fff');
    lines.push('  classDef wip fill:#F59E0B,stroke:#D97706,color:#fff');
    lines.push('  classDef ready fill:#3B82F6,stroke:#1E40AF,color:#fff');
    lines.push('');
    // Parent PRD (dimmed)
    const prdNodeId = parentPrdId.replace(/-/g, '_');
    lines.push(`  ${prdNodeId}["${parentPrdId}"]:::prd`);
    clicks.push(`  click ${prdNodeId} href "javascript:nodeClick('prd:${parentPrdId}')"`);
    tooltips[prdNodeId] = parentPrd.title;
    // Epic node
    const epicNodeId = epic.id;
    lines.push(`  ${epicNodeId}["${epic.id}"]`);
    lines.push(`  ${prdNodeId} --> ${epicNodeId}`);
    clicks.push(`  click ${epicNodeId} href "javascript:nodeClick('epic:${epic.id}')"`);
    tooltips[epicNodeId] = epic.title;
    const epicStatusClass = getStatusClass(epic.status);
    lines.push(`  class ${epicNodeId} ${epicStatusClass || 'epic'}`);
    const blockedByEdges = [];
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
    // Count edges for linkStyle indexing
    let edgeIndex = lines.filter(l => l.includes('-->')).length;
    if (blockedByEdges.length > 0) {
        lines.push('');
        lines.push(...blockedByEdges);
        // Style blocked_by edges in orange
        for (let i = 0; i < blockedByEdges.length; i++) {
            lines.push(`  linkStyle ${edgeIndex + i} stroke:#F59E0B,stroke-width:2px`);
        }
    }
    lines.push('');
    lines.push(...clicks);
    return { code: lines.join('\n'), tooltips };
}
// Generate Mermaid DAG for a Task (task + blockers)
function generateTaskDag(task, parentEpic, parentPrd) {
    const parentEpicId = parentEpic?.id || '';
    const parentPrdId = parentPrd?.id || '';
    const lines = ['flowchart TB'];
    const clicks = [];
    const tooltips = {};
    lines.push('  classDef prd fill:#3B82F6,stroke:#1E40AF,color:#fff');
    lines.push('  classDef epic fill:#10B981,stroke:#047857,color:#fff');
    lines.push('  classDef task fill:#4B5563,stroke:#374151,color:#fff');
    lines.push('  classDef done fill:#059669,stroke:#047857,color:#fff');
    lines.push('  classDef blocked fill:#EF4444,stroke:#DC2626,color:#fff');
    lines.push('  classDef wip fill:#F59E0B,stroke:#D97706,color:#fff');
    lines.push('');
    // Parent chain
    const prdNodeId = parentPrdId.replace(/-/g, '_');
    lines.push(`  ${prdNodeId}["${parentPrdId}"]:::prd`);
    clicks.push(`  click ${prdNodeId} href "javascript:nodeClick('prd:${parentPrdId}')"`);
    tooltips[prdNodeId] = parentPrd?.title || parentPrdId;
    lines.push(`  ${parentEpicId}["${parentEpicId}"]:::epic`);
    lines.push(`  ${prdNodeId} --> ${parentEpicId}`);
    clicks.push(`  click ${parentEpicId} href "javascript:nodeClick('epic:${parentEpicId}')"`);
    tooltips[parentEpicId] = parentEpic?.title || parentEpicId;
    // Task node
    const taskNodeId = task.id;
    lines.push(`  ${taskNodeId}["${task.id}"]`);
    lines.push(`  ${parentEpicId} --> ${taskNodeId}`);
    clicks.push(`  click ${taskNodeId} href "javascript:nodeClick('task:${task.id}')"`);
    tooltips[taskNodeId] = task.title;
    const taskStatusClass = getStatusClass(task.status);
    lines.push(`  class ${taskNodeId} ${taskStatusClass || 'task'}`);
    // Blocked by
    const blockedBy = task.meta?.blocked_by;
    let edgeIndex = lines.filter(l => l.includes('-->')).length;
    const blockedByEdges = [];
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
        // Style blocked_by edges in orange
        for (let i = 0; i < blockedByEdges.length; i++) {
            lines.push(`  linkStyle ${edgeIndex + i} stroke:#F59E0B,stroke-width:2px`);
        }
    }
    lines.push('');
    lines.push(...clicks);
    return { code: lines.join('\n'), tooltips };
}
// Render DAG container with legend
function renderDag(mermaidCode, tooltips) {
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
// Render PRD DAG with toggle for tasks
function renderPrdDag(dagWithTasks, dagWithoutTasks) {
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
// Generate Mermaid Gantt chart for a PRD
function generatePrdGantt(prd) {
    const lines = ['gantt'];
    lines.push(`  title ${prd.id} - ${escapeTitle(prd.title)}`);
    lines.push('  dateFormat YYYY-MM-DD');
    lines.push('  axisFormat %m/%d');
    lines.push('');
    // Collect all tasks with their dates and dependencies
    const taskData = new Map();
    for (const epic of prd.epics) {
        for (const task of epic.tasks) {
            const startedAt = task.meta?.started_at;
            const doneAt = task.meta?.done_at;
            const blockedBy = task.meta?.blocked_by;
            const blockers = blockedBy ? (Array.isArray(blockedBy) ? blockedBy : [blockedBy]) : [];
            const milestone = task.meta?.milestone;
            taskData.set(task.id, {
                id: task.id,
                title: task.title,
                start: startedAt ? new Date(startedAt) : null,
                end: doneAt ? new Date(doneAt) : null,
                status: task.status,
                blockedBy: blockers.filter((b) => typeof b === 'string'),
                epicId: epic.id,
                milestone: milestone || null
            });
        }
    }
    // Calculate critical path using simple forward/backward pass
    const criticalPath = calculateCriticalPath(taskData);
    // Group tasks by epic, then by milestone
    for (const epic of prd.epics) {
        if (epic.tasks.length === 0)
            continue;
        // Group tasks by milestone within this epic
        const tasksByMilestone = new Map();
        tasksByMilestone.set('', []); // Tasks without milestone
        for (const task of epic.tasks) {
            const data = taskData.get(task.id);
            const milestone = data?.milestone || '';
            if (!tasksByMilestone.has(milestone)) {
                tasksByMilestone.set(milestone, []);
            }
            tasksByMilestone.get(milestone).push(task);
        }
        // Output tasks by milestone (empty milestone first, then named milestones)
        const milestoneKeys = Array.from(tasksByMilestone.keys()).sort((a, b) => {
            if (a === '')
                return -1;
            if (b === '')
                return 1;
            return a.localeCompare(b);
        });
        for (const milestone of milestoneKeys) {
            const tasks = tasksByMilestone.get(milestone);
            if (tasks.length === 0)
                continue;
            // Section label: Epic ID / Milestone or just Epic ID
            const sectionLabel = milestone
                ? `${epic.id} / ${escapeGanttLabel(milestone)}`
                : epic.id;
            lines.push(`  section ${sectionLabel}`);
            for (const task of tasks) {
                const data = taskData.get(task.id);
                if (!data)
                    continue;
                // Determine status class for Gantt
                const isCritical = criticalPath.includes(task.id);
                let statusTag = '';
                if (data.status === 'Done') {
                    statusTag = isCritical ? 'crit, done,' : 'done,';
                }
                else if (data.status === 'In Progress' || data.status === 'WIP') {
                    statusTag = isCritical ? 'crit, active,' : 'active,';
                }
                else if (isCritical) {
                    statusTag = 'crit,';
                }
                // Calculate duration in days
                const durationDays = data.start && data.end
                    ? Math.max(1, Math.ceil((data.end.getTime() - data.start.getTime()) / (1000 * 60 * 60 * 24)))
                    : 1;
                // Task dependencies - filter to only include valid task IDs that exist
                const validBlockers = data.blockedBy.filter(id => taskData.has(id));
                const afterStr = validBlockers.length > 0 ? `after ${validBlockers.join(' ')}` : '';
                // Gantt task line - always use duration format for consistency
                const statusText = data.status && data.status !== 'Done' ? ` [${data.status}]` : '';
                const taskLabel = `${task.id} ${escapeGanttLabel(task.title)}${statusText}`;
                const startDate = data.start ? formatGanttDate(data.start) : formatGanttDate(new Date());
                if (afterStr) {
                    lines.push(`  ${taskLabel} :${statusTag}${task.id}, ${afterStr}, ${durationDays}d`);
                }
                else {
                    // Use start date + duration
                    lines.push(`  ${taskLabel} :${statusTag}${task.id}, ${startDate}, ${durationDays}d`);
                }
            }
        }
        lines.push('');
    }
    return { ganttCode: lines.join('\n'), criticalPath };
}
// Helper to format date for Gantt
function formatGanttDate(date) {
    return date.toISOString().split('T')[0];
}
// Helper to add days to a date
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
// Calculate critical path using simplified forward/backward pass
function calculateCriticalPath(taskData) {
    const tasks = Array.from(taskData.values());
    if (tasks.length === 0)
        return [];
    // Build adjacency list (task -> tasks that depend on it)
    const dependents = new Map();
    for (const task of tasks) {
        for (const blocker of task.blockedBy) {
            if (!dependents.has(blocker)) {
                dependents.set(blocker, []);
            }
            dependents.get(blocker).push(task.id);
        }
    }
    // Calculate task duration in days
    const getDuration = (task) => {
        if (task.start && task.end) {
            return Math.max(1, Math.ceil((task.end.getTime() - task.start.getTime()) / (1000 * 60 * 60 * 24)));
        }
        return 1; // Default 1 day
    };
    // Forward pass: calculate earliest start and finish times
    const earliestStart = new Map();
    const earliestFinish = new Map();
    const calculateEarliest = (taskId) => {
        if (earliestFinish.has(taskId))
            return earliestFinish.get(taskId);
        const task = taskData.get(taskId);
        if (!task)
            return 0;
        // Earliest start is max of all blockers' earliest finish
        let es = 0;
        for (const blocker of task.blockedBy) {
            es = Math.max(es, calculateEarliest(blocker));
        }
        earliestStart.set(taskId, es);
        const ef = es + getDuration(task);
        earliestFinish.set(taskId, ef);
        return ef;
    };
    // Calculate for all tasks
    for (const task of tasks) {
        calculateEarliest(task.id);
    }
    // Find project end (max earliest finish)
    const projectEnd = Math.max(...Array.from(earliestFinish.values()));
    // Backward pass: calculate latest start and finish times
    const latestFinish = new Map();
    const latestStart = new Map();
    const calculateLatest = (taskId) => {
        if (latestStart.has(taskId))
            return latestStart.get(taskId);
        const task = taskData.get(taskId);
        if (!task)
            return projectEnd;
        // Latest finish is min of all dependents' latest start
        const deps = dependents.get(taskId) || [];
        let lf = projectEnd;
        for (const dep of deps) {
            lf = Math.min(lf, calculateLatest(dep));
        }
        latestFinish.set(taskId, lf);
        const ls = lf - getDuration(task);
        latestStart.set(taskId, ls);
        return ls;
    };
    // Calculate for all tasks
    for (const task of tasks) {
        calculateLatest(task.id);
    }
    // Critical path: tasks where slack (LF - EF) is 0
    const criticalPath = [];
    for (const task of tasks) {
        const ef = earliestFinish.get(task.id) || 0;
        const lf = latestFinish.get(task.id) || 0;
        if (lf - ef === 0) {
            criticalPath.push(task.id);
        }
    }
    return criticalPath;
}
// Render Gantt container with legend
function renderGantt(ganttCode, criticalPath) {
    return `
    <div class="gantt-legend">
      <div class="gantt-legend-item"><div class="gantt-legend-color done"></div> Done</div>
      <div class="gantt-legend-item"><div class="gantt-legend-color active"></div> In Progress</div>
      <div class="gantt-legend-item"><div class="gantt-legend-color crit"></div> Critical Path</div>
      <span style="margin-left: auto; font-size: 11px; color: var(--text-dim);">
        ${criticalPath.length} tasks on critical path
      </span>
    </div>
    <div class="dag-container">
      <div class="mermaid">${ganttCode}</div>
    </div>
  `;
}
// Generate Mermaid Gantt chart for an Epic
function generateEpicGantt(epic) {
    const lines = ['gantt'];
    lines.push(`  title ${epic.id} - ${escapeTitle(epic.title)}`);
    lines.push('  dateFormat YYYY-MM-DD');
    lines.push('  axisFormat %m/%d');
    lines.push('');
    // Collect all tasks with their dates, dependencies, and milestones
    const taskData = new Map();
    for (const task of epic.tasks) {
        const startedAt = task.meta?.started_at;
        const doneAt = task.meta?.done_at;
        const blockedBy = task.meta?.blocked_by;
        const blockers = blockedBy ? (Array.isArray(blockedBy) ? blockedBy : [blockedBy]) : [];
        const milestone = task.meta?.milestone;
        taskData.set(task.id, {
            id: task.id,
            start: startedAt ? new Date(startedAt) : null,
            end: doneAt ? new Date(doneAt) : null,
            blockedBy: blockers.filter((b) => typeof b === 'string'),
            milestone: milestone || null
        });
    }
    // Calculate critical path
    const criticalPath = calculateCriticalPath(taskData);
    // Group tasks by milestone
    const tasksByMilestone = new Map();
    tasksByMilestone.set('', []); // Tasks without milestone
    for (const task of epic.tasks) {
        const data = taskData.get(task.id);
        const milestone = data?.milestone || '';
        if (!tasksByMilestone.has(milestone)) {
            tasksByMilestone.set(milestone, []);
        }
        tasksByMilestone.get(milestone).push(task);
    }
    // Output tasks by milestone (empty milestone first, then named milestones)
    const milestoneKeys = Array.from(tasksByMilestone.keys()).sort((a, b) => {
        if (a === '')
            return -1;
        if (b === '')
            return 1;
        return a.localeCompare(b);
    });
    for (const milestone of milestoneKeys) {
        const tasks = tasksByMilestone.get(milestone);
        if (tasks.length === 0)
            continue;
        // Section label: Epic ID / Milestone or just Epic ID
        const sectionLabel = milestone
            ? `${epic.id} / ${escapeGanttLabel(milestone)}`
            : epic.id;
        lines.push(`  section ${sectionLabel}`);
        for (const task of tasks) {
            const data = taskData.get(task.id);
            if (!data)
                continue;
            const isCritical = criticalPath.includes(task.id);
            let statusTag = '';
            if (task.status === 'Done') {
                statusTag = isCritical ? 'crit, done,' : 'done,';
            }
            else if (task.status === 'In Progress' || task.status === 'WIP') {
                statusTag = isCritical ? 'crit, active,' : 'active,';
            }
            else if (isCritical) {
                statusTag = 'crit,';
            }
            // Calculate duration in days
            const durationDays = data.start && data.end
                ? Math.max(1, Math.ceil((data.end.getTime() - data.start.getTime()) / (1000 * 60 * 60 * 24)))
                : 1;
            // Task dependencies - filter to only include valid task IDs that exist
            const validBlockers = data.blockedBy.filter(id => taskData.has(id));
            const afterStr = validBlockers.length > 0 ? `after ${validBlockers.join(' ')}` : '';
            // Gantt task line - always use duration format for consistency
            const statusText = task.status && task.status !== 'Done' ? ` [${task.status}]` : '';
            const taskLabel = `${task.id} ${escapeGanttLabel(task.title)}${statusText}`;
            const startDate = data.start ? formatGanttDate(data.start) : formatGanttDate(new Date());
            if (afterStr) {
                lines.push(`  ${taskLabel} :${statusTag}${task.id}, ${afterStr}, ${durationDays}d`);
            }
            else {
                // Use start date + duration
                lines.push(`  ${taskLabel} :${statusTag}${task.id}, ${startDate}, ${durationDays}d`);
            }
        }
    }
    return { ganttCode: lines.join('\n'), criticalPath };
}
// Helper to render tabs with content
function renderTabs(tabs) {
    const tabButtons = tabs.map(t => `<button class="tab-btn ${t.active ? 'active' : ''}" onclick="switchTab(this, '${t.id}')">${t.label}</button>`).join('');
    const tabContents = tabs.map(t => `<div id="${t.id}" class="tab-content ${t.active ? 'active' : ''}">${t.content}</div>`).join('');
    return `
    <div class="tabs">
      <div class="tab-buttons">${tabButtons}</div>
      <div class="tab-contents">${tabContents}</div>
    </div>
  `;
}
// Routes
export function createRoutes() {
    const routes = {};
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
    // Welcome dashboard with versions and memory status
    routes['/api/welcome'] = (_req, res) => {
        let versionsHtml = '';
        try {
            const versions = getAllVersions();
            for (const v of versions) {
                const mainBadge = v.main ? '<span style="color: var(--ok); margin-left: 4px;">★</span>' : '';
                versionsHtml += `
          <div class="kpi-card" style="cursor: pointer;" hx-get="/api/version/${encodeURIComponent(v.name)}" hx-target="#detail" hx-swap="innerHTML">
            <div class="kpi-label">${v.name}${mainBadge}</div>
            <div class="kpi-value" style="font-size: 18px;">${v.version}</div>
          </div>
        `;
            }
        }
        catch {
            versionsHtml = '<div class="empty">No versions configured</div>';
        }
        // Memory status
        const pending = getPendingMemory();
        let memoryHtml = '';
        if (pending.length === 0) {
            memoryHtml = `
        <div class="kpi-card">
          <div class="kpi-label">Memory</div>
          <div class="kpi-value ok" style="font-size: 18px;">✓ Synced</div>
        </div>
      `;
        }
        else {
            memoryHtml = `
        <div class="kpi-card">
          <div class="kpi-label">Memory</div>
          <div class="kpi-value risk" style="font-size: 18px;">⚠ ${pending.length} pending</div>
          <div style="margin-top: 8px; font-size: 11px; color: var(--text-dim);">
            ${pending.map(p => `<span style="display: inline-block; background: var(--risk-bg); color: var(--risk); padding: 2px 6px; border-radius: 3px; margin: 2px;">${p}</span>`).join('')}
          </div>
        </div>
      `;
        }
        // Quick stats
        const prds = getPrdsData();
        const totalTasks = prds.reduce((acc, p) => acc + p.totalTasks, 0);
        const doneTasks = prds.reduce((acc, p) => acc + p.doneTasks, 0);
        const blockers = getBlockers();
        html(res, `
      <h2 style="font-size: 18px; margin-bottom: 20px; color: var(--text);">Welcome</h2>

      <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text-muted);">Project Status</h3>
      <div class="kpi-grid" style="margin-bottom: 24px;">
        <div class="kpi-card">
          <div class="kpi-label">PRDs</div>
          <div class="kpi-value">${prds.length}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Tasks Done</div>
          <div class="kpi-value">${doneTasks}/${totalTasks}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Blockers</div>
          <div class="kpi-value ${blockers.length > 0 ? 'blocked' : 'ok'}">${blockers.length}</div>
        </div>
        ${memoryHtml}
      </div>

      <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text-muted);">Versions</h3>
      <div class="kpi-grid">
        ${versionsHtml}
      </div>
    `);
    };
    // Tree view with native details/summary
    routes['/api/tree'] = (_req, res) => {
        const prds = getPrdsData();
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
            // Epics
            for (const epic of prd.epics) {
                const epicIcon = epic.status === 'Done' ? '✓' : epic.status === 'Blocked' ? '✗' : '📁';
                const hasNoTasks = epic.tasks.length === 0;
                const epicDone = epic.tasks.filter(t => t.status === 'Done').length;
                const epicTotal = epic.tasks.length;
                const epicProgress = epicTotal > 0 ? Math.round((epicDone / epicTotal) * 100) : 0;
                if (hasNoTasks) {
                    // Epic without tasks - leaf node
                    content += `
            <div class="leaf level-1" hx-get="/api/epic/${epic.id}" hx-target="#detail" hx-swap="innerHTML">
              <span class="node-icon">${epicIcon}</span>
              <span class="node-label"><strong>${epic.id}</strong> ${epic.title}</span>
              <span class="node-badge ${getStatusBadge(epic.status)}">${epic.status}</span>
            </div>
          `;
                }
                else {
                    // Epic with tasks - expandable
                    content += `<details class="level-1">
            <summary hx-get="/api/epic/${epic.id}" hx-target="#detail" hx-swap="innerHTML">
              <span class="node-icon">${epicIcon}</span>
              <span class="node-label"><strong>${epic.id}</strong> ${epic.title}</span>
              <span class="node-badge ${getStatusBadge(epic.status)}">${epicProgress}%</span>
            </summary>`;
                    // Tasks
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
    // PRD list fragment (HTMX) - kept for compatibility
    routes['/api/prds'] = (_req, res) => {
        const prds = getPrdsData();
        let content = '';
        for (const prd of prds) {
            content += `
        <div class="prd-card" hx-get="/api/prd/${prd.id}" hx-target="#detail" hx-swap="innerHTML">
          <div class="prd-header">
            <span class="prd-id">${prd.id}</span>
            <span class="status status-${prd.status.toLowerCase()}">${prd.status}</span>
          </div>
          <div class="prd-title">${prd.title}</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${prd.progress}%"></div>
          </div>
          <div class="prd-stats">${prd.doneTasks}/${prd.totalTasks} tasks • ${prd.epics.length} epics</div>
        </div>
      `;
        }
        if (!content) {
            content = '<div class="empty">No PRDs found</div>';
        }
        html(res, content);
    };
    // Helper to get progress color class
    const getProgressClass = (progress) => {
        if (progress >= 70)
            return 'progress-high';
        if (progress >= 30)
            return 'progress-mid';
        return 'progress-low';
    };
    // Helper to get KPI color class
    const getKpiClass = (value, thresholds) => {
        if (value >= thresholds.ok)
            return 'ok';
        if (value >= thresholds.risk)
            return 'risk';
        return 'blocked';
    };
    // PRD detail fragment
    routes['/api/prd/:id'] = (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        const prdId = url.pathname.split('/').pop();
        const prds = getPrdsData();
        const prd = prds.find(p => p.id === prdId);
        if (!prd) {
            html(res, '<div class="empty">PRD not found</div>', 404);
            return;
        }
        // Calculate KPIs
        const blockedCount = prd.epics.reduce((acc, e) => acc + e.tasks.filter(t => t.status === 'Blocked').length + (e.status === 'Blocked' ? 1 : 0), 0);
        const inProgressCount = prd.epics.reduce((acc, e) => acc + e.tasks.filter(t => t.status === 'In Progress' || t.status === 'WIP').length, 0);
        const readyCount = prd.epics.reduce((acc, e) => acc + e.tasks.filter(t => t.status === 'Ready').length, 0);
        // KPI cards HTML
        const kpiHtml = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Progress</div>
          <div class="kpi-value ${getKpiClass(prd.progress, { ok: 70, risk: 30 })}">${prd.progress}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Tasks Done</div>
          <div class="kpi-value">${prd.doneTasks}/${prd.totalTasks}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">In Progress</div>
          <div class="kpi-value ${inProgressCount > 0 ? 'ok' : ''}">${inProgressCount}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Blocked</div>
          <div class="kpi-value ${blockedCount > 0 ? 'blocked' : 'ok'}">${blockedCount}</div>
        </div>
      </div>
    `;
        let epicsHtml = '';
        for (const epic of prd.epics) {
            const epicDone = epic.tasks.filter(t => t.status === 'Done').length;
            const epicTotal = epic.tasks.length;
            const epicProgress = epicTotal > 0 ? Math.round((epicDone / epicTotal) * 100) : 0;
            const epicProgressClass = getProgressClass(epicProgress);
            // Color epic border based on status
            const epicBorderColor = epic.status === 'Blocked' ? 'var(--blocked)' :
                epic.status === 'Done' ? 'var(--ok)' :
                    epic.status === 'In Progress' ? 'var(--accent)' : 'var(--border)';
            let tasksHtml = '';
            for (const task of epic.tasks) {
                const statusClass = task.status.toLowerCase().replace(/\s+/g, '-');
                tasksHtml += `
          <div class="task-item">
            <span class="task-id">${task.id}</span>
            <span class="task-title">${task.title}</span>
            <span class="status status-${statusClass}">${task.status}</span>
          </div>
        `;
            }
            const statusClass = epic.status.toLowerCase().replace(/\s+/g, '-');
            epicsHtml += `
        <div class="epic-card" style="border-left-color: ${epicBorderColor}">
          <div class="epic-header">
            <span class="epic-id">${epic.id}</span>
            <span class="epic-title">${epic.title}</span>
            <span class="status status-${statusClass}">${epic.status}</span>
          </div>
          <div class="progress-bar progress-sm">
            <div class="progress-fill ${epicProgressClass}" style="width: ${epicProgress}%"></div>
          </div>
          <div class="epic-stats" style="font-size: 11px; color: var(--text-dim); margin-top: 6px;">
            ${epicDone}/${epicTotal} tasks completed
          </div>
          ${tasksHtml ? `<div class="tasks-list">${tasksHtml}</div>` : ''}
        </div>
      `;
        }
        const progressClass = getProgressClass(prd.progress);
        const statusClass = prd.status.toLowerCase().replace(/\s+/g, '-');
        // Stats tab content
        const statsContent = `
      ${kpiHtml}
      <div class="detail-progress">
        <div class="progress-bar progress-lg">
          <div class="progress-fill ${progressClass}" style="width: ${prd.progress}%"></div>
        </div>
        <span class="progress-label">${prd.progress}%</span>
      </div>
      <div class="epics-list">${epicsHtml}</div>
    `;
        // Description tab content
        const descContent = prd.description
            ? `<div class="description-content">${markdownToHtml(prd.description)}</div>`
            : '<div class="empty">No description</div>';
        // Meta tab content
        const metaContent = renderMeta(prd.meta);
        // Memory tab content
        const memoryRaw = getMemoryContent(prd.id, 'prd');
        const memoryContent = memoryRaw
            ? `<div class="description-content">${markdownToHtml(memoryRaw)}</div>`
            : '<div class="empty">No memory</div>';
        // Schema/DAG tab content (with toggle for tasks)
        const dagWithTasks = generatePrdDag(prd, true);
        const dagWithoutTasks = generatePrdDag(prd, false);
        const schemaContent = renderPrdDag(dagWithTasks, dagWithoutTasks);
        // Gantt tab content with critical path
        const { ganttCode, criticalPath } = generatePrdGantt(prd);
        const ganttContent = renderGantt(ganttCode, criticalPath);
        html(res, `
      <div class="detail-header">
        <h2>${prd.id}: ${prd.title}</h2>
        <span class="status status-${statusClass}">${prd.status}</span>
      </div>
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
        const prds = getPrdsData();
        // Find the epic across all PRDs
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
            html(res, '<div class="empty">Epic not found</div>', 404);
            return;
        }
        const epicDone = foundEpic.tasks.filter(t => t.status === 'Done').length;
        const epicTotal = foundEpic.tasks.length;
        const epicProgress = epicTotal > 0 ? Math.round((epicDone / epicTotal) * 100) : 0;
        const progressClass = getProgressClass(epicProgress);
        const statusClass = foundEpic.status.toLowerCase().replace(/\s+/g, '-');
        let tasksHtml = '';
        for (const task of foundEpic.tasks) {
            const taskStatusClass = task.status.toLowerCase().replace(/\s+/g, '-');
            tasksHtml += `
        <div class="task-item" style="padding: 8px 0; border-bottom: 1px solid var(--border);">
          <span class="task-id">${task.id}</span>
          <span class="task-title" style="flex: 1;">${task.title}</span>
          <span class="status status-${taskStatusClass}">${task.status}</span>
        </div>
      `;
        }
        // Stats tab content
        const statsContent = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Progress</div>
          <div class="kpi-value ${getKpiClass(epicProgress, { ok: 70, risk: 30 })}">${epicProgress}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Tasks</div>
          <div class="kpi-value">${epicDone}/${epicTotal}</div>
        </div>
      </div>
      <div class="detail-progress">
        <div class="progress-bar progress-lg">
          <div class="progress-fill ${progressClass}" style="width: ${epicProgress}%"></div>
        </div>
        <span class="progress-label">${epicProgress}%</span>
      </div>
      <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text);">Tasks</h3>
      <div class="tasks-list" style="border-top: none; margin-top: 0; padding-top: 0;">
        ${tasksHtml || '<div class="empty">No tasks</div>'}
      </div>
    `;
        // Description tab content
        const descContent = foundEpic.description
            ? `<div class="description-content">${markdownToHtml(foundEpic.description)}</div>`
            : '<div class="empty">No description</div>';
        // Meta tab content
        const metaContent = renderMeta(foundEpic.meta);
        // Memory tab content
        const memoryRaw = getMemoryContent(foundEpic.id, 'epic');
        const memoryContent = memoryRaw
            ? `<div class="description-content">${markdownToHtml(memoryRaw)}</div>`
            : '<div class="empty">No memory</div>';
        // Schema/DAG tab content
        const dagResult = generateEpicDag(foundEpic, parentPrd);
        const schemaContent = renderDag(dagResult.code, dagResult.tooltips);
        // Gantt tab content with critical path
        const { ganttCode: epicGanttCode, criticalPath: epicCriticalPath } = generateEpicGantt(foundEpic);
        const ganttContent = renderGantt(epicGanttCode, epicCriticalPath);
        html(res, `
      <div class="detail-header">
        <h2>${foundEpic.id}: ${foundEpic.title}</h2>
        <span class="status status-${statusClass}">${foundEpic.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 16px;">
        Part of ${entityLink(parentPrd.id)}: ${parentPrd.title}
      </div>
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
        const prds = getPrdsData();
        // Find the task across all PRDs/epics
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
            if (foundTask)
                break;
        }
        if (!foundTask) {
            html(res, '<div class="empty">Task not found</div>', 404);
            return;
        }
        const statusClass = foundTask.status.toLowerCase().replace(/\s+/g, '-');
        // Stats tab content
        const statsContent = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Status</div>
          <div class="kpi-value">${foundTask.status}</div>
        </div>
      </div>
    `;
        // Description tab content
        const descContent = foundTask.description
            ? `<div class="description-content">${markdownToHtml(foundTask.description)}</div>`
            : '<div class="empty">No description</div>';
        // Meta tab content
        const metaContent = renderMeta(foundTask.meta);
        // Schema/DAG tab content
        const dagResult = generateTaskDag(foundTask, parentEpic, parentPrd);
        const schemaContent = renderDag(dagResult.code, dagResult.tooltips);
        html(res, `
      <div class="detail-header">
        <h2>${foundTask.id}: ${foundTask.title}</h2>
        <span class="status status-${statusClass}">${foundTask.status}</span>
      </div>
      <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 16px;">
        ${parentEpic ? entityLink(parentEpic.id) : ''}: ${parentEpic?.title}<br>
        ${parentPrd ? entityLink(parentPrd.id) : ''}: ${parentPrd?.title}
      </div>
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
                html(res, '<div class="empty">Version not found</div>', 404);
                return;
            }
            html(res, `
        <div class="detail-header">
          <h2>${version.name}</h2>
          <span class="version-badge" style="font-size: 14px;">${version.version}</span>
        </div>
        ${version.main ? '<div style="color: var(--ok); margin-bottom: 12px;">★ Main component</div>' : ''}
      `);
        }
        catch {
            html(res, '<div class="empty">Error loading version</div>', 500);
        }
    };
    // Blockers fragment
    routes['/api/blockers'] = (_req, res) => {
        const blockers = getBlockers();
        let content = '';
        for (const blocker of blockers) {
            content += `
        <div class="blocker-item">
          <span class="blocker-icon">🔴</span>
          <span class="blocker-id">${blocker.id}</span>
          <span class="blocker-title">${blocker.title}</span>
          <span class="blocker-reason">${blocker.reason}</span>
        </div>
      `;
        }
        if (!content) {
            content = '<div class="empty success">No blockers</div>';
        }
        html(res, content);
    };
    // Memory warnings fragment
    routes['/api/memory'] = (_req, res) => {
        const pending = getPendingMemory();
        let content = '';
        if (pending.length > 0) {
            content = `
        <div class="warning-badge">
          <span class="warning-icon">⚠</span>
          <span>${pending.length} pending consolidation${pending.length > 1 ? 's' : ''}</span>
        </div>
        <div class="pending-list">
          ${pending.map(p => `<span class="pending-item">${p}</span>`).join('')}
        </div>
      `;
        }
        else {
            content = '<div class="empty success">Memory synced</div>';
        }
        html(res, content);
    };
    // Versions fragment (max 3 shown)
    routes['/api/versions'] = (_req, res) => {
        try {
            const versions = getAllVersions();
            // Show max 3 versions, prioritize main
            const sorted = [...versions].sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
            const shown = sorted.slice(0, 3);
            let content = '';
            for (const v of shown) {
                const mainBadge = v.main ? '<span class="main-badge">★</span>' : '';
                content += `
          <div class="version-item">
            <span class="version-name">${v.name}${mainBadge}</span>
            <span class="version-number">${v.version}</span>
          </div>
        `;
            }
            if (versions.length > 3) {
                content += `<div class="version-item"><span class="version-name">+${versions.length - 3} more</span></div>`;
            }
            html(res, content || '');
        }
        catch {
            html(res, '');
        }
    };
    // JSON API for raw data
    routes['/api/data'] = (_req, res) => {
        json(res, {
            prds: getPrdsData(),
            blockers: getBlockers(),
            pendingMemory: getPendingMemory()
        });
    };
    // Settings/Config page
    routes['/api/settings'] = (_req, res) => {
        const configInfo = getConfigInfo();
        // Build paths table with details
        let pathsHtml = '';
        for (const [key, info] of Object.entries(configInfo.paths)) {
            const customBadge = info.isCustom ? '<span class="badge-custom">custom</span>' : '';
            pathsHtml += `
        <tr>
          <td class="meta-key">${key} ${customBadge}</td>
          <td class="meta-value">
            <code>${info.path || 'Not set'}</code>
            ${info.configured && info.isCustom ? `<br><small style="color: var(--text-dim);">configured: ${info.configured}</small>` : ''}
          </td>
        </tr>
      `;
        }
        // Build config table with descriptions
        let configHtml = '';
        try {
            const configDisplay = getConfigDisplay();
            for (const item of configDisplay) {
                const defaultBadge = item.isDefault ? '' : '<span class="badge-custom">modified</span>';
                const valueDisplay = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
                configHtml += `
          <tr>
            <td class="meta-key">${item.key} ${defaultBadge}</td>
            <td class="meta-value">
              <code>${valueDisplay}</code>
              <br><small style="color: var(--text-dim);">${item.description}</small>
              ${!item.isDefault ? `<br><small style="color: var(--text-dim);">default: ${item.default}</small>` : ''}
            </td>
          </tr>
        `;
            }
        }
        catch {
            configHtml = '<tr><td colspan="2" class="empty">Error loading config</td></tr>';
        }
        html(res, `
      <div class="detail-header">
        <h2>Settings</h2>
      </div>

      <div class="settings-section">
        <h4>Project</h4>
        <table class="meta-table">
          <tr><td class="meta-key">Project Root</td><td class="meta-value"><code>${configInfo.projectRoot}</code></td></tr>
          <tr><td class="meta-key">Sailing Directory</td><td class="meta-value"><code>${configInfo.sailingDir}</code></td></tr>
          <tr><td class="meta-key">Paths Config</td><td class="meta-value"><code>${configInfo.pathsConfigPath}</code> ${configInfo.pathsConfigExists ? '✓' : '✗'}</td></tr>
        </table>
      </div>

      <div class="settings-section">
        <h4>Paths</h4>
        <table class="meta-table">
          ${pathsHtml}
        </table>
      </div>

      <div class="settings-section">
        <h4>Configuration</h4>
        <table class="meta-table">
          ${configHtml}
        </table>
      </div>
    `);
    };
    return routes;
}
