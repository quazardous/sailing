<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const props = defineProps<{
  lines: string[];
}>();

const containerRef = ref<HTMLElement | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!containerRef.value) return;

  terminal = new Terminal({
    theme: {
      background: '#000',
      foreground: '#ccc',
      cursor: '#4fc3f7',
      selectionBackground: '#4fc3f744',
    },
    fontSize: 12,
    fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
    cursorBlink: false,
    disableStdin: true,
    scrollback: 10000,
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(containerRef.value);
  fitAddon.fit();

  // Handle resize
  resizeObserver = new ResizeObserver(() => {
    if (fitAddon) {
      fitAddon.fit();
    }
  });
  resizeObserver.observe(containerRef.value);

  // Write initial lines
  for (const line of props.lines) {
    terminal.writeln(line);
  }
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (terminal) {
    terminal.dispose();
  }
});

// Watch for new lines
watch(
  () => props.lines.length,
  (newLen, oldLen) => {
    if (terminal && newLen > oldLen) {
      // Write only new lines
      for (let i = oldLen; i < newLen; i++) {
        terminal.writeln(props.lines[i]);
      }
    }
  }
);

function clear() {
  if (terminal) {
    terminal.clear();
  }
}

function scrollToBottom() {
  if (terminal) {
    terminal.scrollToBottom();
  }
}

defineExpose({
  clear,
  scrollToBottom,
});
</script>

<template>
  <div ref="containerRef" class="terminal-container"></div>
</template>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  background: #000;
}

.terminal-container :deep(.xterm) {
  height: 100%;
  padding: 4px;
}

.terminal-container :deep(.xterm-viewport) {
  overflow-y: auto !important;
}
</style>
