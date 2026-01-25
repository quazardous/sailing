<script setup lang="ts">
import { computed } from 'vue';
import { useAgentsStore } from '../stores/agents';

const agentsStore = useAgentsStore();

const agents = computed(() => agentsStore.agents);
const runningAgents = computed(() => agentsStore.runningAgents);
const completedAgents = computed(() => agentsStore.completedAgents);
const failedAgents = computed(() => agentsStore.failedAgents);
const selectedTaskId = computed(() => agentsStore.selectedTaskId);
const connected = computed(() => agentsStore.connected);
const loading = computed(() => agentsStore.loading);

function selectAgent(taskId: string) {
  agentsStore.selectAgent(selectedTaskId.value === taskId ? null : taskId);
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

function formatTime(iso?: string): string {
  if (!iso) return '-';
  const date = new Date(iso);
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function refresh() {
  agentsStore.fetchAgents();
}
</script>

<template>
  <div class="panel-container">
    <div class="panel-header">
      <span>Agents</span>
      <div class="header-actions">
        <span class="connection-status" :class="{ connected }">
          {{ connected ? '●' : '○' }}
        </span>
        <button class="refresh-btn" @click="refresh" :disabled="loading">
          {{ loading ? '...' : '↻' }}
        </button>
      </div>
    </div>

    <div class="panel-content">
      <div v-if="loading && agents.length === 0" class="loading">
        <div class="spinner"></div>
      </div>

      <div v-else-if="agents.length === 0" class="empty-state">
        <div class="empty-state-icon">🤖</div>
        <div>No agents running</div>
      </div>

      <template v-else>
        <!-- Running Agents -->
        <div v-if="runningAgents.length > 0" class="agents-section">
          <h3 class="section-title">Running ({{ runningAgents.length }})</h3>
          <div
            v-for="agent in runningAgents"
            :key="agent.taskId"
            class="agent-item"
            :class="{ selected: selectedTaskId === agent.taskId }"
            @click="selectAgent(agent.taskId)"
          >
            <div class="agent-status" :class="getStatusClass(agent.status)"></div>
            <div class="agent-info">
              <div class="agent-task-id">{{ agent.taskId }}</div>
              <div class="agent-time">Started: {{ formatTime(agent.startedAt) }}</div>
            </div>
          </div>
        </div>

        <!-- Completed Agents -->
        <div v-if="completedAgents.length > 0" class="agents-section">
          <h3 class="section-title">Completed ({{ completedAgents.length }})</h3>
          <div
            v-for="agent in completedAgents"
            :key="agent.taskId"
            class="agent-item"
            :class="{ selected: selectedTaskId === agent.taskId }"
            @click="selectAgent(agent.taskId)"
          >
            <div class="agent-status" :class="getStatusClass(agent.status)"></div>
            <div class="agent-info">
              <div class="agent-task-id">{{ agent.taskId }}</div>
              <div class="agent-time">{{ formatTime(agent.completedAt) }}</div>
            </div>
          </div>
        </div>

        <!-- Failed Agents -->
        <div v-if="failedAgents.length > 0" class="agents-section">
          <h3 class="section-title">Failed ({{ failedAgents.length }})</h3>
          <div
            v-for="agent in failedAgents"
            :key="agent.taskId"
            class="agent-item"
            :class="{ selected: selectedTaskId === agent.taskId }"
            @click="selectAgent(agent.taskId)"
          >
            <div class="agent-status" :class="getStatusClass(agent.status)"></div>
            <div class="agent-info">
              <div class="agent-task-id">{{ agent.taskId }}</div>
              <div class="agent-time">Exit: {{ agent.exitCode }}</div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.connection-status {
  font-size: 10px;
  color: var(--text-dim);
}

.connection-status.connected {
  color: var(--ok);
}

.refresh-btn {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 16px;
  border-radius: var(--radius-sm);
}

.refresh-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.agents-section {
  margin-bottom: var(--spacing-lg);
}

.section-title {
  font-size: var(--font-size-sm);
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--spacing-sm);
}

.agent-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid var(--border);
}

.agent-item:last-child {
  border-bottom: none;
}

.agent-item:hover {
  background: var(--bg-tertiary);
}

.agent-item.selected {
  background: var(--accent);
  color: var(--bg);
}

.agent-item.selected .agent-time {
  color: rgba(0, 0, 0, 0.6);
}

.agent-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.agent-status.running {
  background: var(--ok);
  animation: pulse 2s infinite;
}

.agent-status.completed {
  background: var(--text-muted);
}

.agent-status.failed {
  background: var(--blocked);
}

.agent-status.pending {
  background: var(--text-dim);
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-task-id {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-time {
  font-size: 11px;
  color: var(--text-dim);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
