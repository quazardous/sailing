<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { useAgentsStore } from '../stores/agents';

const agentsStore = useAgentsStore();

const logs = computed(() => agentsStore.selectedAgentLogs);
const selectedTaskId = computed(() => agentsStore.selectedTaskId);
const logsContainer = ref<HTMLElement | null>(null);
const autoScroll = ref(true);

function clearLogs() {
  agentsStore.clearLogs();
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function scrollToBottom() {
  if (logsContainer.value && autoScroll.value) {
    logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
  }
}

function handleScroll() {
  if (!logsContainer.value) return;
  const { scrollTop, scrollHeight, clientHeight } = logsContainer.value;
  // Disable auto-scroll if user scrolled up
  autoScroll.value = scrollHeight - scrollTop - clientHeight < 50;
}

// Watch for new logs and scroll
watch(
  () => logs.value.length,
  () => {
    requestAnimationFrame(scrollToBottom);
  }
);

onMounted(() => {
  scrollToBottom();
});
</script>

<template>
  <div class="panel-container logs-panel">
    <div class="panel-header">
      <span>
        Logs
        <span v-if="selectedTaskId" class="filter-badge">{{ selectedTaskId }}</span>
      </span>
      <div class="header-actions">
        <button v-if="selectedTaskId" class="clear-filter-btn" @click="agentsStore.selectAgent(null)">
          Clear filter
        </button>
        <button class="clear-btn" @click="clearLogs">Clear</button>
      </div>
    </div>

    <div
      ref="logsContainer"
      class="logs-container"
      @scroll="handleScroll"
    >
      <div v-if="logs.length === 0" class="empty-state">
        <div class="empty-state-icon">📜</div>
        <div>No logs yet</div>
        <div class="empty-hint">Logs will appear here when agents run</div>
      </div>

      <div v-else class="logs-content">
        <div
          v-for="(log, index) in logs"
          :key="index"
          class="log-line"
        >
          <span class="log-timestamp">{{ formatTimestamp(log.timestamp) }}</span>
          <span class="log-task-id">{{ log.taskId }}</span>
          <span class="log-text">{{ log.line }}</span>
        </div>
      </div>
    </div>

    <div class="logs-footer">
      <label class="auto-scroll-toggle">
        <input type="checkbox" v-model="autoScroll" />
        Auto-scroll
      </label>
      <span class="logs-count">{{ logs.length }} lines</span>
    </div>
  </div>
</template>

<style scoped>
.logs-panel {
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.filter-badge {
  font-size: var(--font-size-sm);
  background: var(--accent);
  color: var(--bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  margin-left: var(--spacing-sm);
  font-family: var(--font-mono);
}

.header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.clear-filter-btn,
.clear-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-dim);
  cursor: pointer;
  padding: 4px 8px;
  font-size: var(--font-size-sm);
  border-radius: var(--radius-sm);
}

.clear-filter-btn:hover,
.clear-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text);
}

.logs-container {
  flex: 1;
  overflow: auto;
  background: #000;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.4;
}

.logs-content {
  padding: var(--spacing-sm);
}

.log-line {
  display: flex;
  gap: var(--spacing-sm);
  padding: 2px 0;
}

.log-line:hover {
  background: rgba(255, 255, 255, 0.05);
}

.log-timestamp {
  color: #666;
  flex-shrink: 0;
}

.log-task-id {
  color: var(--accent);
  flex-shrink: 0;
  min-width: 60px;
}

.log-text {
  color: #ccc;
  white-space: pre-wrap;
  word-break: break-all;
}

.logs-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg);
  border-top: 1px solid var(--border);
  font-size: var(--font-size-sm);
  flex-shrink: 0;
}

.auto-scroll-toggle {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--text-dim);
  cursor: pointer;
}

.auto-scroll-toggle input {
  cursor: pointer;
}

.logs-count {
  color: var(--text-dim);
}

.empty-hint {
  margin-top: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--text-muted);
}
</style>
