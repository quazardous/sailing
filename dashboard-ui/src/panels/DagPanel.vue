<script setup lang="ts">
import { computed } from 'vue';
import { useArtefactsStore } from '../stores/artefacts';
import MermaidDiagram from '../components/MermaidDiagram.vue';

const artefactsStore = useArtefactsStore();

const selectedArtefact = computed(() => artefactsStore.selectedArtefact);
const dagCode = computed(() => selectedArtefact.value?.dag || null);
</script>

<template>
  <div class="panel-container">
    <div class="panel-content">
      <div v-if="!selectedArtefact" class="empty-state">
        <div class="empty-state-icon">🔗</div>
        <div>Select an artefact to view dependencies</div>
      </div>
      <div v-else-if="!dagCode" class="empty-state">
        <div class="empty-state-icon">🔗</div>
        <div>No dependency graph for this artefact</div>
      </div>
      <div v-else class="diagram-wrapper">
        <MermaidDiagram :code="dagCode" />
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

.diagram-wrapper {
  display: flex;
  justify-content: center;
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
</style>
