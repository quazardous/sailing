/**
 * Dashboard render helpers
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find views directory (works in both dev and dist)
 */
export function getViewsDir(): string {
  // Try dist location first (dashboard/views from dashboard/lib)
  const distViews = path.join(__dirname, '..', 'views');
  if (fs.existsSync(distViews)) return distViews;

  // Try source location (cli/dashboard/views from dist/cli/dashboard/lib)
  const srcViews = path.resolve(__dirname, '../../../cli/dashboard/views');
  if (fs.existsSync(srcViews)) return srcViews;

  // Fallback
  return distViews;
}

/**
 * Load HTML template
 */
export function loadView(name: string): string {
  const viewPath = path.join(getViewsDir(), `${name}.html`);
  return fs.readFileSync(viewPath, 'utf8');
}

/**
 * Simple {{var}} replacement
 */
export function render(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = data[key];
    return value !== undefined ? String(value) : '';
  });
}

/**
 * Get status badge CSS class
 */
export function getStatusBadge(status: string): string {
  const s = status.toLowerCase();
  if (s === 'done' || s === 'approved' || s === 'ready') return 'badge-ok';
  if (s === 'blocked') return 'badge-blocked';
  if (s === 'review' || s === 'in progress' || s === 'wip') return 'badge-wip';
  return 'badge-draft';
}

/**
 * Get status class for DAG
 */
export function getStatusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'done' || s === 'auto-done') return 'done';
  if (s === 'blocked') return 'blocked';
  if (s === 'in progress' || s === 'wip') return 'wip';
  if (s === 'ready') return 'ready';
  return '';
}

/**
 * Markdown to HTML converter with entity linking
 */
export function markdownToHtml(md: string): string {
  if (!md) return '';
  const html = marked.parse(md) as string;
  return html.replace(/(?<!["'>])(PRD-\d+|E\d{4,}|T\d{4,})(?![^<]*<\/a>)/g, (match) => entityLink(match));
}

/**
 * Create clickable link for entity
 */
export function entityLink(id: string): string {
  if (id.includes('/')) {
    const parts = id.split('/').map(p => p.trim());
    return parts.map(p => entityLink(p)).join(' / ');
  }

  let apiPath = '';
  if (id.startsWith('PRD-')) {
    apiPath = `/api/prd/${id}`;
  } else if (id.startsWith('E') && /^E\d+/.test(id)) {
    apiPath = `/api/epic/${id}`;
  } else if (id.startsWith('T') && /^T\d+/.test(id)) {
    apiPath = `/api/task/${id}`;
  } else {
    return `<span>${id}</span>`;
  }
  return `<a href="#" class="entity-link" hx-get="${apiPath}" hx-target="#detail" hx-swap="innerHTML">${id}</a>`;
}

/**
 * Render metadata as HTML table
 */
export function renderMeta(meta: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '<div class="empty">No metadata</div>';
  const rows = Object.entries(meta)
    .filter(([key]) => !['id', 'title', 'status'].includes(key))
    .map(([key, value]) => {
      let displayValue: string;
      if (typeof value === 'object' && value !== null) {
        displayValue = JSON.stringify(value, null, 2);
      } else {
        displayValue = String(value);
      }
      if (/PRD-\d+|E\d{4,}|T\d{4,}/.test(displayValue)) {
        displayValue = displayValue.replace(/(PRD-\d+|E\d{4,}|T\d{4,})/g, (match) => entityLink(match));
        return `<tr><td class="meta-key">${key}</td><td class="meta-value">${displayValue}</td></tr>`;
      }
      return `<tr><td class="meta-key">${key}</td><td class="meta-value"><code>${displayValue}</code></td></tr>`;
    }).join('');
  if (!rows) return '<div class="empty">No additional metadata</div>';
  return `<table class="meta-table">${rows}</table>`;
}

/**
 * Render graph/relations as HTML
 */
export function renderGraph(meta: Record<string, unknown>, entityType: 'prd' | 'epic' | 'task'): string {
  const sections: string[] = [];

  if (meta.parent) {
    sections.push(`
      <div class="graph-section">
        <h4>Parent</h4>
        <div class="graph-item parent">${entityLink(meta.parent as string)}</div>
      </div>
    `);
  }

  if (entityType === 'prd' && meta.epics) {
    const epics = Array.isArray(meta.epics) ? meta.epics : [];
    if (epics.length > 0) {
      sections.push(`
        <div class="graph-section">
          <h4>Children (Epics)</h4>
          ${epics.map((e: string) => `<div class="graph-item child">${entityLink(e)}</div>`).join('')}
        </div>
      `);
    }
  }

  if (meta.blocked_by) {
    const blockers = Array.isArray(meta.blocked_by) ? meta.blocked_by : [meta.blocked_by];
    if (blockers.length > 0) {
      sections.push(`
        <div class="graph-section">
          <h4>Blocked By</h4>
          ${blockers.map((b: string) => `<div class="graph-item blocker">${entityLink(b)}</div>`).join('')}
        </div>
      `);
    }
  }

  if (meta.stories) {
    const stories = Array.isArray(meta.stories) ? meta.stories : [meta.stories];
    if (stories.length > 0) {
      sections.push(`
        <div class="graph-section">
          <h4>Stories</h4>
          ${stories.map((s: string) => `<div class="graph-item story">${s}</div>`).join('')}
        </div>
      `);
    }
  }

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

/**
 * Render tabs with content
 */
export function renderTabs(tabs: Array<{ id: string; label: string; content: string; active?: boolean }>): string {
  const tabButtons = tabs.map(t =>
    `<button class="tab-btn ${t.active ? 'active' : ''}" onclick="switchTab(this, '${t.id}')">${t.label}</button>`
  ).join('');

  const tabContents = tabs.map(t =>
    `<div id="${t.id}" class="tab-content ${t.active ? 'active' : ''}">${t.content}</div>`
  ).join('');

  return `
    <div class="tabs">
      <div class="tab-buttons">${tabButtons}</div>
      <div class="tab-contents">${tabContents}</div>
    </div>
  `;
}

/**
 * Get progress color class
 */
export function getProgressClass(progress: number): string {
  if (progress >= 70) return 'progress-high';
  if (progress >= 30) return 'progress-mid';
  return 'progress-low';
}

/**
 * Get KPI color class
 */
export function getKpiClass(value: number, thresholds: { ok: number; risk: number }): string {
  if (value >= thresholds.ok) return 'ok';
  if (value >= thresholds.risk) return 'risk';
  return 'blocked';
}
