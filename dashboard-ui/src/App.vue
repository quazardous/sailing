<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, shallowRef } from 'vue';
import {
  DockviewVue,
  type DockviewReadyEvent,
  type DockviewApi,
} from 'dockview-vue';
import { useArtefactsStore } from './stores/artefacts';
import { useAgentsStore } from './stores/agents';
import { useActivitiesStore } from './stores/activities';

import ActivityBar from './components/ActivityBar.vue';
import WelcomeSidebar from './sidebars/WelcomeSidebar.vue';
import ArtefactsExplorer from './sidebars/ArtefactsExplorer.vue';
import AgentsExplorer from './sidebars/AgentsExplorer.vue';
import SettingsSidebar from './sidebars/SettingsSidebar.vue';

const activitiesStore = useActivitiesStore();
const dockviewApi = shallowRef<DockviewApi | null>(null);

// Map sidebar components
const sidebarComponents: Record<string, unknown> = {
  WelcomeSidebar,
  ArtefactsExplorer,
  AgentsExplorer,
  SettingsSidebar,
};

const currentSidebarComponent = computed(() => {
  const componentName = activitiesStore.currentActivity.sidebarComponent;
  return sidebarComponents[componentName] || null;
});

// Track current activity for layout management
const currentActivityId = computed(() => activitiesStore.currentActivityId);

// Default layouts per activity
function getDefaultLayout(activityId: string): void {
  if (!dockviewApi.value) return;

  const api = dockviewApi.value;

  // Clear existing panels
  api.panels.forEach(panel => panel.api.close());

  if (activityId === 'welcome') {
    api.addPanel({
      id: 'welcome',
      component: 'welcome',
      title: 'Welcome',
    });

    api.addPanel({
      id: 'prd-overview',
      component: 'prd-overview',
      title: 'PRD Timeline',
      position: { referencePanel: 'welcome', direction: 'within' },
    });
  } else if (activityId === 'artefacts') {
    api.addPanel({
      id: 'detail',
      component: 'detail',
      title: 'Detail',
    });

    api.addPanel({
      id: 'stats',
      component: 'stats',
      title: 'Stats',
      position: { referencePanel: 'detail', direction: 'within' },
    });

    api.addPanel({
      id: 'meta',
      component: 'meta',
      title: 'Meta',
      position: { referencePanel: 'detail', direction: 'within' },
    });

    api.addPanel({
      id: 'gantt',
      component: 'gantt',
      title: 'Gantt',
      position: { referencePanel: 'detail', direction: 'within' },
    });

    api.addPanel({
      id: 'dag',
      component: 'dag',
      title: 'Dependencies',
      position: { referencePanel: 'detail', direction: 'within' },
    });
  } else if (activityId === 'agents') {
    api.addPanel({
      id: 'agent-detail',
      component: 'agent-detail',
      title: 'Agent Detail',
    });

    api.addPanel({
      id: 'logs',
      component: 'logs',
      title: 'Logs',
      position: { referencePanel: 'agent-detail', direction: 'below' },
    });
  } else if (activityId === 'settings') {
    api.addPanel({
      id: 'settings',
      component: 'settings-panel',
      title: 'Settings',
    });
  }
}

function saveCurrentLayout() {
  if (!dockviewApi.value) return;
  const layout = dockviewApi.value.toJSON();
  activitiesStore.saveLayout(currentActivityId.value, layout);
}

function loadLayout(activityId: string) {
  if (!dockviewApi.value) return;

  const savedLayout = activitiesStore.loadLayout(activityId);
  if (savedLayout) {
    try {
      dockviewApi.value.fromJSON(savedLayout as Parameters<DockviewApi['fromJSON']>[0]);
    } catch {
      // Fallback to default if saved layout is invalid
      getDefaultLayout(activityId);
    }
  } else {
    getDefaultLayout(activityId);
  }
}

function onReady(event: DockviewReadyEvent) {
  dockviewApi.value = event.api;

  // Register save function with store
  activitiesStore.registerSaveLayoutFn(saveCurrentLayout);

  // Load layout for current activity
  loadLayout(currentActivityId.value);

  // Save layout on change
  event.api.onDidLayoutChange(() => {
    saveCurrentLayout();
  });
}

// Watch for activity changes
watch(currentActivityId, (newActivityId, oldActivityId) => {
  if (newActivityId !== oldActivityId && dockviewApi.value) {
    loadLayout(newActivityId);
  }
});

// Sidebar resize logic
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 280;

const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);
let isResizing = false;

// Load saved sidebar width
const savedWidth = localStorage.getItem('sidebarWidth');
if (savedWidth) {
  const width = parseInt(savedWidth, 10);
  if (width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
    sidebarWidth.value = width;
  }
}

function startResize(e: MouseEvent) {
  isResizing = true;
  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
}

function handleResize(e: MouseEvent) {
  if (!isResizing) return;
  // 48px is the activity bar width
  const newWidth = e.clientX - 48;
  if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
    sidebarWidth.value = newWidth;
  }
}

function stopResize() {
  isResizing = false;
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  localStorage.setItem('sidebarWidth', sidebarWidth.value.toString());
}

onUnmounted(() => {
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);
});

onMounted(async () => {
  // Initialize stores
  const artefactsStore = useArtefactsStore();
  const agentsStore = useAgentsStore();

  // Load initial data
  await artefactsStore.fetchTree();
  await agentsStore.fetchAgents();

  // Connect WebSocket for real-time updates
  agentsStore.connectWebSocket();

  // Apply saved theme
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : savedTheme
  );
});
</script>

<template>
  <div class="app-container">
    <!-- Activity Bar (fixed left) -->
    <ActivityBar />

    <!-- Sidebar (resizable, content depends on activity) -->
    <div
      class="sidebar"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <component :is="currentSidebarComponent" />
      <div
        class="sidebar-resize-handle"
        @mousedown="startResize"
      ></div>
    </div>

    <!-- Main area (Dockview) -->
    <div class="main-area">
      <DockviewVue
        class="dockview-theme-dark"
        @ready="onReady"
      />
    </div>
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  display: flex;
}

.sidebar {
  flex-shrink: 0;
  background: var(--bg, #252526);
  border-right: 1px solid var(--border, #333);
  overflow: hidden;
  position: relative;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  transition: background-color 0.15s;
  z-index: 10;
}

.sidebar-resize-handle:hover {
  background: var(--accent, #0078d4);
}

.main-area {
  flex: 1;
  min-width: 0;
}

:deep(.dockview-theme-dark) {
  height: 100%;
}

/* Hide close buttons on tabs */
:deep(.dv-default-tab-action) {
  display: none !important;
}
</style>
