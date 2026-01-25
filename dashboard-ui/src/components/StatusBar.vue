<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '../stores/project';
import { useActivitiesStore } from '../stores/activities';
import { useArtefactsStore } from '../stores/artefacts';
import { useAgentsStore } from '../stores/agents';

const projectStore = useProjectStore();
const activitiesStore = useActivitiesStore();
const artefactsStore = useArtefactsStore();
const agentsStore = useAgentsStore();

const projectPath = computed(() => projectStore.projectPath);
const currentActivity = computed(() => activitiesStore.currentActivity);

// Build context breadcrumb based on current activity
const contextInfo = computed(() => {
  const activityId = activitiesStore.currentActivityId;

  if (activityId === 'artefacts') {
    const selected = artefactsStore.selectedArtefact;
    if (selected) {
      const parts: string[] = [];
      if (selected.parent) {
        parts.push(selected.parent.id);
      }
      parts.push(`${selected.data.id}: ${selected.data.title}`);
      return parts.join(' / ');
    }
    return 'No selection';
  }

  if (activityId === 'agents') {
    const selected = agentsStore.selectedAgent;
    if (selected) {
      return `Agent: ${selected.taskId} (${selected.status})`;
    }
    return 'No agent selected';
  }

  return '';
});
</script>

<template>
  <div class="status-bar">
    <div class="status-section project">
      <span class="status-icon">⛵</span>
      <span class="status-text">{{ projectPath }}</span>
    </div>
    <div class="status-separator"></div>
    <div class="status-section activity">
      <span class="status-icon">{{ currentActivity.icon }}</span>
      <span class="status-text">{{ currentActivity.label }}</span>
    </div>
    <div v-if="contextInfo" class="status-separator"></div>
    <div v-if="contextInfo" class="status-section context">
      <span class="status-text">{{ contextInfo }}</span>
    </div>
    <div class="status-spacer"></div>
  </div>
</template>

<style scoped>
.status-bar {
  width: 100%;
  height: 24px;
  background: var(--bg-secondary, #1e1e1e);
  border-top: 1px solid var(--border, #333);
  display: flex;
  align-items: center;
  padding: 0 var(--spacing-sm, 8px);
  font-size: 12px;
  color: var(--text-dim, #888);
  flex-shrink: 0;
}

.status-section {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 var(--spacing-sm, 8px);
}

.status-section.project {
  color: var(--accent, #0078d4);
}

.status-icon {
  font-size: 12px;
}

.status-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-separator {
  width: 1px;
  height: 14px;
  background: var(--border, #333);
}

.status-spacer {
  flex: 1;
}
</style>
