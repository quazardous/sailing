<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  status: string;
}>();

const badgeClass = computed(() => {
  const s = props.status.toLowerCase().replace(/\s+/g, '-');
  return `badge badge-${s}`;
});
</script>

<template>
  <span :class="badgeClass">{{ status }}</span>
</template>

<style scoped>
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.badge-done {
  background: rgba(76, 175, 80, 0.2);
  color: var(--ok);
}

.badge-blocked {
  background: rgba(244, 67, 54, 0.2);
  color: var(--blocked);
}

.badge-in-progress,
.badge-wip {
  background: rgba(255, 152, 0, 0.2);
  color: var(--wip);
}

.badge-draft,
.badge-todo,
.badge-not-started {
  background: rgba(158, 158, 158, 0.2);
  color: var(--draft);
}

.badge-reviewed {
  background: rgba(33, 150, 243, 0.2);
  color: var(--info, #2196f3);
}

.badge-breakdown {
  background: rgba(156, 39, 176, 0.2);
  color: var(--purple, #9c27b0);
}

.badge-approved,
.badge-in-review {
  background: rgba(0, 150, 136, 0.2);
  color: var(--teal, #009688);
}

.badge-auto-done {
  background: rgba(76, 175, 80, 0.15);
  color: var(--ok);
}
</style>
