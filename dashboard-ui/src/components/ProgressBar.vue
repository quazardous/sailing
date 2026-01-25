<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    value: number;
    size?: 'sm' | 'md' | 'lg';
    showLabel?: boolean;
  }>(),
  {
    size: 'md',
    showLabel: false,
  }
);

const progressClass = computed(() => {
  if (props.value >= 70) return 'ok';
  if (props.value < 30) return 'risk';
  return '';
});

const height = computed(() => {
  switch (props.size) {
    case 'sm':
      return '4px';
    case 'lg':
      return '12px';
    default:
      return '8px';
  }
});
</script>

<template>
  <div class="progress-wrapper">
    <div class="progress-bar" :style="{ height }">
      <div
        class="progress-bar-fill"
        :class="progressClass"
        :style="{ width: `${Math.min(100, Math.max(0, value))}%` }"
      ></div>
    </div>
    <span v-if="showLabel" class="progress-label">{{ value }}%</span>
  </div>
</template>

<style scoped>
.progress-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.progress-bar {
  flex: 1;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}

.progress-bar-fill.ok {
  background: var(--ok);
}

.progress-bar-fill.risk {
  background: var(--risk);
}

.progress-label {
  font-size: var(--font-size-sm);
  color: var(--text-dim);
  min-width: 40px;
  text-align: right;
}
</style>
