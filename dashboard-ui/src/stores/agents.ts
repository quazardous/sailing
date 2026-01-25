/**
 * Agents Store
 *
 * Manages agent status and logs.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api, ws } from '../api';
import type { AgentInfo, AgentStatus, WsMessage } from '../api';

interface LogEntry {
  taskId: string;
  line: string;
  timestamp: Date;
}

export const useAgentsStore = defineStore('agents', () => {
  // State
  const agents = ref<AgentInfo[]>([]);
  const logs = ref<LogEntry[]>([]);
  const selectedTaskId = ref<string | null>(null);
  const loading = ref(false);
  const connected = ref(false);
  const maxLogs = 1000; // Keep last N log entries

  // Computed
  const runningAgents = computed(() =>
    agents.value.filter((a) => a.status === 'running')
  );

  const completedAgents = computed(() =>
    agents.value.filter((a) => a.status === 'completed')
  );

  const failedAgents = computed(() =>
    agents.value.filter((a) => a.status === 'failed')
  );

  const selectedAgentLogs = computed(() => {
    if (!selectedTaskId.value) return logs.value;
    return logs.value.filter((l) => l.taskId === selectedTaskId.value);
  });

  const agentByTaskId = computed(() => {
    const map = new Map<string, AgentInfo>();
    for (const agent of agents.value) {
      map.set(agent.taskId, agent);
    }
    return map;
  });

  const selectedAgent = computed(() => {
    if (!selectedTaskId.value) return null;
    return agentByTaskId.value.get(selectedTaskId.value) || null;
  });

  // Actions
  async function fetchAgents(): Promise<void> {
    loading.value = true;
    try {
      const response = await api.getAgents();
      agents.value = response.agents;
    } catch (e) {
      console.error('[AgentsStore] fetchAgents error:', e);
    } finally {
      loading.value = false;
    }
  }

  function connectWebSocket(): void {
    ws.connect();

    ws.on('connected', () => {
      connected.value = true;
    });

    ws.on('agent:log', (msg: WsMessage) => {
      if (msg.taskId && msg.line) {
        addLog(msg.taskId, msg.line);
      }
    });

    ws.on('agent:status', (msg: WsMessage) => {
      if (msg.taskId && msg.status) {
        updateAgentStatus(msg.taskId, msg.status);
      }
    });

    ws.on('artefact:updated', () => {
      // Trigger artefact refresh
      // This will be handled by the artefacts store
    });
  }

  function disconnectWebSocket(): void {
    ws.disconnect();
    connected.value = false;
  }

  function addLog(taskId: string, line: string): void {
    logs.value.push({
      taskId,
      line,
      timestamp: new Date(),
    });

    // Trim logs if exceeding max
    if (logs.value.length > maxLogs) {
      logs.value = logs.value.slice(-maxLogs);
    }
  }

  function updateAgentStatus(taskId: string, status: AgentStatus): void {
    const agent = agents.value.find((a) => a.taskId === taskId);
    if (agent) {
      agent.status = status;
      if (status === 'completed' || status === 'failed') {
        agent.completedAt = new Date().toISOString();
      }
    } else {
      // New agent
      agents.value.push({
        taskId,
        status,
        startedAt: new Date().toISOString(),
      });
    }
  }

  function selectAgent(taskId: string | null): void {
    selectedTaskId.value = taskId;
  }

  function clearLogs(): void {
    if (selectedTaskId.value) {
      logs.value = logs.value.filter((l) => l.taskId !== selectedTaskId.value);
    } else {
      logs.value = [];
    }
  }

  function getAgent(taskId: string): AgentInfo | undefined {
    return agentByTaskId.value.get(taskId);
  }

  async function refresh(): Promise<void> {
    await fetchAgents();
  }

  return {
    // State
    agents,
    logs,
    selectedTaskId,
    loading,
    connected,
    // Computed
    runningAgents,
    completedAgents,
    failedAgents,
    selectedAgentLogs,
    agentByTaskId,
    selectedAgent,
    // Actions
    fetchAgents,
    refresh,
    connectWebSocket,
    disconnectWebSocket,
    addLog,
    updateAgentStatus,
    selectAgent,
    clearLogs,
    getAgent,
  };
});
