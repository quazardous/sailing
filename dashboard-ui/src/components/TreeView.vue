<script setup lang="ts">
import { ref } from 'vue';
import TreeNode from './TreeNode.vue';

// Generic tree node interface - reusable for any tree data
export interface TreeNodeData {
  id: string;
  label: string;
  secondaryLabel?: string;
  icon?: string;
  iconColor?: string;
  // Status variants: maps to visual style
  // not-started (gray), in-progress (yellow pulse), blocked (red), done (green),
  // cancelled (gray dim), draft (purple), in-review (blue), approved (cyan), auto-done (lime pulse)
  status?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'active' | 'approved' | 'draft' | 'review' | 'cancelled' | 'auto-done';
  statusText?: string;  // Human-readable status for tooltip
  badge?: string | number;
  badgeVariant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  children?: TreeNodeData[];
  data?: Record<string, unknown>;
}

const props = withDefaults(defineProps<{
  nodes: TreeNodeData[];
  selectedId?: string | null;
  expandedIds?: Set<string>;
  defaultExpanded?: boolean;
  isNewFn?: (id: string) => boolean;
}>(), {
  selectedId: null,
  defaultExpanded: true,
  isNewFn: () => false,
});

const emit = defineEmits<{
  select: [node: TreeNodeData];
  toggle: [id: string, expanded: boolean];
}>();

// Track expanded state internally if not controlled
const internalExpanded = ref<Set<string>>(new Set());

function isExpanded(id: string): boolean {
  if (props.expandedIds) {
    return props.expandedIds.has(id);
  }
  // Default expanded on first render
  if (!internalExpanded.value.has(`_init_${id}`) && props.defaultExpanded) {
    internalExpanded.value.add(`_init_${id}`);
    internalExpanded.value.add(id);
    return true;
  }
  return internalExpanded.value.has(id);
}

function handleToggle(node: TreeNodeData) {
  if (!node.children?.length) return;

  const wasExpanded = isExpanded(node.id);
  if (props.expandedIds) {
    emit('toggle', node.id, !wasExpanded);
  } else {
    if (wasExpanded) {
      internalExpanded.value.delete(node.id);
    } else {
      internalExpanded.value.add(node.id);
    }
  }
}

function handleSelect(node: TreeNodeData) {
  emit('select', node);
}
</script>

<template>
  <div class="tree-view">
    <TreeNode
      v-for="(node, idx) in nodes"
      :key="node.id"
      :node="node"
      :level="0"
      :selected-id="selectedId"
      :is-expanded="isExpanded(node.id)"
      :get-is-expanded="isExpanded"
      :is-last="idx === nodes.length - 1"
      :guides="[]"
      :is-new-fn="isNewFn"
      @select="handleSelect"
      @toggle="handleToggle"
    />
  </div>
</template>

<style scoped>
.tree-view {
  font-size: 13px;
  line-height: 1.4;
  user-select: none;
}
</style>
