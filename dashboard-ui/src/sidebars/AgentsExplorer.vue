<script setup lang="ts">
import { computed } from 'vue';
import { useAgentsStore } from '../stores/agents';

const agentsStore = useAgentsStore();

const runningAgents = computed(() => agentsStore.runningAgents);
const completedAgents = computed(() => agentsStore.completedAgents);
const loading = computed(() => agentsStore.loading);

function handleRefresh() {
  agentsStore.refresh();
}

function selectAgent(taskId: string) {
  agentsStore.selectAgent(taskId);
}

function getStatusIcon(status: string): string {
  if (status === 'running') return '▶';
  if (status === 'completed') return '✓';
  if (status === 'failed') return '✗';
  return '○';
}

function getStatusColor(status: string): string {
  if (status === 'running') return 'var(--color-warning, #fbbf24)';
  if (status === 'completed') return 'var(--color-success, #34d399)';
  if (status === 'failed') return 'var(--color-error, #f87171)';
  return 'var(--text-dim, #888)';
}
</script>

<template>
  <div class="sidebar-container">
    <div class="sidebar-header">
      <span class="sidebar-title">Agents</span>
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
      <!-- Running agents -->
      <div v-if="runningAgents.length > 0" class="section">
        <div class="section-header">
          <span class="section-title">Running</span>
          <span class="section-count">{{ runningAgents.length }}</span>
        </div>
        <div class="agent-list">
          <div
            v-for="agent in runningAgents"
            :key="agent.taskId"
            class="agent-item"
            @click="selectAgent(agent.taskId)"
          >
            <span class="agent-status" :style="{ color: getStatusColor(agent.status) }">
              {{ getStatusIcon(agent.status) }}
            </span>
            <span class="agent-id">{{ agent.taskId }}</span>
          </div>
        </div>
      </div>

      <!-- Completed agents -->
      <div v-if="completedAgents.length > 0" class="section">
        <div class="section-header">
          <span class="section-title">Completed</span>
          <span class="section-count">{{ completedAgents.length }}</span>
        </div>
        <div class="agent-list">
          <div
            v-for="agent in completedAgents"
            :key="agent.taskId"
            class="agent-item"
            @click="selectAgent(agent.taskId)"
          >
            <span class="agent-status" :style="{ color: getStatusColor(agent.status) }">
              {{ getStatusIcon(agent.status) }}
            </span>
            <span class="agent-id">{{ agent.taskId }}</span>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="runningAgents.length === 0 && completedAgents.length === 0" class="empty-state">
        <div class="empty-state-icon">🤖</div>
        <div>No agents</div>
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
  padding: var(--spacing-sm, 8px) 0;
}

.section {
  margin-bottom: var(--spacing-md, 12px);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px var(--spacing-md, 12px);
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-dim, #888);
}

.section-count {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.1));
  color: var(--text-dim, #888);
}

.agent-list {
  display: flex;
  flex-direction: column;
}

.agent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px var(--spacing-md, 12px);
  cursor: pointer;
  transition: background-color 0.15s;
}

.agent-item:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.05));
}

.agent-status {
  font-size: 12px;
  width: 16px;
  text-align: center;
}

.agent-id {
  font-size: 13px;
  color: var(--text, #fff);
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
