<script setup lang="ts">
import { computed } from 'vue';

interface SimpleGanttTask {
  id: string;
  name: string;
  startHour: number;
  endHour: number;
  durationHours: number;
  status: string;
  progress: number;
  criticalTimespanHours?: number;
}

interface OverviewGanttData {
  tasks: SimpleGanttTask[];
  totalHours: number;
  t0: string;
}

const props = defineProps<{
  data: OverviewGanttData;
}>();

const startDate = computed(() => new Date(props.data?.t0 || new Date().toISOString()));

const rowHeight = 32;
const labelWidth = 280;
const headerHeight = 24;
const paddingRight = 20;

// Fixed unit width for simplicity
const tasks = computed(() => props.data?.tasks || []);

// Calculate display offset - start at first task minus 1 hour margin
const displayStartHour = computed(() => {
  if (tasks.value.length === 0) return 0;
  const minStart = Math.min(...tasks.value.map(t => t.startHour));
  return Math.max(0, minStart - 1); // 1 hour margin, but never negative
});

// Adjusted total hours for display
const displayTotalHours = computed(() => {
  return (props.data?.totalHours || 8) - displayStartHour.value;
});

const unitWidth = computed(() => {
  const hours = displayTotalHours.value || 8;
  const availableWidth = 400; // Target width
  return Math.max(2, Math.min(10, availableWidth / hours));
});

const chartWidth = computed(() => {
  return labelWidth + displayTotalHours.value * unitWidth.value + paddingRight;
});

const chartHeight = computed(() => {
  return headerHeight + tasks.value.length * rowHeight + 10;
});

// Today line position - adjusted for display offset
const todayLineX = computed(() => {
  const now = new Date();
  const hoursSinceT0 = (now.getTime() - startDate.value.getTime()) / (1000 * 60 * 60);
  const adjustedHours = hoursSinceT0 - displayStartHour.value;
  if (adjustedHours >= 0 && hoursSinceT0 <= (props.data?.totalHours || 0)) {
    return labelWidth + adjustedHours * unitWidth.value;
  }
  return null;
});

// Time labels (simplified - just show start/end dates) - adjusted for display offset
const timeLabels = computed(() => {
  const labels: Array<{ x: number; label: string }> = [];
  const startH = displayStartHour.value;
  const endH = props.data.totalHours || 8;
  const interval = Math.max(Math.ceil(displayTotalHours.value / 5), 24); // At most 5 labels

  // Align to interval boundary
  const firstLabel = Math.ceil(startH / interval) * interval;

  for (let h = firstLabel; h <= endH; h += interval) {
    const x = labelWidth + (h - startH) * unitWidth.value;
    const d = new Date(startDate.value);
    d.setHours(d.getHours() + h);
    const day = d.getDate();
    const month = d.toLocaleString('default', { month: 'short' });
    labels.push({ x, label: `${day} ${month}` });
  }
  return labels;
});

function getStatusClass(status: string): string {
  if (status === 'Done') return 'done';
  if (status === 'In Progress' || status === 'WIP') return 'active';
  if (status === 'Blocked') return 'blocked';
  return 'pending';
}

function formatProgress(progress: number): string {
  return `${Math.round(progress)}%`;
}
</script>

<template>
  <div class="overview-gantt">
    <svg :width="chartWidth" :height="chartHeight" class="gantt-svg">
      <!-- Time labels -->
      <g class="time-labels">
        <text
          v-for="label in timeLabels"
          :key="label.x"
          :x="label.x"
          :y="headerHeight - 6"
          class="time-label"
        >{{ label.label }}</text>
      </g>

      <!-- Task rows -->
      <g class="task-rows">
        <g v-for="(task, index) in tasks" :key="task.id">
          <!-- Row background -->
          <rect
            :x="0"
            :y="headerHeight + index * rowHeight"
            :width="chartWidth"
            :height="rowHeight"
            :class="index % 2 === 0 ? 'row-even' : 'row-odd'"
          />

          <!-- Task label -->
          <text
            :x="8"
            :y="headerHeight + index * rowHeight + rowHeight / 2 + 4"
            class="task-label"
          >
            <tspan class="task-id">{{ task.id }}</tspan>
            <tspan dx="6">{{ task.name }}</tspan>
          </text>

          <!-- Task bar background -->
          <rect
            :x="labelWidth + (task.startHour - displayStartHour) * unitWidth"
            :y="headerHeight + index * rowHeight + 6"
            :width="Math.max((task.endHour - task.startHour) * unitWidth, 4)"
            :height="rowHeight - 12"
            :rx="3"
            :class="['task-bar', getStatusClass(task.status)]"
          />

          <!-- Progress fill -->
          <rect
            v-if="task.progress > 0"
            :x="labelWidth + (task.startHour - displayStartHour) * unitWidth"
            :y="headerHeight + index * rowHeight + 6"
            :width="Math.max((task.endHour - task.startHour) * unitWidth * (task.progress / 100), 2)"
            :height="rowHeight - 12"
            :rx="3"
            class="task-bar-progress"
          />

          <!-- Critical line (if exceeded) -->
          <line
            v-if="task.criticalTimespanHours && (task.endHour - task.startHour) > task.criticalTimespanHours * 1.1"
            :x1="labelWidth + (task.startHour - displayStartHour) * unitWidth + task.criticalTimespanHours * unitWidth"
            :y1="headerHeight + index * rowHeight + 4"
            :x2="labelWidth + (task.startHour - displayStartHour) * unitWidth + task.criticalTimespanHours * unitWidth"
            :y2="headerHeight + index * rowHeight + rowHeight - 4"
            class="critical-line"
          />

          <!-- Progress text -->
          <text
            :x="labelWidth + (task.endHour - displayStartHour) * unitWidth + 4"
            :y="headerHeight + index * rowHeight + rowHeight / 2 + 4"
            class="progress-label"
          >{{ formatProgress(task.progress) }}</text>
        </g>
      </g>

      <!-- Today line (blue dashed) - rendered last to be on top -->
      <line
        v-if="todayLineX !== null"
        :x1="todayLineX"
        :y1="headerHeight - 4"
        :x2="todayLineX"
        :y2="chartHeight"
        class="today-line"
      />
    </svg>
  </div>
</template>

<style scoped>
.overview-gantt {
  overflow-x: auto;
}

.gantt-svg {
  display: block;
}

.time-label {
  fill: var(--text-dim, #888);
  font-size: 10px;
  text-anchor: middle;
}

.row-even {
  fill: var(--bg, #1a1a2e);
}

.row-odd {
  fill: rgba(0, 0, 0, 0.05);
}

.task-label {
  fill: var(--text, #fff);
  font-size: 11px;
}

.task-label .task-id {
  font-weight: 600;
  fill: var(--accent, #4fc3f7);
}

.task-bar {
  opacity: 0.4;
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

.task-bar-progress {
  fill: #059669;
  opacity: 0.9;
}

.critical-line {
  stroke: #EF4444;
  stroke-width: 2;
  stroke-dasharray: 3 2;
}

.progress-label {
  fill: var(--text-dim, #888);
  font-size: 10px;
  font-weight: 500;
}

/* Today line - blue dashed, on top with slight transparency */
.today-line {
  stroke: #3B82F6;
  stroke-width: 2;
  stroke-dasharray: 5 3;
  opacity: 0.8;
  filter: drop-shadow(0 0 3px rgba(59, 130, 246, 0.5));
}
</style>
