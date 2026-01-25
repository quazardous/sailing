<script setup lang="ts">
import { computed } from 'vue';
import { useArtefactsStore } from '../stores/artefacts';
import DependencyGraph from '../components/DependencyGraph.vue';
import type { DagData } from '../api/types';

const artefactsStore = useArtefactsStore();

const selectedArtefact = computed(() => artefactsStore.selectedArtefact);
const dagData = computed<DagData | null>(() => selectedArtefact.value?.dag || null);

function handleNodeClick(id: string) {
  artefactsStore.selectArtefact(id);
}
</script>

<template>
  <div class="panel-container">
    <div class="panel-content">
      <div v-if="!selectedArtefact" class="empty-state">
        <div class="empty-state-icon">🔗</div>
        <div>Select an artefact to view the graph</div>
      </div>
      <div v-else-if="!dagData || !dagData.nodes?.length" class="empty-state">
        <div class="empty-state-icon">🔗</div>
        <div>No graph for this artefact</div>
      </div>
      <div v-else class="graph-wrapper">
        <DependencyGraph :data="dagData" @node-click="handleNodeClick" />
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
  overflow: hidden;
  padding: var(--spacing-md, 12px);
  display: flex;
  flex-direction: column;
}

.graph-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
