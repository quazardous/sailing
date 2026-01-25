<script setup lang="ts">
import { computed } from 'vue';
import { useAgentsStore } from '../stores/agents';

const agentsStore = useAgentsStore();

const selectedAgent = computed(() => agentsStore.selectedAgent);

function getStatusColor(status: string): string {
  if (status === 'running') return 'var(--color-warning, #fbbf24)';
  if (status === 'completed') return 'var(--color-success, #34d399)';
  if (status === 'failed') return 'var(--color-error, #f87171)';
  return 'var(--text-dim, #888)';
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString();
}
</script>

<template>
  <div class="panel-container">
    <div class="panel-content">
      <div v-if="!selectedAgent" class="empty-state">
        <div class="empty-state-icon">🤖</div>
        <div>Select an agent to view details</div>
      </div>
      <div v-else class="agent-detail">
        <div class="detail-header">
          <h2 class="agent-id">{{ selectedAgent.taskId }}</h2>
          <span
            class="agent-status"
            :style="{ color: getStatusColor(selectedAgent.status) }"
          >
            {{ selectedAgent.status }}
          </span>
        </div>

        <div class="detail-section">
          <div class="detail-row">
            <span class="detail-label">Started</span>
            <span class="detail-value">{{ formatDate(selectedAgent.startedAt) }}</span>
          </div>
          <div v-if="selectedAgent.completedAt" class="detail-row">
            <span class="detail-label">Completed</span>
            <span class="detail-value">{{ formatDate(selectedAgent.completedAt) }}</span>
          </div>
          <div v-if="selectedAgent.exitCode !== undefined" class="detail-row">
            <span class="detail-label">Exit Code</span>
            <span class="detail-value">{{ selectedAgent.exitCode }}</span>
          </div>
        </div>
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

.panel-content {
  flex: 1;
  overflow: auto;
  padding: var(--spacing-md, 12px);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-dim, #888);
  gap: 8px;
}

.empty-state-icon {
  font-size: 48px;
  opacity: 0.5;
}

.agent-detail {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg, 20px);
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--spacing-md, 12px);
  border-bottom: 1px solid var(--border, #333);
}

.agent-id {
  font-size: 18px;
  font-weight: 600;
  color: var(--text, #fff);
  margin: 0;
}

.agent-status {
  font-size: 13px;
  font-weight: 500;
  text-transform: capitalize;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-secondary, #252526);
  border-radius: var(--radius-md, 6px);
}

.detail-label {
  color: var(--text-dim, #888);
  font-size: 13px;
}

.detail-value {
  color: var(--text, #fff);
  font-size: 13px;
}
</style>
