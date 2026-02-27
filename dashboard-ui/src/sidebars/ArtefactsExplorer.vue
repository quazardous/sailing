<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useArtefactsStore } from '../stores/artefacts';
import { useNotificationsStore } from '../stores/notifications';
import { useTreeStateStore } from '../stores/treeState';
import TreeView, { type TreeNodeData } from '../components/TreeView.vue';

const artefactsStore = useArtefactsStore();
const notificationsStore = useNotificationsStore();
const treeStateStore = useTreeStateStore();
const filterText = ref('');
const debouncedFilter = ref('');
const followMode = ref(true);
let filterTimer: ReturnType<typeof setTimeout> | null = null;
watch(filterText, (val) => {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { debouncedFilter.value = val; }, 200);
});

const prds = computed(() => artefactsStore.prds);

// Reactive set of new artefacts (triggers re-render when notifications change)
const newArtefactsSet = computed(() => notificationsStore.newArtefacts);

// Expanded state from store
const expandedIds = computed(() => treeStateStore.expandedIds);

// Auto-expand all PRDs/Epics on first load if no saved state
watch(prds, (newPrds) => {
  if (!treeStateStore.initialized || treeStateStore.expandedIds.size > 0) return;
  // First load with no saved state - expand all folders
  const allFolderIds: string[] = [];
  for (const prd of newPrds) {
    allFolderIds.push(prd.id);
    for (const epic of (prd.epics || [])) {
      allFolderIds.push(epic.id);
    }
  }
  if (allFolderIds.length > 0) {
    treeStateStore.expandAll(allFolderIds);
  }
}, { immediate: true });

// Check if artefact is new (updated but not viewed)
function isNewArtefact(id: string): boolean {
  return newArtefactsSet.value.has(id);
}
const loading = computed(() => artefactsStore.loading);
const selectedId = computed(() => artefactsStore.selectedId);

// Transform PRD data to generic TreeNodeData format
const treeNodes = computed<TreeNodeData[]>(() => {
  return prds.value.map(prd => ({
    id: prd.id,
    label: prd.id,
    secondaryLabel: prd.title,
    icon: getIcon('prd', prd.status),
    iconColor: getIconColor(prd.status),
    status: getStatusVariant(prd.status),
    statusText: prd.status,
    badge: `${prd.progress}%`,
    badgeVariant: getBadgeVariant(prd.progress),
    data: { type: 'prd' },
    children: (prd.epics || []).map(epic => ({
      id: epic.id,
      label: epic.id,
      secondaryLabel: epic.title,
      icon: getIcon('epic', epic.status),
      iconColor: getIconColor(epic.status),
      status: getStatusVariant(epic.status),
      statusText: epic.status,
      data: { type: 'epic' },
      children: (epic.tasks || []).map(task => ({
        id: task.id,
        label: task.id,
        secondaryLabel: task.title,
        icon: getIcon('task', task.status),
        iconColor: getIconColor(task.status),
        status: getStatusVariant(task.status),
        statusText: task.status,
        data: { type: 'task' },
      })),
    })),
  }));
});

function getIcon(_type: 'prd' | 'epic' | 'task', status: string): string {
  switch (status) {
    case 'Done': return '✓';
    case 'Blocked': return '⊘';
    case 'In Progress':
    case 'WIP': return '◔';
    case 'Cancelled': return '✕';
    case 'Draft': return '◇';
    case 'In Review': return '◈';
    case 'Approved': return '◆';
    case 'Auto-Done': return '◉';
    default: return '○'; // Not Started
  }
}

function getIconColor(status: string): string {
  switch (status) {
    case 'Done': return 'green';
    case 'Blocked': return 'orange';
    default: return 'gray';
  }
}

function getStatusVariant(status: string): TreeNodeData['status'] {
  switch (status) {
    case 'Done': return 'success';
    case 'Blocked': return 'error';
    case 'In Progress':
    case 'WIP': return 'active';
    case 'Draft': return 'draft';
    case 'In Review': return 'review';
    case 'Approved': return 'approved';
    case 'Cancelled': return 'cancelled';
    case 'Auto-Done': return 'auto-done';
    default: return 'default';
  }
}

function getBadgeVariant(progress: number): TreeNodeData['badgeVariant'] {
  if (progress >= 80) return 'success';
  if (progress >= 50) return 'info';
  if (progress > 0) return 'warning';
  return 'default';
}

// Filter: match node id or title, keep parents of matches
function nodeMatches(node: TreeNodeData, query: string): boolean {
  const q = query.toLowerCase();
  return node.id.toLowerCase().includes(q)
    || (node.secondaryLabel || '').toLowerCase().includes(q)
    || (node.statusText || '').toLowerCase().includes(q);
}

function filterTree(nodes: TreeNodeData[], query: string): { filtered: TreeNodeData[], expandIds: Set<string> } {
  const expandIds = new Set<string>();
  function walk(nodes: TreeNodeData[]): TreeNodeData[] {
    return nodes.reduce<TreeNodeData[]>((acc, node) => {
      const childResult = node.children ? walk(node.children) : [];
      const selfMatch = nodeMatches(node, query);
      if (selfMatch || childResult.length > 0) {
        if (childResult.length > 0) expandIds.add(node.id);
        acc.push({ ...node, children: childResult.length > 0 ? childResult : node.children });
      }
      return acc;
    }, []);
  }
  return { filtered: walk(nodes), expandIds };
}

const filteredResult = computed(() => {
  if (!debouncedFilter.value.trim()) return null;
  return filterTree(treeNodes.value, debouncedFilter.value.trim());
});

const displayNodes = computed(() => filteredResult.value?.filtered ?? treeNodes.value);
const displayExpandedIds = computed(() => filteredResult.value?.expandIds ?? expandedIds.value);

// Follow mode: expand path to selected artefact
function getPathToNode(nodes: TreeNodeData[], targetId: string, path: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return path;
    if (node.children) {
      const found = getPathToNode(node.children, targetId, [...path, node.id]);
      if (found) return found;
    }
  }
  return null;
}

watch(selectedId, (id) => {
  if (!followMode.value || !id) return;
  const path = getPathToNode(treeNodes.value, id);
  if (path && path.length > 0) {
    treeStateStore.expandAll(path);
  }
});

function handleSelect(node: TreeNodeData) {
  artefactsStore.selectArtefact(node.id);
}

function handleToggle(id: string) {
  treeStateStore.toggle(id);
}

function handleRefresh() {
  artefactsStore.refresh();
}
</script>

<template>
  <div class="sidebar-container">
    <div class="sidebar-header">
      <span class="sidebar-title">Explorer</span>
      <div class="header-actions">
        <button
          class="header-btn"
          :class="{ active: followMode }"
          @click="followMode = !followMode"
          title="Follow selection"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v4" /><path d="M12 18v4" />
            <path d="M4.93 4.93l2.83 2.83" /><path d="M16.24 16.24l2.83 2.83" />
            <path d="M2 12h4" /><path d="M18 12h4" />
            <path d="M4.93 19.07l2.83-2.83" /><path d="M16.24 7.76l2.83-2.83" />
          </svg>
        </button>
        <button class="header-btn" @click="handleRefresh" :disabled="loading" title="Refresh">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          :class="{ spinning: loading }"
        >
          <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
          <path d="M21 21v-5h-5" />
        </svg>
      </button>
      </div>
    </div>
    <div v-if="prds.length > 0" class="filter-row">
      <input
        v-model="filterText"
        type="text"
        class="filter-input"
        placeholder="Filter..."
        spellcheck="false"
      />
      <button v-if="filterText" class="filter-clear" @click="filterText = ''" title="Clear">&times;</button>
    </div>
    <div class="sidebar-content">
      <div v-if="loading && prds.length === 0" class="loading">
        <div class="spinner"></div>
      </div>
      <div v-else-if="prds.length === 0" class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div>No PRDs found</div>
      </div>
      <div v-else class="tree-container">
        <TreeView
          :nodes="displayNodes"
          :selected-id="selectedId"
          :expanded-ids="displayExpandedIds"
          :is-new-fn="isNewArtefact"
          @select="handleSelect"
          @toggle="handleToggle"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg, #252526);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm, 8px) var(--spacing-md, 12px);
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim, #888);
}

.header-actions {
  display: flex;
  gap: 2px;
}

.header-btn {
  background: none;
  border: none;
  color: var(--text-dim, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm, 4px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.header-btn:hover {
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.1));
  color: var(--text, #fff);
}

.header-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-btn.active {
  color: var(--accent, #0078d4);
}

.header-btn svg.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.filter-row {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border, #333);
  flex-shrink: 0;
  position: relative;
}

.filter-input {
  width: 100%;
  background: var(--bg-tertiary, #3c3c3c);
  border: 1px solid var(--border, #333);
  border-radius: var(--radius-sm, 4px);
  color: var(--text, #fff);
  font-size: 12px;
  padding: 3px 22px 3px 6px;
  outline: none;
}

.filter-input:focus {
  border-color: var(--accent, #0078d4);
}

.filter-input::placeholder {
  color: var(--text-dim, #888);
}

.filter-clear {
  position: absolute;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-dim, #888);
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
  line-height: 1;
}

.filter-clear:hover {
  color: var(--text, #fff);
}

.sidebar-content {
  flex: 1;
  overflow: auto;
}

.tree-container {
  padding: var(--spacing-xs, 4px) 0;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border, #333);
  border-top-color: var(--accent, #0078d4);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 150px;
  color: var(--text-dim, #888);
  gap: 8px;
}

.empty-state-icon {
  font-size: 32px;
  opacity: 0.5;
}
</style>
