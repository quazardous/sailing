<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import { useArtefactsStore } from '../stores/artefacts';
import StatusBadge from '../components/StatusBadge.vue';

const artefactsStore = useArtefactsStore();

const selectedArtefact = computed(() => artefactsStore.selectedArtefact);
const loading = computed(() => artefactsStore.loading);

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

const renderedDescription = computed(() => {
  let desc = selectedArtefact.value?.data?.description;
  if (!desc) return '';
  // Strip HTML comments (MCP instructions, etc.) - both closed and unclosed
  desc = desc.replace(/<!--[\s\S]*?-->/g, ''); // closed comments
  desc = desc.replace(/<!--[\s\S]*$/g, ''); // unclosed comment at end
  desc = desc.trim();
  if (!desc) return '';
  return marked.parse(desc) as string;
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
        <div class="empty-state-icon">👈</div>
        <div>Select an item from the explorer</div>
      </div>
    </template>

    <template v-else>
      <!-- Header -->
      <div class="detail-header">
        <div class="detail-title">
          <StatusBadge :status="selectedArtefact.data.status" />
          <strong>{{ selectedArtefact.data.id }}</strong>
          <span class="detail-title-text">{{ selectedArtefact.data.title }}</span>
        </div>
        <div v-if="selectedArtefact.parent" class="detail-parent">
          Part of {{ selectedArtefact.parent.id }}: {{ selectedArtefact.parent.title }}
        </div>
      </div>

      <!-- Description Content (Markdown body) -->
      <div class="description-content">
        <div v-if="renderedDescription" class="markdown-body" v-html="renderedDescription"></div>
        <div v-else class="empty-state">
          <div class="empty-state-icon">📝</div>
          <div>No description available</div>
          <div class="debug-hint">
            Try refreshing the data or check if the artefact file has content after the frontmatter.
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg, #1e1e1e);
  overflow: auto;
}

.detail-header {
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 10;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-lg);
}

.detail-title-text {
  color: var(--text-dim);
  font-weight: 400;
}

.detail-parent {
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-sm);
  color: var(--text-dim);
}

.description-content {
  padding: var(--spacing-md);
}

/* Markdown styling */
.markdown-body {
  line-height: 1.6;
  font-size: var(--font-size-base);
  color: var(--text, #fff);
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin-top: var(--spacing-lg);
  margin-bottom: var(--spacing-sm);
  font-weight: 600;
  color: var(--text);
}

.markdown-body :deep(h1) { font-size: 1.5em; }
.markdown-body :deep(h2) { font-size: 1.3em; }
.markdown-body :deep(h3) { font-size: 1.15em; }
.markdown-body :deep(h4) { font-size: 1em; }

.markdown-body :deep(p) {
  margin-bottom: var(--spacing-md);
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin-bottom: var(--spacing-md);
  padding-left: var(--spacing-lg);
}

.markdown-body :deep(li) {
  margin-bottom: var(--spacing-xs);
}

.markdown-body :deep(code) {
  background: var(--bg-tertiary);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.markdown-body :deep(pre) {
  background: var(--bg);
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  overflow-x: auto;
  margin-bottom: var(--spacing-md);
}

.markdown-body :deep(pre code) {
  background: none;
  padding: 0;
}

.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--accent);
  padding-left: var(--spacing-md);
  margin: var(--spacing-md) 0;
  color: var(--text-dim);
}

.markdown-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
}

.markdown-body :deep(a:hover) {
  text-decoration: underline;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--spacing-md);
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--border);
  padding: var(--spacing-sm);
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--bg);
  font-weight: 600;
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: var(--spacing-lg) 0;
}

.markdown-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
}

.debug-hint {
  margin-top: var(--spacing-sm);
  font-size: var(--font-size-sm);
  opacity: 0.6;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-dim);
  gap: 8px;
}

.empty-state-icon {
  font-size: 48px;
  opacity: 0.5;
}
</style>
