<script setup lang="ts">
import { ref, computed } from 'vue';
import { useUiStore } from '../stores/ui';

const uiStore = useUiStore();

interface GanttTask {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  durationHours: number;
  status: string;
  isCritical: boolean;
  dependencies: string[];
}

interface GanttData {
  tasks: GanttTask[];
  criticalPath: string[];
  totalHours: number;
  t0: string;
  durationHours: number;
  criticalTimespanHours: number;
}

const props = defineProps<{
  data: GanttData;
}>();

const startDate = computed(() => new Date(props.data?.t0 || new Date().toISOString()));

const config = computed(() => {
  const configs = {
    hour: { unitWidth: 40, labelInterval: 4 },
    day: { unitWidth: 25, labelInterval: 24 },
    week: { unitWidth: 6, labelInterval: 40 },
  };
  return configs[uiStore.ganttZoomMode];
});

const rowHeight = 36;
const labelWidth = 320;
const headerHeight = 40; // Extra space for critical arrow
const paddingRight = 100; // Space for labels
const paddingBottom = 20;

// Safe accessor for tasks
const tasks = computed(() => props.data?.tasks || []);

// Calculate display offset - start at first task minus 1 hour margin
const displayStartHour = computed(() => {
  if (tasks.value.length === 0) return 0;
  const minStart = Math.min(...tasks.value.map(t => t.startHour));
  return Math.max(0, minStart - 1); // 1 hour margin, but never negative
});

// Adjusted total hours for display (from displayStartHour to end)
const displayTotalHours = computed(() => {
  return (props.data?.totalHours || 8) - displayStartHour.value;
});

const chartWidth = computed(() => {
  return labelWidth + displayTotalHours.value * config.value.unitWidth + paddingRight;
});

const chartHeight = computed(() => {
  return headerHeight + tasks.value.length * rowHeight + paddingBottom;
});

// Task index map for quick lookup
const taskIndexMap = computed(() => {
  const map = new Map<string, number>();
  tasks.value.forEach((task, index) => {
    map.set(task.id, index);
  });
  return map;
});

// Dependency lines (arrows connecting tasks)
interface DependencyLine {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isCritical: boolean;
}

const dependencyLines = computed(() => {
  const lines: DependencyLine[] = [];
  const criticalSet = new Set(props.data?.criticalPath || []);

  for (const task of tasks.value) {
    if (!task.dependencies || task.dependencies.length === 0) continue;

    const taskIndex = taskIndexMap.value.get(task.id);
    if (taskIndex === undefined) continue;

    // Task bar start position (left edge) - adjusted for display offset
    const toX = labelWidth + (task.startHour - displayStartHour.value) * config.value.unitWidth;
    const toY = headerHeight + taskIndex * rowHeight + rowHeight / 2;

    for (const depId of task.dependencies) {
      const depIndex = taskIndexMap.value.get(depId);
      if (depIndex === undefined) continue;

      const depTask = tasks.value[depIndex];

      // Dependency bar end position (right edge) - adjusted for display offset
      const fromX = labelWidth + (depTask.endHour - displayStartHour.value) * config.value.unitWidth;
      const fromY = headerHeight + depIndex * rowHeight + rowHeight / 2;

      // Check if this is a critical path dependency
      const isCritical = criticalSet.has(task.id) && criticalSet.has(depId);

      lines.push({ fromX, fromY, toX, toY, isCritical });
    }
  }

  return lines;
});

// Generate SVG path for dependency arrow (L-shape with rounded corner, arrow points down)
function getDependencyPath(line: DependencyLine): string {
  const { fromX, fromY, toX, toY } = line;
  const r = 4; // corner radius

  // Drop point is above the target bar
  const dropX = toX + 4;
  const targetY = toY - (rowHeight / 2) + 4; // Top of target bar

  if (Math.abs(fromY - toY) < 5) {
    // Same row - straight horizontal line to bar start
    return `M ${fromX} ${fromY} H ${toX - 6}`;
  }

  // L-shaped path: horizontal -> rounded corner -> vertical down
  return `M ${fromX} ${fromY} H ${dropX - r} Q ${dropX} ${fromY} ${dropX} ${fromY + r} V ${targetY}`;
}

// Time labels - start from displayStartHour
const timeLabels = computed(() => {
  const labels: Array<{ x: number; label: string }> = [];
  const interval = config.value.labelInterval;
  const startH = displayStartHour.value;
  const endH = props.data.totalHours;

  // Align to interval boundary
  const firstLabel = Math.ceil(startH / interval) * interval;

  for (let h = firstLabel; h <= endH; h += interval) {
    const x = labelWidth + (h - startH) * config.value.unitWidth;
    const d = new Date(startDate.value);
    d.setHours(d.getHours() + h);

    let label = '';
    if (uiStore.ganttZoomMode === 'hour') {
      label = `${d.getHours()}h`;
    } else {
      const day = d.getDate();
      const month = d.toLocaleString('default', { month: 'short' });
      label = `${day} ${month}`;
    }

    labels.push({ x, label });
  }
  return labels;
});

// Grid lines - start from displayStartHour
const gridLines = computed(() => {
  const lines: number[] = [];
  const interval = config.value.labelInterval;
  const startH = displayStartHour.value;
  const endH = props.data.totalHours;

  // Align to interval boundary
  const firstLine = Math.ceil(startH / interval) * interval;

  for (let h = firstLine; h <= endH; h += interval) {
    lines.push(labelWidth + (h - startH) * config.value.unitWidth);
  }
  return lines;
});

// Today line position - adjusted for display offset
const todayLineX = computed(() => {
  const now = new Date();
  const hoursSinceT0 = (now.getTime() - startDate.value.getTime()) / (1000 * 60 * 60);
  const adjustedHours = hoursSinceT0 - displayStartHour.value;
  if (adjustedHours >= 0 && hoursSinceT0 <= props.data.totalHours) {
    return labelWidth + adjustedHours * config.value.unitWidth;
  }
  return null;
});

// Critical span end line position - adjusted for display offset
const criticalLineX = computed(() => {
  const criticalHours = props.data?.criticalTimespanHours;
  if (!criticalHours || criticalHours <= 0 || tasks.value.length === 0) return null;

  const earliestStartHour = Math.min(...tasks.value.map(t => t.startHour));
  const criticalEndHour = earliestStartHour + criticalHours;

  if (criticalEndHour >= 0 && criticalEndHour <= props.data.totalHours) {
    return labelWidth + (criticalEndHour - displayStartHour.value) * config.value.unitWidth;
  }
  return null;
});

// Critical span arrow data - adjusted for display offset
const criticalArrow = computed(() => {
  const criticalHours = props.data?.criticalTimespanHours;
  if (!criticalHours || criticalHours <= 0 || tasks.value.length === 0) return null;

  const earliestStartHour = Math.min(...tasks.value.map(t => t.startHour));
  const startX = labelWidth + (earliestStartHour - displayStartHour.value) * config.value.unitWidth;
  const endX = startX + criticalHours * config.value.unitWidth;
  const y = headerHeight - 4;

  return {
    startX,
    endX,
    y,
    label: `${Math.round(criticalHours * 10) / 10}h critical`
  };
});

function getStatusClass(status: string): string {
  if (status === 'Done') return 'done';
  if (status === 'In Progress' || status === 'WIP') return 'active';
  if (status === 'Blocked') return 'blocked';
  return 'pending';
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Math.round(hours * 10) / 10}h`;
}

// Calculate actual task span (from first task start to last task end)
const actualTaskSpan = computed(() => {
  if (tasks.value.length === 0) return 0;
  const minStart = Math.min(...tasks.value.map(t => t.startHour));
  const maxEnd = Math.max(...tasks.value.map(t => t.endHour));
  return maxEnd - minStart;
});

// Stats
const stats = computed(() => {
  const items: string[] = [];
  const criticalPath = props.data?.criticalPath || [];
  items.push(`${criticalPath.length} tasks on critical path`);
  items.push(`${formatDuration(props.data?.durationHours || 0)} effort`);
  items.push(`${formatDuration(props.data?.criticalTimespanHours || 0)} critical`);
  items.push(`${formatDuration(actualTaskSpan.value)} span`);
  return items;
});

// Tooltip state
const tooltip = ref<{
  visible: boolean;
  x: number;
  y: number;
  task: GanttTask | null;
}>({ visible: false, x: 0, y: 0, task: null });

const tooltipRef = ref<HTMLDivElement | null>(null);

function showTooltip(event: MouseEvent, task: GanttTask) {
  tooltip.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    task
  };

  // Adjust position after render to account for tooltip size and window bounds
  requestAnimationFrame(() => {
    if (!tooltipRef.value) return;

    const rect = tooltipRef.value.getBoundingClientRect();
    const padding = 10;
    let x = event.clientX;
    let y = event.clientY - rect.height - padding;

    // Check right edge
    if (x + rect.width / 2 > window.innerWidth - padding) {
      x = window.innerWidth - rect.width / 2 - padding;
    }
    // Check left edge
    if (x - rect.width / 2 < padding) {
      x = rect.width / 2 + padding;
    }
    // Check top edge - flip below if not enough space
    if (y < padding) {
      y = event.clientY + padding;
    }
    // Check bottom edge
    if (y + rect.height > window.innerHeight - padding) {
      y = window.innerHeight - rect.height - padding;
    }

    tooltip.value.x = x;
    tooltip.value.y = y;
  });
}

function updateTooltipPosition(event: MouseEvent) {
  if (!tooltip.value.visible || !tooltipRef.value) return;

  const rect = tooltipRef.value.getBoundingClientRect();
  const padding = 10;
  let x = event.clientX;
  let y = event.clientY - rect.height - padding;

  // Check right edge
  if (x + rect.width / 2 > window.innerWidth - padding) {
    x = window.innerWidth - rect.width / 2 - padding;
  }
  // Check left edge
  if (x - rect.width / 2 < padding) {
    x = rect.width / 2 + padding;
  }
  // Check top edge - flip below if not enough space
  if (y < padding) {
    y = event.clientY + padding;
  }

  tooltip.value.x = x;
  tooltip.value.y = y;
}

function hideTooltip() {
  tooltip.value.visible = false;
}

function formatDate(hours: number): string {
  const d = new Date(startDate.value);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>

<template>
  <div class="gantt-wrapper">
    <!-- Legend -->
    <div class="gantt-legend">
      <div class="gantt-legend-item">
        <div class="gantt-legend-color pending"></div>
        Not Started
      </div>
      <div class="gantt-legend-item">
        <div class="gantt-legend-color active"></div>
        In Progress
      </div>
      <div class="gantt-legend-item">
        <div class="gantt-legend-color done"></div>
        Done
      </div>
      <div class="gantt-legend-item">
        <div class="gantt-legend-color critical"></div>
        Critical Path
      </div>
      <span class="gantt-stats">{{ stats.join(' | ') }}</span>
    </div>

    <!-- Zoom controls -->
    <div class="gantt-controls">
      <button
        class="gantt-zoom"
        :class="{ active: uiStore.ganttZoomMode === 'hour' }"
        @click="uiStore.setGanttZoomMode('hour')"
      >Hour</button>
      <button
        class="gantt-zoom"
        :class="{ active: uiStore.ganttZoomMode === 'day' }"
        @click="uiStore.setGanttZoomMode('day')"
      >Day</button>
      <button
        class="gantt-zoom"
        :class="{ active: uiStore.ganttZoomMode === 'week' }"
        @click="uiStore.setGanttZoomMode('week')"
      >Week</button>
    </div>

    <!-- Chart -->
    <div class="gantt-container">
      <svg :width="chartWidth" :height="chartHeight" class="gantt-svg">
        <!-- Arrow marker definitions -->
        <defs>
          <!-- Clip path for label area -->
          <clipPath id="label-clip">
            <rect x="0" y="0" :width="labelWidth - 10" :height="chartHeight" />
          </clipPath>
          <marker
            id="arrow-down"
            viewBox="0 0 4 4"
            refX="2"
            refY="4"
            markerWidth="4"
            markerHeight="4"
            orient="0"
          >
            <polygon points="0.5 0, 3.5 0, 2 4" fill="#6B7280" />
          </marker>
          <marker
            id="arrow-down-critical"
            viewBox="0 0 4 4"
            refX="2"
            refY="4"
            markerWidth="4"
            markerHeight="4"
            orient="0"
          >
            <polygon points="0.5 0, 3.5 0, 2 4" fill="#EF4444" />
          </marker>
          <marker
            id="arrow-right-critical"
            viewBox="0 0 5 3"
            refX="5"
            refY="1.5"
            markerWidth="5"
            markerHeight="3"
            orient="auto"
          >
            <polygon points="0 0, 5 1.5, 0 3" fill="#EF4444" />
          </marker>
          <!-- Glow filter for critical path -->
          <filter id="critical-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <!-- Row backgrounds (first, so grid lines appear on top) -->
        <g class="row-backgrounds">
          <rect
            v-for="(task, index) in tasks"
            :key="'bg-' + task.id"
            :x="0"
            :y="headerHeight + index * rowHeight"
            :width="chartWidth"
            :height="rowHeight"
            :class="index % 2 === 0 ? 'row-even' : 'row-odd'"
          />
        </g>

        <!-- Grid lines -->
        <g class="grid-lines">
          <line
            v-for="x in gridLines"
            :key="x"
            :x1="x"
            :y1="headerHeight"
            :x2="x"
            :y2="chartHeight"
            class="grid-line"
          />
        </g>

        <!-- Time labels -->
        <g class="time-labels">
          <text
            v-for="label in timeLabels"
            :key="label.x"
            :x="label.x"
            :y="headerHeight - 8"
            class="time-label"
          >{{ label.label }}</text>
        </g>

        <!-- Today line (blue dashed) -->
        <line
          v-if="todayLineX !== null"
          :x1="todayLineX"
          :y1="headerHeight"
          :x2="todayLineX"
          :y2="chartHeight"
          class="today-line"
        />

        <!-- Critical span end line (yellow dashed) -->
        <line
          v-if="criticalLineX !== null"
          :x1="criticalLineX"
          :y1="headerHeight"
          :x2="criticalLineX"
          :y2="chartHeight"
          class="critical-end-line"
        />

        <!-- Critical span arrow at top -->
        <g v-if="criticalArrow" class="critical-arrow">
          <line
            :x1="criticalArrow.startX"
            :y1="criticalArrow.y"
            :x2="criticalArrow.endX"
            :y2="criticalArrow.y"
            stroke="#EF4444"
            stroke-width="2"
            marker-end="url(#arrow-right-critical)"
          />
          <text
            :x="criticalArrow.endX + 8"
            :y="criticalArrow.y + 4"
            class="critical-arrow-label"
          >{{ criticalArrow.label }}</text>
        </g>

        <!-- Dependency lines (drawn before bars so bars are on top) -->
        <g class="dependency-lines">
          <!-- Normal arrows first -->
          <path
            v-for="(line, index) in dependencyLines.filter(l => !l.isCritical)"
            :key="'dep-' + index"
            :d="getDependencyPath(line)"
            class="dependency-line"
            marker-end="url(#arrow-down)"
          />
          <!-- Critical arrows on top -->
          <path
            v-for="(line, index) in dependencyLines.filter(l => l.isCritical)"
            :key="'dep-crit-' + index"
            :d="getDependencyPath(line)"
            class="dependency-line critical"
            marker-end="url(#arrow-down-critical)"
          />
        </g>

        <!-- Task labels (rendered before bars so they appear behind) -->
        <g class="task-labels">
          <text
            v-for="(task, index) in tasks"
            :key="'label-' + task.id"
            :x="8"
            :y="headerHeight + index * rowHeight + rowHeight / 2 + 4"
            class="task-label"
          >
            <tspan class="task-id">{{ task.id }}</tspan>
            <tspan dx="8" class="task-name">{{ task.name.replace(task.id, '').trim() }}</tspan>
          </text>
        </g>

        <!-- Task bars -->
        <g class="task-bars">
          <g v-for="(task, index) in tasks" :key="'bar-' + task.id">
            <!-- Task ref before bar (discrete, aligned to top) -->
            <text
              :x="labelWidth + (task.startHour - displayStartHour) * config.unitWidth - 8"
              :y="headerHeight + index * rowHeight + 16"
              class="task-ref"
              text-anchor="end"
            >{{ task.id }}</text>
            <!-- Main bar -->
            <rect
              :x="labelWidth + (task.startHour - displayStartHour) * config.unitWidth"
              :y="headerHeight + index * rowHeight + 8"
              :width="Math.max(task.durationHours * config.unitWidth, 4)"
              :height="rowHeight - 16"
              :rx="4"
              :class="[
                'task-bar',
                getStatusClass(task.status),
                { critical: task.isCritical }
              ]"
              @mouseenter="showTooltip($event, task)"
              @mousemove="updateTooltipPosition($event)"
              @mouseleave="hideTooltip"
            />
            <!-- Critical glow overlay -->
            <rect
              v-if="task.isCritical"
              :x="labelWidth + (task.startHour - displayStartHour) * config.unitWidth - 1"
              :y="headerHeight + index * rowHeight + 7"
              :width="Math.max(task.durationHours * config.unitWidth, 4) + 2"
              :height="rowHeight - 14"
              :rx="5"
              class="task-bar-critical-glow"
              filter="url(#critical-glow)"
            />
            <!-- Duration label inside bar -->
            <text
              v-if="task.durationHours * config.unitWidth > 30"
              :x="labelWidth + (task.startHour - displayStartHour) * config.unitWidth + (task.durationHours * config.unitWidth) / 2"
              :y="headerHeight + index * rowHeight + rowHeight / 2 + 4"
              class="bar-label"
            >{{ formatDuration(task.durationHours) }}</text>
          </g>
        </g>
      </svg>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip.visible && tooltip.task"
        ref="tooltipRef"
        class="gantt-tooltip"
        :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
      >
        <div class="tooltip-title">{{ tooltip.task.name }}</div>
        <div class="tooltip-row">
          <span class="tooltip-label">Start:</span>
          <span class="tooltip-value">{{ formatDate(tooltip.task.startHour) }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">End:</span>
          <span class="tooltip-value">{{ formatDate(tooltip.task.endHour) }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Duration:</span>
          <span class="tooltip-value">{{ formatDuration(tooltip.task.durationHours) }}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Status:</span>
          <span class="tooltip-value">{{ tooltip.task.status }}</span>
        </div>
        <div v-if="tooltip.task.dependencies?.length" class="tooltip-row">
          <span class="tooltip-label">Blocked by:</span>
          <span class="tooltip-value">{{ tooltip.task.dependencies.join(', ') }}</span>
        </div>
        <div v-if="tooltip.task.isCritical" class="tooltip-critical">
          ⚡ Critical Path
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.gantt-wrapper {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  height: 100%;
  min-height: 0;
  position: relative;
}

.gantt-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
}

.gantt-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
}

.gantt-legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.gantt-legend-color.pending { background: #64748B; }
.gantt-legend-color.active { background: #FBBF24; }
.gantt-legend-color.done { background: #059669; }
.gantt-legend-color.critical { background: #EF4444; }

.gantt-stats {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-dim);
}

.gantt-controls {
  display: flex;
  gap: 4px;
}

.gantt-zoom {
  padding: 4px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.gantt-zoom:hover {
  background: var(--bg-secondary);
  color: var(--text);
}

.gantt-zoom.active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.gantt-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bg);
  border-radius: var(--radius-md);
}

.gantt-svg {
  display: block;
}

.grid-line {
  stroke: var(--border);
  stroke-width: 1;
  opacity: 0.3;
}

.time-label {
  fill: var(--text-dim);
  font-size: 11px;
  text-anchor: middle;
}

.row-even {
  fill: var(--bg);
}

.row-odd {
  fill: rgba(0, 0, 0, 0.05);
}

/* Today line - darker blue dashed */
.today-line {
  stroke: #2563EB;
  stroke-width: 2;
  stroke-dasharray: 4 2;
  filter: drop-shadow(0 0 2px #2563EB);
}

/* Critical span end line - yellow dashed */
.critical-end-line {
  stroke: #F59E0B;
  stroke-width: 2;
  stroke-dasharray: 4 2;
  filter: drop-shadow(0 0 2px #F59E0B);
}

/* Critical arrow label */
.critical-arrow-label {
  fill: #EF4444;
  font-size: 10px;
  font-weight: 500;
}

.task-label {
  fill: var(--text);
  font-size: 12px;
}

.task-label .task-id {
  font-weight: 600;
  fill: var(--accent);
}

/* Task ref before bar (discrete) */
.task-ref {
  fill: var(--text-dim, #666);
  font-size: 9px;
  opacity: 0.6;
}

.task-bar {
  transition: opacity 0.15s;
  cursor: pointer;
}

.task-bar:hover {
  opacity: 0.8;
}

.task-bar.pending {
  fill: #64748B;
}

.task-bar.active {
  fill: #FBBF24;
}

.task-bar.done {
  fill: #059669;
}

.task-bar.blocked {
  fill: #EF4444;
}

.task-bar.critical {
  stroke: #EF4444;
  stroke-width: 1;
}

.task-bar-critical-glow {
  fill: none;
  stroke: #EF4444;
  stroke-width: 1;
  pointer-events: none;
  opacity: 0.8;
}

.bar-label {
  fill: white;
  font-size: 10px;
  text-anchor: middle;
  font-weight: 500;
  pointer-events: none;
}

/* Dependency lines */
.dependency-line {
  fill: none;
  stroke: #6B7280;
  stroke-width: 1;
  stroke-linecap: square;
  stroke-linejoin: miter;
  opacity: 0.6;
  vector-effect: non-scaling-stroke;
}

.dependency-line.critical {
  stroke: #EF4444;
  stroke-width: 1;
  stroke-linecap: square;
  stroke-linejoin: miter;
  opacity: 0.9;
  filter: drop-shadow(0 0 2px #EF4444);
  vector-effect: non-scaling-stroke;
}

</style>

<!-- Unscoped styles for teleported tooltip -->
<style>
.gantt-tooltip {
  position: fixed;
  background: var(--bg-secondary, #2d2d2d);
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  z-index: 10000;
  pointer-events: none;
  transform: translateX(-50%);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  max-width: 320px;
}

.gantt-tooltip .tooltip-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text, #fff);
  border-bottom: 1px solid var(--border, #444);
  padding-bottom: 6px;
}

.gantt-tooltip .tooltip-row {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

.gantt-tooltip .tooltip-label {
  color: var(--text-dim, #888);
  min-width: 70px;
}

.gantt-tooltip .tooltip-value {
  color: var(--text, #fff);
  font-weight: 500;
}

.gantt-tooltip .tooltip-critical {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border, #444);
  color: #EF4444;
  font-weight: 600;
}
</style>
