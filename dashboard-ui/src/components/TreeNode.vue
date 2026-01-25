<script setup lang="ts">
import { computed } from 'vue';
import type { TreeNodeData } from './TreeView.vue';

const props = withDefaults(defineProps<{
  node: TreeNodeData;
  level?: number;
  selectedId?: string | null;
  isExpanded?: boolean;
  getIsExpanded?: (id: string) => boolean;
  isLast?: boolean;
  guides?: boolean[];  // For each ancestor level: true = show vertical line
  isNewFn?: (id: string) => boolean;  // Check if node has "new" flag
}>(), {
  level: 0,
  selectedId: null,
  isExpanded: true,
  isLast: false,
  guides: () => [],
  isNewFn: () => false,
});

const emit = defineEmits<{
  select: [node: TreeNodeData];
  toggle: [node: TreeNodeData];
}>();

const hasChildren = computed(() => props.node.children && props.node.children.length > 0);
// Show chevron for folders (prd/epic) even if empty - they can have children
const isFolder = computed(() => {
  const type = props.node.data?.type;
  return type === 'prd' || type === 'epic';
});
const showChevron = computed(() => hasChildren.value || isFolder.value);
const isSelected = computed(() => props.selectedId === props.node.id);
const isNew = computed(() => props.isNewFn(props.node.id));

// Count new items in all descendants (recursive)
function countNewDescendants(node: TreeNodeData): number {
  let count = 0;
  if (node.children) {
    for (const child of node.children) {
      if (props.isNewFn(child.id)) count++;
      count += countNewDescendants(child);
    }
  }
  return count;
}

// Number of new descendants (only counted when collapsed)
const newDescendantsCount = computed(() => {
  if (props.isExpanded) return 0;
  return countNewDescendants(props.node);
});

// Should show orange "new" style?
// - If node itself is new: always orange
// - If collapsed with new descendants: orange (inherited from children)
// - If expanded with new descendants but not new itself: NOT orange
const showNewStyle = computed(() => {
  if (isNew.value) return true;
  if (!props.isExpanded && newDescendantsCount.value > 0) return true;
  return false;
});

// Build guides for children:
// - Keep ancestor guides
// - Add current node's continuation status (true if NOT last sibling)
const childGuides = computed(() => [...props.guides, !props.isLast]);

// Generate spacer array for rendering
// Each spacer shows a vertical line based on guides array
// guides[i] = true if ancestor at level i has siblings after this branch
const spacers = computed(() => {
  const result: Array<{ showLine: boolean }> = [];
  for (let i = 0; i < props.level; i++) {
    result.push({ showLine: props.guides[i] || false });
  }
  return result;
});

function handleClick() {
  emit('select', props.node);
}

function handleToggle(event: Event) {
  event.stopPropagation();
  emit('toggle', props.node);
}

function getChildExpanded(childId: string): boolean {
  return props.getIsExpanded ? props.getIsExpanded(childId) : true;
}
</script>

<template>
  <div class="tree-node-wrapper">
    <div
      class="tree-node"
      :class="{ selected: isSelected, expandable: hasChildren, 'is-new': showNewStyle }"
      @click="handleClick"
    >
      <!-- Spacers: empty bricks for indentation, each can show a vertical line -->
      <div
        v-for="(spacer, idx) in spacers"
        :key="'spacer-' + idx"
        class="tree-spacer"
      >
        <div v-if="spacer.showLine" class="tree-line"></div>
      </div>

      <!-- Chevron cell: same size as spacers -->
      <div class="tree-spacer tree-chevron-cell">
        <span
          v-if="showChevron"
          class="tree-chevron"
          :class="{ expanded: isExpanded && hasChildren, empty: !hasChildren }"
          @click="handleToggle"
        >
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              stroke-width="1.5"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </div>

      <!-- Icon -->
      <span
        v-if="node.icon"
        class="tree-icon"
        :class="node.iconColor ? 'icon-' + node.iconColor : ''"
      >
        {{ node.icon }}
      </span>

      <!-- Label -->
      <span class="tree-label">
        <span class="tree-label-primary">{{ node.label }}</span>
        <span v-if="node.secondaryLabel" class="tree-label-secondary">{{ node.secondaryLabel }}</span>
      </span>

      <!-- Status dot -->
      <span
        v-if="node.status && node.status !== 'default'"
        class="tree-status"
        :class="'status-' + node.status"
      ></span>

      <!-- Badge -->
      <span
        v-if="node.badge !== undefined"
        class="tree-badge"
        :class="node.badgeVariant ? 'badge-' + node.badgeVariant : ''"
      >
        {{ node.badge }}
      </span>

      <!-- New indicator (orange dot on right) -->
      <span v-if="isNew" class="tree-new-indicator">●</span>
      <!-- New descendants count (shown when collapsed) -->
      <span v-else-if="newDescendantsCount > 0" class="tree-new-count">{{ newDescendantsCount }}</span>
    </div>

    <!-- Children (recursive) -->
    <div v-if="hasChildren && isExpanded" class="tree-children">
      <TreeNode
        v-for="(child, idx) in node.children"
        :key="child.id"
        :node="child"
        :level="level + 1"
        :selected-id="selectedId"
        :is-expanded="getChildExpanded(child.id)"
        :get-is-expanded="getIsExpanded"
        :is-last="idx === node.children!.length - 1"
        :guides="childGuides"
        :is-new-fn="isNewFn"
        @select="(n: TreeNodeData) => emit('select', n)"
        @toggle="(n: TreeNodeData) => emit('toggle', n)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-node {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 2px 12px 2px 0;
  cursor: pointer;
  border-radius: 4px;
  margin: 0;
  transition: background-color 0.1s ease;
  height: 24px;
}

.tree-node:hover {
  background: var(--bg-hover, rgba(255, 255, 255, 0.05));
}

.tree-node.selected {
  background: var(--accent, #0078d4);
  color: white;
}

.tree-node.selected .tree-label-secondary {
  color: rgba(255, 255, 255, 0.8);
}

/* New (unviewed) item - slight orange tint */
.tree-node.is-new {
  background: rgba(251, 147, 60, 0.1);
}

.tree-node.is-new:hover {
  background: rgba(251, 147, 60, 0.15);
}

.tree-node.is-new.selected {
  background: var(--accent, #0078d4);
}

.tree-node.selected .tree-chevron {
  color: rgba(255, 255, 255, 0.8);
}

/* Spacer brick - fixed size cell */
.tree-spacer {
  width: 20px;
  height: 24px;
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Vertical guide line inside spacer - centered under parent's chevron */
.tree-line {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--guide-line-color, rgba(255, 255, 255, 0.2));
  transform: translateX(-50%);
}

/* Chevron cell is also a spacer brick */
.tree-chevron-cell {
  /* inherits .tree-spacer styles */
}

.tree-chevron {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-dim, #888);
  transition: transform 0.15s ease;
}

.tree-chevron.expanded {
  transform: rotate(90deg);
}

.tree-chevron:hover {
  color: var(--text, #fff);
}

.tree-chevron.empty {
  opacity: 0.4;
}

.tree-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 12px;
  margin-left: 2px;
}

.tree-icon.icon-blue { color: #60a5fa; }
.tree-icon.icon-green { color: #34d399; }
.tree-icon.icon-yellow { color: #fbbf24; }
.tree-icon.icon-red { color: #f87171; }
.tree-icon.icon-purple { color: #a78bfa; }
.tree-icon.icon-orange { color: #fb923c; }
.tree-icon.icon-gray { color: #9ca3af; }

.tree-label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  margin-left: 4px;
}

.tree-label-primary {
  font-weight: 500;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-label-secondary {
  color: var(--text-dim, #888);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
}

.tree-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tree-status.status-success { background: #34d399; }
.tree-status.status-warning { background: #fbbf24; }
.tree-status.status-error { background: #f87171; }
.tree-status.status-info { background: #60a5fa; }
.tree-status.status-active {
  background: #34d399;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.tree-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.1));
  color: var(--text-dim, #888);
  flex-shrink: 0;
  font-weight: 500;
}

.tree-badge.badge-success {
  background: rgba(52, 211, 153, 0.2);
  color: #34d399;
}

.tree-badge.badge-warning {
  background: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
}

.tree-badge.badge-error {
  background: rgba(248, 113, 113, 0.2);
  color: #f87171;
}

.tree-badge.badge-info {
  background: rgba(96, 165, 250, 0.2);
  color: #60a5fa;
}

.tree-node.selected .tree-badge {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

/* New indicator styles */
.tree-new-indicator {
  color: #fb923c;
  font-size: 10px;
  flex-shrink: 0;
  margin-left: 4px;
}

.tree-new-count {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 8px;
  background: rgba(251, 147, 60, 0.2);
  color: #fb923c;
  flex-shrink: 0;
  margin-left: 4px;
  font-weight: 500;
}

/* Ensure no offset from wrapper/children */
.tree-node-wrapper {
  margin: 0;
  padding: 0;
}

.tree-children {
  margin: 0;
  padding: 0;
}
</style>
