<script setup lang="ts">
import { computed } from 'vue';
import { useArtefactsStore } from '../stores/artefacts';

const artefactsStore = useArtefactsStore();

const selectedArtefact = computed(() => artefactsStore.selectedArtefact);
const loading = computed(() => artefactsStore.loading);

function formatDate(isoString: string | undefined): string {
  if (!isoString) return '-';
  const date = new Date(isoString);
  return date.toLocaleString('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatMeta(meta: Record<string, unknown> | undefined): Array<{ key: string; value: string }> {
  if (!meta) return [];
  return Object.entries(meta).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
  }));
}

const timestamps = computed(() => {
  const data = selectedArtefact.value?.data;
  if (!data) return null;
  return {
    createdAt: formatDate(data.createdAt),
    modifiedAt: formatDate(data.modifiedAt)
  };
});

const metaItems = computed(() => {
  if (!selectedArtefact.value?.data?.meta) return [];
  return formatMeta(selectedArtefact.value.data.meta);
});
</script>

<template>
  <div class="panel-container">
    <template v-if="loading && !selectedArtefact">
      <div class="loading">
        <div class="spinner"></div>
      </div>
    </template>

    <template v-else-if="!selectedArtefact">
      <div class="empty-state">
        <div class="empty-state-icon">🏷️</div>
        <div>Select an item to view metadata</div>
      </div>
    </template>

    <template v-else>
      <div class="meta-content">
        <!-- Timestamps section -->
        <div v-if="timestamps" class="timestamps-section">
          <div class="timestamp-item">
            <span class="timestamp-label">Created</span>
            <span class="timestamp-value">{{ timestamps.createdAt }}</span>
          </div>
          <div class="timestamp-item">
            <span class="timestamp-label">Modified</span>
            <span class="timestamp-value">{{ timestamps.modifiedAt }}</span>
          </div>
        </div>

        <!-- Meta table -->
        <table v-if="metaItems.length > 0" class="meta-table">
          <tbody>
            <tr v-for="item in metaItems" :key="item.key">
              <td class="meta-key">{{ item.key }}</td>
              <td class="meta-value">
                <pre v-if="item.value.includes('\n')">{{ item.value }}</pre>
                <span v-else>{{ item.value }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="!timestamps" class="empty-state">
          <div class="empty-state-icon">🏷️</div>
          <div>No metadata available</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.meta-content {
  padding: var(--spacing-md);
}

.timestamps-section {
  display: flex;
  gap: var(--spacing-lg);
  padding: var(--spacing-sm) var(--spacing-md);
  margin-bottom: var(--spacing-md);
  background: var(--bg);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}

.timestamp-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timestamp-label {
  font-size: var(--font-size-xs);
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.timestamp-value {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}

.meta-table {
  width: 100%;
  border-collapse: collapse;
}

.meta-table tr {
  border-bottom: 1px solid var(--border);
}

.meta-table tr:last-child {
  border-bottom: none;
}

.meta-table td {
  padding: var(--spacing-sm) var(--spacing-md);
  vertical-align: top;
}

.meta-key {
  font-weight: 600;
  color: var(--text-dim);
  width: 150px;
  white-space: nowrap;
}

.meta-value {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  word-break: break-word;
}

.meta-value pre {
  margin: 0;
  padding: var(--spacing-sm);
  background: var(--bg);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  font-size: var(--font-size-sm);
}
</style>
