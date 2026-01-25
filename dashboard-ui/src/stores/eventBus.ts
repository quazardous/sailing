/**
 * Event Bus Store
 *
 * Centralized WebSocket event handling with debouncing.
 * Single point of coordination for real-time updates.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ws } from '../api';
import type { WsMessage } from '../api';

// Debounce delays
const ARTEFACT_DEBOUNCE_MS = 300;

export const useEventBus = defineStore('eventBus', () => {
  // State
  const connected = ref(false);
  const lastArtefactUpdate = ref<string | null>(null);

  // Debounce timers
  let artefactRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Callbacks registered by stores
  const artefactRefreshCallbacks: Array<() => void> = [];
  const agentLogCallbacks: Array<(msg: WsMessage) => void> = [];
  const agentStatusCallbacks: Array<(msg: WsMessage) => void> = [];

  /**
   * Register callback for artefact refresh
   */
  function onArtefactRefresh(callback: () => void): () => void {
    artefactRefreshCallbacks.push(callback);
    return () => {
      const index = artefactRefreshCallbacks.indexOf(callback);
      if (index > -1) artefactRefreshCallbacks.splice(index, 1);
    };
  }

  /**
   * Register callback for agent logs
   */
  function onAgentLog(callback: (msg: WsMessage) => void): () => void {
    agentLogCallbacks.push(callback);
    return () => {
      const index = agentLogCallbacks.indexOf(callback);
      if (index > -1) agentLogCallbacks.splice(index, 1);
    };
  }

  /**
   * Register callback for agent status
   */
  function onAgentStatus(callback: (msg: WsMessage) => void): () => void {
    agentStatusCallbacks.push(callback);
    return () => {
      const index = agentStatusCallbacks.indexOf(callback);
      if (index > -1) agentStatusCallbacks.splice(index, 1);
    };
  }

  /**
   * Initialize WebSocket connection and event handlers
   */
  function init() {
    ws.connect();

    ws.on('connected', () => {
      connected.value = true;
      console.log('[EventBus] WebSocket connected');
    });

    // Debounced artefact refresh
    ws.on('artefact:updated', (msg) => {
      lastArtefactUpdate.value = msg.id || '*';

      // Clear existing timer
      if (artefactRefreshTimer) {
        clearTimeout(artefactRefreshTimer);
      }

      // Set debounced refresh
      artefactRefreshTimer = setTimeout(() => {
        artefactRefreshTimer = null;
        console.log('[EventBus] Triggering artefact refresh');
        artefactRefreshCallbacks.forEach(cb => cb());
      }, ARTEFACT_DEBOUNCE_MS);
    });

    // Forward agent logs immediately (no debounce needed)
    ws.on('agent:log', (msg) => {
      agentLogCallbacks.forEach(cb => cb(msg));
    });

    // Forward agent status immediately
    ws.on('agent:status', (msg) => {
      agentStatusCallbacks.forEach(cb => cb(msg));
    });
  }

  /**
   * Disconnect WebSocket
   */
  function disconnect() {
    ws.disconnect();
    connected.value = false;
    if (artefactRefreshTimer) {
      clearTimeout(artefactRefreshTimer);
      artefactRefreshTimer = null;
    }
  }

  return {
    // State
    connected,
    lastArtefactUpdate,
    // Actions
    init,
    disconnect,
    onArtefactRefresh,
    onAgentLog,
    onAgentStatus,
  };
});
