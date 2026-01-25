<script setup lang="ts">
import { ref, onMounted } from 'vue';
import OverviewGantt from '../components/OverviewGantt.vue';

interface SimpleGanttTask {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  durationHours: number;
  status: string;
  progress: number;
  criticalTimespanHours?: number;
}

interface OverviewGanttData {
  tasks: SimpleGanttTask[];
  totalHours: number;
  t0: string;
}

const overviewGantt = ref<OverviewGanttData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

async function fetchOverviewGantt() {
  loading.value = true;
  error.value = null;
  try {
    const response = await fetch('/api/v2/overview/gantt');
    if (response.ok) {
      overviewGantt.value = await response.json();
    } else {
      error.value = 'Failed to load PRD overview';
    }
  } catch (e) {
    error.value = 'Network error';
    console.error('Failed to fetch overview gantt:', e);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchOverviewGantt();
});
</script>

<template>
  <div class="panel-container">
    <div class="panel-header">
      <h2>PRD Timeline Overview</h2>
      <button class="refresh-btn" @click="fetchOverviewGantt" :disabled="loading">
        {{ loading ? 'Loading...' : 'Refresh' }}
      </button>
    </div>

    <div class="panel-content">
      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>Loading PRD overview...</span>
      </div>

      <div v-else-if="error" class="error-state">
        <span class="error-icon">!</span>
        <span>{{ error }}</span>
        <button @click="fetchOverviewGantt">Retry</button>
      </div>

      <div v-else-if="!overviewGantt || overviewGantt.tasks.length === 0" class="empty-state">
        <div class="empty-state-icon">📊</div>
        <div>No PRDs with scheduled tasks</div>
      </div>

      <div v-else class="gantt-container">
        <OverviewGantt :data="overviewGantt" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg, #1e1e1e);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md, 12px);
  border-bottom: 1px solid var(--border, #333);
}

.panel-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #fff);
}

.refresh-btn {
  padding: 4px 12px;
  background: var(--bg-tertiary, #333);
  border: 1px solid var(--border, #444);
  border-radius: var(--radius-sm, 4px);
  color: var(--text-dim, #888);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-secondary, #2a2a2a);
  color: var(--text, #fff);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.panel-content {
  flex: 1;
  overflow: auto;
  padding: var(--spacing-md, 12px);
}

.gantt-container {
  min-height: 100px;
}

.loading-state,
.error-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  gap: 12px;
  color: var(--text-dim, #888);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border, #333);
  border-top-color: var(--accent, #4fc3f7);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  color: #EF4444;
}

.error-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: #EF4444;
  color: white;
  border-radius: 50%;
  font-weight: bold;
}

.error-state button {
  margin-top: 8px;
  padding: 6px 16px;
  background: var(--accent, #4fc3f7);
  border: none;
  border-radius: var(--radius-sm, 4px);
  color: white;
  cursor: pointer;
}

.empty-state-icon {
  font-size: 48px;
  opacity: 0.5;
}
</style>
