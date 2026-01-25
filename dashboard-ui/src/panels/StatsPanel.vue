<script setup lang="ts">
import { computed } from 'vue';
import { useArtefactsStore } from '../stores/artefacts';
import StatusBadge from '../components/StatusBadge.vue';
import ProgressBar from '../components/ProgressBar.vue';
import type { PrdData, EpicData } from '../api';

const artefactsStore = useArtefactsStore();

const selectedArtefact = computed(() => artefactsStore.selectedArtefact);
const selectedType = computed(() => artefactsStore.selectedType);
const loading = computed(() => artefactsStore.loading);

const prdData = computed(() => {
  if (selectedType.value === 'prd' && selectedArtefact.value) {
    return selectedArtefact.value.data as PrdData;
  }
  return null;
});

const epicData = computed(() => {
  if (selectedType.value === 'epic' && selectedArtefact.value) {
    return selectedArtefact.value.data as EpicData;
  }
  return null;
});

const taskData = computed(() => {
  if (selectedType.value === 'task' && selectedArtefact.value) {
    return selectedArtefact.value.data;
  }
  return null;
});

function calculateEpicProgress(epic: EpicData): number {
  if (epic.tasks.length === 0) return 0;
  const done = epic.tasks.filter(t => t.status === 'Done').length;
  return Math.round((done / epic.tasks.length) * 100);
}
</script>

<template>
  <div class="panel-container">
    <template v-if="loading && !selectedArtefact">
      <div class="loading">
        <div class="spinner"></div>
      </div>
    </template>

    <template v-else-if="!selectedArtefact">
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <div>Select an item to view stats</div>
      </div>
    </template>

    <template v-else>
      <div class="stats-content">
        <!-- PRD Stats -->
        <template v-if="prdData">
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-value" :class="prdData.progress >= 70 ? 'ok' : prdData.progress < 30 ? 'risk' : ''">
                {{ prdData.progress }}%
              </div>
              <div class="kpi-label">Progress</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-value">{{ prdData.doneTasks }}/{{ prdData.totalTasks }}</div>
              <div class="kpi-label">Tasks Done</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-value">{{ prdData.epics.length }}</div>
              <div class="kpi-label">Epics</div>
            </div>
          </div>
          <ProgressBar :value="prdData.progress" size="lg" />

          <h3 class="section-title">Epics</h3>
          <div class="epics-list">
            <div
              v-for="epic in prdData.epics"
              :key="epic.id"
              class="epic-card"
              @click="artefactsStore.selectArtefact(epic.id)"
            >
              <div class="epic-header">
                <StatusBadge :status="epic.status" />
                <strong>{{ epic.id }}</strong>
                <span>{{ epic.title }}</span>
              </div>
              <ProgressBar :value="calculateEpicProgress(epic)" size="sm" />
              <div class="epic-tasks-count">{{ epic.tasks.length }} tasks</div>
            </div>
          </div>
        </template>

        <!-- Epic Stats -->
        <template v-else-if="epicData">
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-value">{{ calculateEpicProgress(epicData) }}%</div>
              <div class="kpi-label">Progress</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-value">{{ epicData.tasks.length }}</div>
              <div class="kpi-label">Tasks</div>
            </div>
          </div>
          <ProgressBar :value="calculateEpicProgress(epicData)" size="lg" />

          <h3 class="section-title">Tasks</h3>
          <div class="tasks-list">
            <div
              v-for="task in epicData.tasks"
              :key="task.id"
              class="task-item"
              @click="artefactsStore.selectArtefact(task.id)"
            >
              <StatusBadge :status="task.status" />
              <strong>{{ task.id }}</strong>
              <span>{{ task.title }}</span>
            </div>
          </div>
        </template>

        <!-- Task Stats -->
        <template v-else-if="taskData">
          <div class="task-stats">
            <div class="stat-row">
              <span class="stat-label">Status:</span>
              <StatusBadge :status="taskData.status" />
            </div>
            <div v-if="taskData.meta?.effort" class="stat-row">
              <span class="stat-label">Effort:</span>
              <span>{{ taskData.meta.effort }}</span>
            </div>
            <div v-if="taskData.meta?.assignee" class="stat-row">
              <span class="stat-label">Assignee:</span>
              <span>{{ taskData.meta.assignee }}</span>
            </div>
            <div v-if="taskData.meta?.priority" class="stat-row">
              <span class="stat-label">Priority:</span>
              <span>{{ taskData.meta.priority }}</span>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stats-content {
  padding: var(--spacing-md);
}

.section-title {
  font-size: var(--font-size-base);
  margin: var(--spacing-lg) 0 var(--spacing-md) 0;
  color: var(--text);
}

.epics-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.epic-card {
  padding: var(--spacing-md);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 0.15s;
}

.epic-card:hover {
  border-color: var(--accent);
}

.epic-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.epic-tasks-count {
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--text-dim);
}

.tasks-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.task-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}

.task-item:hover {
  background: var(--bg-tertiary);
}

.task-stats {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.stat-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.stat-label {
  color: var(--text-dim);
  min-width: 80px;
}
</style>
