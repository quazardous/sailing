<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import ELK from 'elkjs/lib/elk.bundled.js';

interface DagNode {
  id: string;
  type: 'prd' | 'epic' | 'task';
  title: string;
  status: string;
  level: number;
}

interface DagEdge {
  from: string;
  to: string;
  type: 'hierarchy' | 'dependency';
}

interface DagData {
  nodes: DagNode[];
  edges: DagEdge[];
  criticalPath?: string[];
}

interface LayoutNode extends DagNode {
  x: number;
  y: number;
  isCritical: boolean;
}

interface LayoutEdge {
  from: string;
  to: string;
  type: 'hierarchy' | 'dependency';
  isCritical: boolean;
  sections: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
}

const props = defineProps<{
  data: DagData;
}>();

const emit = defineEmits<{
  (e: 'nodeClick', id: string, type: string): void;
}>();

// Node dimensions
const nodeWidth = 140;
const nodeHeight = 40;

// Layout state
const layoutNodes = ref<LayoutNode[]>([]);
const layoutEdges = ref<LayoutEdge[]>([]);
const graphWidth = ref(200);
const graphHeight = ref(100);
const isLoading = ref(true);

const elk = new ELK();

async function computeLayout() {
  if (!props.data?.nodes?.length) {
    layoutNodes.value = [];
    layoutEdges.value = [];
    graphWidth.value = 200;
    graphHeight.value = 100;
    isLoading.value = false;
    return;
  }

  isLoading.value = true;

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    },
    children: props.data.nodes.map(node => ({
      id: node.id,
      width: nodeWidth,
      height: nodeHeight,
      nodeType: node.type,
      nodeTitle: node.title,
      nodeStatus: node.status,
      nodeLevel: node.level
    })),
    edges: props.data.edges.map((edge, i) => ({
      id: `e${i}`,
      sources: [edge.from],
      targets: [edge.to],
      edgeType: edge.type
    }))
  };

  try {
    const layoutResult: any = await elk.layout(graph);
    const criticalSet = new Set(props.data.criticalPath || []);

    // Extract positioned nodes
    layoutNodes.value = (layoutResult.children || []).map((child: any) => ({
      id: child.id,
      type: child.nodeType,
      title: child.nodeTitle,
      status: child.nodeStatus,
      level: child.nodeLevel,
      x: child.x || 0,
      y: child.y || 0,
      isCritical: criticalSet.has(child.id)
    }));

    // Extract positioned edges
    layoutEdges.value = (layoutResult.edges || []).map((edge: any) => ({
      from: edge.sources[0],
      to: edge.targets[0],
      type: edge.edgeType,
      isCritical: criticalSet.has(edge.sources[0]) && criticalSet.has(edge.targets[0]),
      sections: edge.sections || []
    }));

    graphWidth.value = (layoutResult.width || 200) + 40;
    graphHeight.value = (layoutResult.height || 100) + 40;
  } catch (error) {
    console.error('ELK layout error:', error);
  }

  isLoading.value = false;
}

// Watch for data changes
watch(() => props.data, computeLayout, { deep: true, immediate: true });
onMounted(computeLayout);

const hoveredNode = ref<string | null>(null);

function getNodeClass(node: LayoutNode): string {
  const classes = ['dag-node', `dag-node-${node.type}`];
  const status = node.status?.toLowerCase().replace(/\s+/g, '-');
  if (status) {
    classes.push(`dag-status-${status}`);
  }
  if (node.isCritical) {
    classes.push('dag-node-critical');
  }
  if (hoveredNode.value === node.id) {
    classes.push('dag-node-hovered');
  }
  return classes.join(' ');
}

function getEdgeClass(edge: LayoutEdge): string {
  const classes = ['dag-edge'];
  classes.push(edge.type === 'dependency' ? 'dag-edge-dependency' : 'dag-edge-hierarchy');
  if (edge.isCritical) {
    classes.push('dag-edge-critical');
  }
  return classes.join(' ');
}

function getEdgePath(edge: LayoutEdge): string {
  if (!edge.sections || edge.sections.length === 0) return '';

  const section = edge.sections[0];
  let path = `M ${section.startPoint.x + 20} ${section.startPoint.y + 20}`;

  if (section.bendPoints && section.bendPoints.length > 0) {
    for (const bp of section.bendPoints) {
      path += ` L ${bp.x + 20} ${bp.y + 20}`;
    }
  }

  path += ` L ${section.endPoint.x + 20} ${section.endPoint.y + 20}`;
  return path;
}

function handleNodeClick(node: LayoutNode) {
  emit('nodeClick', node.id, node.type);
}

function truncateTitle(title: string, maxLen: number = 16): string {
  if (title.length <= maxLen) return title;
  return title.substring(0, maxLen - 1) + '…';
}
</script>

<template>
  <div class="dependency-graph">
    <!-- Legend at top (left-aligned like Gantt) -->
    <div class="dag-legend">
      <div class="dag-legend-item">
        <div class="dag-legend-color dag-color-prd"></div>
        <span>PRD</span>
      </div>
      <div class="dag-legend-item">
        <div class="dag-legend-color dag-color-epic"></div>
        <span>Epic</span>
      </div>
      <div class="dag-legend-item">
        <div class="dag-legend-color dag-color-task"></div>
        <span>Task</span>
      </div>
      <div class="dag-legend-item">
        <div class="dag-legend-color dag-color-done"></div>
        <span>Done</span>
      </div>
      <div class="dag-legend-item">
        <div class="dag-legend-color dag-color-wip"></div>
        <span>In Progress</span>
      </div>
      <div class="dag-legend-item">
        <div class="dag-legend-color dag-color-blocked"></div>
        <span>Blocked</span>
      </div>
      <div class="dag-legend-item dag-legend-separator"></div>
      <div class="dag-legend-item">
        <svg width="30" height="12">
          <line x1="0" y1="6" x2="25" y2="6" stroke="#666" stroke-width="1.5" />
          <polygon points="25,3 30,6 25,9" fill="#666" />
        </svg>
        <span>Hierarchy</span>
      </div>
      <div class="dag-legend-item">
        <svg width="30" height="12">
          <line x1="0" y1="6" x2="25" y2="6" stroke="#F59E0B" stroke-width="1.5" stroke-dasharray="4 2" />
          <polygon points="25,3 30,6 25,9" fill="#F59E0B" />
        </svg>
        <span>Dependency</span>
      </div>
      <div class="dag-legend-item">
        <div class="dag-legend-color dag-color-critical"></div>
        <span>Critical Path</span>
      </div>
    </div>

    <!-- Scrollable graph container -->
    <div class="dag-container">
      <div v-if="isLoading" class="loading">Loading...</div>
      <svg
        v-else
        :width="graphWidth"
        :height="graphHeight"
        class="dag-svg"
      >
        <!-- Arrow marker definitions and filters -->
        <defs>
          <marker
            id="arrowhead"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="#666" />
          </marker>
          <marker
            id="arrowhead-dependency"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="#F59E0B" />
          </marker>
          <marker
            id="arrowhead-critical"
            markerWidth="6"
            markerHeight="4"
            refX="5"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="#EF4444" />
          </marker>
          <!-- Glow filter for critical path -->
          <filter id="critical-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
            <feFlood flood-color="#EF4444" flood-opacity="0.6" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <!-- Edges (non-critical first, critical on top) -->
        <g class="dag-edges">
          <path
            v-for="(edge, i) in layoutEdges.filter(e => !e.isCritical)"
            :key="`edge-${i}`"
            :d="getEdgePath(edge)"
            :class="getEdgeClass(edge)"
            :marker-end="edge.type === 'dependency' ? 'url(#arrowhead-dependency)' : 'url(#arrowhead)'"
            fill="none"
          />
          <path
            v-for="(edge, i) in layoutEdges.filter(e => e.isCritical)"
            :key="`edge-critical-${i}`"
            :d="getEdgePath(edge)"
            :class="getEdgeClass(edge)"
            marker-end="url(#arrowhead-critical)"
            fill="none"
          />
        </g>

        <!-- Nodes -->
        <g class="dag-nodes">
          <g
            v-for="node in layoutNodes"
            :key="node.id"
            :transform="`translate(${node.x + 20}, ${node.y + 20})`"
            :class="getNodeClass(node)"
            @click="handleNodeClick(node)"
            @mouseenter="hoveredNode = node.id"
            @mouseleave="hoveredNode = null"
            style="cursor: pointer;"
          >
            <!-- Critical glow underlay -->
            <rect
              v-if="node.isCritical"
              :width="nodeWidth"
              :height="nodeHeight"
              :rx="6"
              class="dag-node-glow"
              filter="url(#critical-glow)"
            />
            <rect
              :width="nodeWidth"
              :height="nodeHeight"
              :rx="6"
              class="dag-node-bg"
            />
            <text
              :x="nodeWidth / 2"
              :y="15"
              class="dag-node-id"
            >{{ node.id }}</text>
            <text
              :x="nodeWidth / 2"
              :y="30"
              class="dag-node-title"
            >{{ truncateTitle(node.title) }}</text>
          </g>
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.dependency-graph {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.dag-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.dag-svg {
  display: block;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
  color: var(--text-dim);
}

/* Edges */
.dag-edge-hierarchy {
  stroke: #666;
  stroke-width: 1.5;
}

.dag-edge-dependency {
  stroke: #F59E0B;
  stroke-width: 1.5;
  stroke-dasharray: 6 3;
}

/* Node backgrounds by type */
.dag-node-prd .dag-node-bg {
  fill: #3B82F6;
  stroke: #1E40AF;
  stroke-width: 2;
}

.dag-node-epic .dag-node-bg {
  fill: #10B981;
  stroke: #047857;
  stroke-width: 2;
}

.dag-node-task .dag-node-bg {
  fill: #4B5563;
  stroke: #374151;
  stroke-width: 2;
}

/* Status overrides */
.dag-status-done .dag-node-bg {
  fill: #059669;
  stroke: #047857;
}

.dag-status-blocked .dag-node-bg {
  fill: #EF4444;
  stroke: #DC2626;
}

.dag-status-in-progress .dag-node-bg,
.dag-status-wip .dag-node-bg {
  fill: #F59E0B;
  stroke: #D97706;
}

/* Hover state */
.dag-node-hovered .dag-node-bg {
  filter: brightness(1.2);
  stroke-width: 3;
}

/* Critical path styles */
.dag-node-critical .dag-node-bg {
  stroke: #EF4444;
  stroke-width: 2;
}

.dag-node-glow {
  fill: #EF4444;
}

.dag-edge-critical {
  stroke: #EF4444 !important;
  stroke-width: 2 !important;
}

/* Node text */
.dag-node-id {
  fill: #fff;
  font-size: 11px;
  font-weight: 600;
  text-anchor: middle;
}

.dag-node-title {
  fill: rgba(255, 255, 255, 0.85);
  font-size: 10px;
  text-anchor: middle;
}

/* Legend at top (left-aligned like Gantt) */
.dag-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: var(--spacing-md);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--border, #333);
}

.dag-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
}

.dag-legend-separator {
  width: 1px;
  height: 16px;
  background: var(--border, #333);
  margin: 0 var(--spacing-sm);
}

.dag-legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.dag-color-prd { background: #3B82F6; }
.dag-color-epic { background: #10B981; }
.dag-color-task { background: #4B5563; }
.dag-color-done { background: #059669; }
.dag-color-wip { background: #F59E0B; }
.dag-color-blocked { background: #EF4444; }
.dag-color-critical {
  background: #EF4444;
  box-shadow: 0 0 6px 2px rgba(239, 68, 68, 0.6);
}
</style>
