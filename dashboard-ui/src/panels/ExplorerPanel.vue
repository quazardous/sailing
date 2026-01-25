<script setup lang="ts">
import { computed } from 'vue';
import { useArtefactsStore } from '../stores/artefacts';
import TreeView, { type TreeNodeData } from '../components/TreeView.vue';

// Dockview panel props (optional, but good practice)
defineProps<{
  params?: Record<string, unknown>;
}>();

const artefactsStore = useArtefactsStore();

const prds = computed(() => artefactsStore.prds);
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
    children: prd.epics.map(epic => ({
      id: epic.id,
      label: epic.id,
      secondaryLabel: epic.title,
      icon: getIcon('epic', epic.status),
      iconColor: getIconColor(epic.status),
      status: getStatusVariant(epic.status),
      data: { type: 'epic' },
      children: epic.tasks.map(task => ({
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

function handleRefresh() {
  artefactsStore.refresh();
}
</script>

<template>
  <div class="panel-container">
    <div class="panel-header">
      <span class="panel-title">Explorer</span>
      <button class="refresh-btn" @click="handleRefresh" :disabled="loading" title="Refresh">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          :class="{ spinning: loading }"
        >
          <path
            d="M13.65 2.35A7 7 0 1 0 15 8h-2a5 5 0 1 1-1.05-3.05L10 7h5V2l-1.35.35z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
    <div class="panel-content">
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
          :default-expanded="true"
          @select="handleSelect"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--border);
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
}

.refresh-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.refresh-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text);
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

.panel-content {
  flex: 1;
  overflow: auto;
}

.tree-container {
  padding: var(--spacing-xs) 0;
}
</style>
