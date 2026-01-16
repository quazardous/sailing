export function welcomeTemplate(data) {
    const memoryHtml = data.pendingMemory.length === 0
        ? `<div class="kpi-card">
        <div class="kpi-label">Memory</div>
        <div class="kpi-value ok" style="font-size: 18px;">✓ Synced</div>
      </div>`
        : `<div class="kpi-card">
        <div class="kpi-label">Memory</div>
        <div class="kpi-value risk" style="font-size: 18px;">⚠ ${data.pendingMemory.length} pending</div>
        <div style="margin-top: 8px; font-size: 11px; color: var(--text-dim);">
          ${data.pendingMemory.map(p => `<span style="display: inline-block; background: var(--risk-bg); color: var(--risk); padding: 2px 6px; border-radius: 3px; margin: 2px;">${p}</span>`).join('')}
        </div>
      </div>`;
    return `
    <h2 style="font-size: 18px; margin-bottom: 20px; color: var(--text);">Ahoy sailor</h2>

    <h3 style="font-size: 14px; margin-bottom: 12px; color: var(--text-muted);">Project Status</h3>
    <div class="kpi-grid" style="margin-bottom: 24px;">
      <div class="kpi-card">
        <div class="kpi-label">PRDs</div>
        <div class="kpi-value">${data.prdsCount}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Tasks Done</div>
        <div class="kpi-value">${data.doneTasks}/${data.totalTasks}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Blockers</div>
        <div class="kpi-value ${data.blockersCount > 0 ? 'blocked' : 'ok'}">${data.blockersCount}</div>
      </div>
      ${memoryHtml}
    </div>

    ${data.prdGanttHtml}

    <h3 style="font-size: 14px; margin-bottom: 12px; margin-top: 24px; color: var(--text-muted);">Versions</h3>
    <div class="kpi-grid">
      ${data.versionsHtml}
    </div>
  `;
}
export function versionCardTemplate(name, version, isMain) {
    const mainBadge = isMain ? '<span style="color: var(--ok); margin-left: 4px;">★</span>' : '';
    return `
    <div class="kpi-card" style="cursor: pointer;" hx-get="/api/version/${encodeURIComponent(name)}" hx-target="#detail" hx-swap="innerHTML">
      <div class="kpi-label">${name}${mainBadge}</div>
      <div class="kpi-value" style="font-size: 18px;">${version}</div>
    </div>
  `;
}
// ============================================================================
// Tree View
// ============================================================================
export function treeNodeTemplate(type, id, title, status, icon, badge, badgeClass, children) {
    const apiPath = `/api/${type}/${id}`;
    if (type === 'task' || !children) {
        // Leaf node
        const level = type === 'epic' ? 'level-1' : type === 'task' ? 'level-2' : '';
        return `
      <div class="leaf ${level}" hx-get="${apiPath}" hx-target="#detail" hx-swap="innerHTML">
        <span class="node-icon">${icon}</span>
        <span class="node-label"><strong>${id}</strong> ${title}</span>
        <span class="node-badge ${badgeClass}">${badge}</span>
      </div>
    `;
    }
    // Parent node with children
    const level = type === 'epic' ? 'level-1' : '';
    const summaryClass = type === 'prd' ? 'prd-node' : '';
    const openAttr = type === 'prd' ? ' open' : '';
    return `<details class="${level}"${openAttr}>
    <summary class="${summaryClass}" hx-get="${apiPath}" hx-target="#detail" hx-swap="innerHTML">
      <span class="node-icon">${icon}</span>
      <span class="node-label"><strong>${id}</strong> ${title}</span>
      <span class="node-badge ${badgeClass}">${badge}</span>
    </summary>
    ${children}
  </details>`;
}
// ============================================================================
// PRD Views
// ============================================================================
export function prdCardTemplate(prd) {
    return `
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
export function kpiGridTemplate(kpis) {
    return `
    <div class="kpi-grid">
      ${kpis.map(kpi => `
        <div class="kpi-card">
          <div class="kpi-label">${kpi.label}</div>
          <div class="kpi-value ${kpi.colorClass || ''}">${kpi.value}</div>
        </div>
      `).join('')}
    </div>
  `;
}
export function epicCardTemplate(epic) {
    const statusClass = epic.status.toLowerCase().replace(/\s+/g, '-');
    return `
    <div class="epic-card" style="border-left-color: ${epic.borderColor}">
      <div class="epic-header">
        <span class="epic-id">${epic.id}</span>
        <span class="epic-title">${epic.title}</span>
        <span class="status status-${statusClass}">${epic.status}</span>
      </div>
      <div class="progress-bar progress-sm">
        <div class="progress-fill ${epic.progressClass}" style="width: ${epic.progress}%"></div>
      </div>
      <div class="epic-stats" style="font-size: 11px; color: var(--text-dim); margin-top: 6px;">
        ${epic.doneCount}/${epic.totalCount} tasks completed
      </div>
      ${epic.tasksHtml ? `<div class="tasks-list">${epic.tasksHtml}</div>` : ''}
    </div>
  `;
}
export function taskItemTemplate(task) {
    const statusClass = task.status.toLowerCase().replace(/\s+/g, '-');
    return `
    <div class="task-item">
      <span class="task-id">${task.id}</span>
      <span class="task-title">${task.title}</span>
      <span class="status status-${statusClass}">${task.status}</span>
    </div>
  `;
}
export function detailHeaderTemplate(data) {
    const statusClass = data.status.toLowerCase().replace(/\s+/g, '-');
    return `
    <div class="detail-header">
      <h2>${data.id}: ${data.title}</h2>
      <span class="status status-${statusClass}">${data.status}</span>
    </div>
    ${data.parentInfo ? `<div style="font-size: 12px; color: var(--text-dim); margin-bottom: 16px;">${data.parentInfo}</div>` : ''}
  `;
}
export function progressBarTemplate(progress, progressClass, size = 'lg') {
    return `
    <div class="detail-progress">
      <div class="progress-bar progress-${size}">
        <div class="progress-fill ${progressClass}" style="width: ${progress}%"></div>
      </div>
      <span class="progress-label">${progress}%</span>
    </div>
  `;
}
export function taskStatsTemplate(data, formatDate) {
    const rows = [
        { label: 'Status', value: data.status },
        { label: 'Effort', value: data.effort || '-' },
        { label: 'Started', value: formatDate(data.startedAt) },
        { label: 'Done', value: formatDate(data.doneAt) }
    ];
    if (data.priority) {
        rows.push({ label: 'Priority', value: data.priority });
    }
    if (data.assignee) {
        rows.push({ label: 'Assignee', value: data.assignee });
    }
    let html = `
    <table class="stats-table" style="width: 100%; border-collapse: collapse; font-size: 13px;">
      ${rows.map(row => `
        <tr>
          <td style="padding: 6px 12px 6px 0; color: var(--text-dim); width: 100px;">${row.label}</td>
          <td style="padding: 6px 0;">${row.value}</td>
        </tr>
      `).join('')}
  `;
    if (data.blockers.length > 0) {
        html += `
      <tr>
        <td style="padding: 6px 12px 6px 0; color: var(--text-dim); vertical-align: top;">Blocked by</td>
        <td style="padding: 6px 0;">${data.blockers.map(b => `<span class="tag" style="cursor: pointer;" onclick="htmx.ajax('GET', '/api/task/${b}', '#detail')">${b}</span>`).join(' ')}</td>
      </tr>
    `;
    }
    html += '</table>';
    return html;
}
// ============================================================================
// Version Detail
// ============================================================================
export function versionDetailTemplate(name, version, isMain) {
    return `
    <div class="detail-header">
      <h2>${name}</h2>
      <span class="version-badge" style="font-size: 14px;">${version}</span>
    </div>
    ${isMain ? '<div style="color: var(--ok); margin-bottom: 12px;">★ Main component</div>' : ''}
  `;
}
// ============================================================================
// Blockers & Memory
// ============================================================================
export function blockerItemTemplate(blocker) {
    return `
    <div class="blocker-item">
      <span class="blocker-icon">🔴</span>
      <span class="blocker-id">${blocker.id}</span>
      <span class="blocker-title">${blocker.title}</span>
      <span class="blocker-reason">${blocker.reason}</span>
    </div>
  `;
}
export function memoryWarningTemplate(pending) {
    if (pending.length === 0) {
        return '<div class="empty success">Memory synced</div>';
    }
    return `
    <div class="warning-badge">
      <span class="warning-icon">⚠</span>
      <span>${pending.length} pending consolidation${pending.length > 1 ? 's' : ''}</span>
    </div>
    <div class="pending-list">
      ${pending.map(p => `<span class="pending-item">${p}</span>`).join('')}
    </div>
  `;
}
export function versionItemTemplate(name, version, isMain) {
    const mainBadge = isMain ? '<span class="main-badge">★</span>' : '';
    return `
    <div class="version-item">
      <span class="version-name">${name}${mainBadge}</span>
      <span class="version-number">${version}</span>
    </div>
  `;
}
export function settingsTemplate(data) {
    return `
    <div class="detail-header">
      <h2>Settings</h2>
    </div>

    <div class="settings-section">
      <h4>Project</h4>
      <table class="meta-table">
        <tr><td class="meta-key">Project Root</td><td class="meta-value"><code>${data.projectRoot}</code></td></tr>
        <tr><td class="meta-key">Sailing Directory</td><td class="meta-value"><code>${data.sailingDir}</code></td></tr>
        <tr><td class="meta-key">Paths Config</td><td class="meta-value"><code>${data.pathsConfigPath}</code> ${data.pathsConfigExists ? '✓' : '✗'}</td></tr>
      </table>
    </div>

    <div class="settings-section">
      <h4>Paths</h4>
      <table class="meta-table">
        ${data.pathsHtml}
      </table>
    </div>

    <div class="settings-section">
      <h4>Configuration</h4>
      <table class="meta-table">
        ${data.configHtml}
      </table>
    </div>
  `;
}
export function pathRowTemplate(key, path, configured, isCustom) {
    const customBadge = isCustom ? '<span class="badge-custom">custom</span>' : '';
    return `
    <tr>
      <td class="meta-key">${key} ${customBadge}</td>
      <td class="meta-value">
        <code>${path || 'Not set'}</code>
        ${configured && isCustom ? `<br><small style="color: var(--text-dim);">configured: ${configured}</small>` : ''}
      </td>
    </tr>
  `;
}
export function configRowTemplate(key, value, description, defaultValue, isDefault) {
    const defaultBadge = isDefault ? '' : '<span class="badge-custom">modified</span>';
    const valueDisplay = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `
    <tr>
      <td class="meta-key">${key} ${defaultBadge}</td>
      <td class="meta-value">
        <code>${valueDisplay}</code>
        <br><small style="color: var(--text-dim);">${description}</small>
        ${!isDefault ? `<br><small style="color: var(--text-dim);">default: ${defaultValue}</small>` : ''}
      </td>
    </tr>
  `;
}
// ============================================================================
// Empty States
// ============================================================================
export function emptyTemplate(message, success = false) {
    return `<div class="empty ${success ? 'success' : ''}">${message}</div>`;
}
