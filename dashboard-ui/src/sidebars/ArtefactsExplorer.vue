<script setup lang="ts">
import { computed, watch } from 'vue';
import { useArtefactsStore } from '../stores/artefacts';
import { useNotificationsStore } from '../stores/notifications';
import { useTreeStateStore } from '../stores/treeState';
import TreeView, { type TreeNodeData } from '../components/TreeView.vue';

const artefactsStore = useArtefactsStore();
const notificationsStore = useNotificationsStore();
const treeStateStore = useTreeStateStore();

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
      data: { type: 'epic' },
      children: (epic.tasks || []).map(task => ({
        id: task.id,
        label: task.id,
        secondaryLabel: task.title,
        icon: getIcon('task', task.status),
        iconColor: getIconColor(task.status),
        status: getStatusVariant(task.status),
        data: { type: 'task' },
      })),
    })),
  }));
});

function getIcon(type: 'prd' | 'epic' | 'task', status: string): string {
  if (status === 'Done') return '✓';
  if (status === 'Blocked') return '⊘';
  if (status === 'In Progress' || status === 'WIP') return '◐';
  if (type === 'prd') return '◎';
  if (type === 'epic') return '◉';
  return '○';
}

function getIconColor(status: string): string {
  if (status === 'Done') return 'green';
  if (status === 'Blocked') return 'red';
  if (status === 'In Progress' || status === 'WIP') return 'yellow';
  return 'gray';
}

function getStatusVariant(status: string): TreeNodeData['status'] {
  if (status === 'Done') return 'success';
  if (status === 'Blocked') return 'error';
  if (status === 'In Progress' || status === 'WIP') return 'active';
  return 'default';
}

function getBadgeVariant(progress: number): TreeNodeData['badgeVariant'] {
  if (progress >= 80) return 'success';
  if (progress >= 50) return 'info';
  if (progress > 0) return 'warning';
  return 'default';
}

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
      <button class="refresh-btn" @click="handleRefresh" :disabled="loading" title="Refresh">
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
          :nodes="treeNodes"
          :selected-id="selectedId"
          :expanded-ids="expandedIds"
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

.refresh-btn {
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

.refresh-btn:hover {
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.1));
  color: var(--text, #fff);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn svg.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
