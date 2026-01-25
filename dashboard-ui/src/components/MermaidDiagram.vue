<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import mermaid from 'mermaid';

const props = defineProps<{
  code: string;
}>();

const containerRef = ref<HTMLElement | null>(null);
const error = ref<string | null>(null);
let initialized = false;

async function renderDiagram() {
  if (!containerRef.value || !props.code) return;

  error.value = null;

  try {
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#4fc3f7',
          primaryTextColor: '#eee',
          primaryBorderColor: '#333',
          lineColor: '#888',
          secondaryColor: '#16213e',
          tertiaryColor: '#0f3460',
        },
        flowchart: {
          curve: 'basis',
          padding: 20,
        },
        securityLevel: 'strict',
      });
      initialized = true;
    }

    // Generate unique ID for this render
    const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const { svg } = await mermaid.render(id, props.code);
    containerRef.value.innerHTML = svg;
  } catch (e) {
    console.error('[Mermaid] Render error:', e);
    error.value = e instanceof Error ? e.message : 'Failed to render diagram';
    containerRef.value.innerHTML = '';
  }
}

onMounted(() => {
  renderDiagram();
});

watch(() => props.code, () => {
  renderDiagram();
});
</script>

<template>
  <div class="mermaid-wrapper">
    <div v-if="error" class="mermaid-error">
      <div class="error-icon">⚠️</div>
      <div class="error-message">{{ error }}</div>
      <pre class="error-code">{{ code }}</pre>
    </div>
    <div ref="containerRef" class="mermaid-container"></div>
  </div>
</template>

<style scoped>
.mermaid-wrapper {
  width: 100%;
  overflow: auto;
}

.mermaid-container {
  display: flex;
  justify-content: center;
  padding: var(--spacing-md);
  background: var(--bg);
  border-radius: var(--radius-md);
  min-height: 100px;
}

.mermaid-container :deep(svg) {
  max-width: 100%;
  height: auto;
}

.mermaid-error {
  padding: var(--spacing-md);
  background: rgba(244, 67, 54, 0.1);
  border: 1px solid var(--blocked);
  border-radius: var(--radius-md);
}

.error-icon {
  font-size: 24px;
  margin-bottom: var(--spacing-sm);
}

.error-message {
  color: var(--blocked);
  margin-bottom: var(--spacing-md);
}

.error-code {
  font-size: var(--font-size-sm);
  font-family: var(--font-mono);
  background: var(--bg);
  padding: var(--spacing-sm);
  border-radius: var(--radius-sm);
  overflow: auto;
  max-height: 200px;
}
</style>
