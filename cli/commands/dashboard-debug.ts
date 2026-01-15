/**
 * Dashboard Debug commands - Inspect scheduling data for a project
 * Commands: debug-prd, debug-epic, debug-task, debug-gantt
 */
import { getFullPrd, getEpic, getTask } from '../managers/artefacts-manager.js';
import { loadFile } from '../managers/core-manager.js';
import { getConfigValue } from '../managers/core-manager.js';
import {
  calculateGanttMetrics,
  getTaskSchedules,
  EffortConfig,
  RealSchedulableTask
} from '../lib/scheduling.js';
import { getSystemLocale } from '../lib/format.js';
import { FullPrd } from '../lib/types/entities.js';

interface DebugOptions {
  json?: boolean;
  schedule?: boolean;
}

/**
 * Register debug commands
 */
export function registerDashboardDebugCommands(program: any) {
  program.command('debug-prd <id>')
    .description('Debug PRD scheduling data')
    .option('--json', 'Output raw JSON')
    .option('--schedule', 'Show full schedule data')
    .action(async (id: string, options: DebugOptions) => {
      await debugPrd(id, options);
    });

  program.command('debug-epic <id>')
    .description('Debug Epic data')
    .option('--json', 'Output raw JSON')
    .action(async (id: string, options: DebugOptions) => {
      await debugEpic(id, options);
    });

  program.command('debug-task <id>')
    .description('Debug Task data')
    .option('--json', 'Output raw JSON')
    .action(async (id: string, options: DebugOptions) => {
      await debugTask(id, options);
    });

  program.command('debug-gantt <prdId>')
    .description('Compare Gantt metrics vs actual schedule (debug overflow)')
    .option('--ascii', 'Show ASCII Gantt chart')
    .option('-w, --width <chars>', 'Chart width in characters', '80')
    .action(async (prdId: string, options: { ascii?: boolean; width?: string }) => {
      await debugCompare(prdId, options);
    });
}

async function debugPrd(id: string, options: DebugOptions) {
  const prd = getFullPrd(id);
  if (!prd) {
    console.error(`PRD ${id} not found`);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(prd, null, 2));
    return;
  }

  const effortConfig = getEffortConfig();
  const taskData = buildTaskDataFromPrd(prd);
  const t0 = calculateT0(taskData);

  console.log(`\n=== PRD: ${prd.id} - ${prd.title} ===\n`);
  console.log(`Epics: ${prd.epics.length}`);
  console.log(`Total tasks: ${taskData.size}`);
  console.log(`T0 (earliest start): ${t0.toISOString()}`);
  console.log(`Now: ${new Date().toISOString()}`);

  const nowHours = (Date.now() - t0.getTime()) / (1000 * 60 * 60);
  console.log(`Now (hours since T0): ${nowHours.toFixed(2)}`);

  const metrics = calculateGanttMetrics(taskData, effortConfig, t0);

  console.log(`\n--- Metrics ---`);
  console.log(`realSpanHours: ${metrics.realSpanHours.toFixed(2)}`);
  console.log(`displaySpanHours: ${metrics.displaySpanHours.toFixed(2)}`);
  console.log(`totalEffortHours: ${metrics.totalEffortHours.toFixed(2)}`);
  console.log(`criticalTimespanHours: ${metrics.criticalTimespanHours.toFixed(2)}`);
  console.log(`minStartHour: ${metrics.minStartHour.toFixed(2)}`);
  console.log(`maxEndHour: ${metrics.maxEndHour.toFixed(2)}`);
  console.log(`displayMaxEndHour: ${metrics.displayMaxEndHour.toFixed(2)}`);
  console.log(`criticalPath: ${metrics.criticalPath.length} tasks`);

  if (options.schedule) {
    const schedule = getTaskSchedules(taskData, effortConfig, t0);
    console.log(`\n--- Task Schedules ---`);
    for (const [taskId, sched] of schedule) {
      const task = taskData.get(taskId);
      const status = task?.status || 'unknown';
      const flag = sched.endHour > metrics.maxEndHour ? ' ⚠️' : '';
      console.log(`${taskId} [${status}]: start=${sched.startHour.toFixed(2)}, end=${sched.endHour.toFixed(2)}, dur=${sched.durationHours}${flag}`);
    }
  }

  console.log(`\n--- Tasks by Status ---`);
  const byStatus: Record<string, string[]> = {};
  for (const [taskId, task] of taskData) {
    const status = task.status?.toLowerCase() || 'unknown';
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(taskId);
  }
  for (const [status, tasks] of Object.entries(byStatus)) {
    console.log(`${status}: ${tasks.length} tasks`);
  }
}

async function debugEpic(id: string, options: DebugOptions) {
  const epicEntry = getEpic(id);
  if (!epicEntry) {
    console.error(`Epic ${id} not found`);
    process.exit(1);
  }

  if (options.json) {
    const loaded = loadFile(epicEntry.file);
    console.log(JSON.stringify({ ...epicEntry, body: loaded?.body }, null, 2));
    return;
  }

  console.log(`\n=== Epic: ${epicEntry.id} ===`);
  console.log(`Title: ${epicEntry.data?.title || 'Untitled'}`);
  console.log(`Status: ${epicEntry.data?.status || 'Draft'}`);
  console.log(`File: ${epicEntry.file}`);
  console.log(`\n--- Meta ---`);
  console.log(JSON.stringify(epicEntry.data, null, 2));
}

async function debugTask(id: string, options: DebugOptions) {
  const taskEntry = getTask(id);
  if (!taskEntry) {
    console.error(`Task ${id} not found`);
    process.exit(1);
  }

  if (options.json) {
    const loaded = loadFile(taskEntry.file);
    console.log(JSON.stringify({ ...taskEntry, body: loaded?.body }, null, 2));
    return;
  }

  console.log(`\n=== Task: ${taskEntry.id} ===`);
  console.log(`Title: ${taskEntry.data?.title || 'Untitled'}`);
  console.log(`Status: ${taskEntry.data?.status || 'Draft'}`);
  console.log(`File: ${taskEntry.file}`);
  console.log(`\n--- Meta ---`);
  console.log(JSON.stringify(taskEntry.data, null, 2));
}

async function debugCompare(prdId: string, options: { ascii?: boolean; width?: string } = {}) {
  const prd = getFullPrd(prdId);
  if (!prd) {
    console.error(`PRD ${prdId} not found`);
    process.exit(1);
  }

  const effortConfig = getEffortConfig();
  const taskData = buildTaskDataFromPrd(prd);
  const t0 = calculateT0(taskData);

  const metrics = calculateGanttMetrics(taskData, effortConfig, t0);
  const schedule = getTaskSchedules(taskData, effortConfig, t0);

  // Find actual max endHour from schedule
  let actualMaxEnd = 0;
  let maxTask = '';
  for (const [taskId, sched] of schedule) {
    if (sched.endHour > actualMaxEnd) {
      actualMaxEnd = sched.endHour;
      maxTask = taskId;
    }
  }

  console.log(`\n=== Gantt Debug: ${prd.id} ===\n`);
  console.log(`metrics.realSpanHours: ${metrics.realSpanHours.toFixed(2)}`);
  console.log(`metrics.maxEndHour: ${metrics.maxEndHour.toFixed(2)}`);
  console.log(`actual maxEndHour (schedule): ${actualMaxEnd.toFixed(2)} (${maxTask})`);
  console.log(`metrics.minStartHour: ${metrics.minStartHour.toFixed(2)}`);

  const expectedSpan = actualMaxEnd - metrics.minStartHour;
  console.log(`\nExpected realSpanHours: ${expectedSpan.toFixed(2)}`);

  if (Math.abs(metrics.realSpanHours - expectedSpan) > 0.01) {
    console.log(`\n⚠️  MISMATCH! realSpanHours=${metrics.realSpanHours.toFixed(2)} but should be ${expectedSpan.toFixed(2)}`);
  } else {
    console.log(`\n✅ Values match`);
  }

  // In-progress tasks
  console.log(`\n--- In Progress Tasks ---`);
  let hasInProgress = false;
  const locale = getSystemLocale();
  const hoursToDate = (hours: number): string => {
    const d = new Date(t0.getTime() + hours * 60 * 60 * 1000);
    return d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
  };
  for (const [taskId, task] of taskData) {
    const status = task.status?.toLowerCase() || '';
    if (status === 'in progress' || status === 'wip') {
      const sched = schedule.get(taskId);
      console.log(`${taskId}: start=${sched?.startHour.toFixed(2)}, end=${sched?.endHour.toFixed(2)}, dur=${sched?.durationHours}`);
      console.log(`  started_at (meta): ${task.startedAt || 'N/A'}`);
      console.log(`  start_calc: ${hoursToDate(sched?.startHour || 0)}`);
      console.log(`  end_sched (now+dur): ${hoursToDate(sched?.endHour || 0)}`);
      hasInProgress = true;
    }
  }
  if (!hasInProgress) console.log('None');

  // ASCII Gantt chart
  if (options.ascii) {
    const chartWidth = parseInt(options.width || '80', 10);
    renderAsciiGantt(schedule, taskData, metrics, chartWidth);
  }
}

/**
 * Render ASCII Gantt chart
 */
function renderAsciiGantt(
  schedule: Map<string, { startHour: number; endHour: number; durationHours: number }>,
  taskData: Map<string, RealSchedulableTask>,
  metrics: { minStartHour: number; maxEndHour: number; realSpanHours: number },
  width: number
) {
  const labelWidth = 10; // Task ID width
  const chartWidth = width - labelWidth - 3; // Account for label + " |"
  const totalHours = metrics.maxEndHour - metrics.minStartHour;
  const hoursPerChar = totalHours / chartWidth;

  // Now marker position
  const nowHours = (Date.now() - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60) +
    (new Date().getTime() - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60);

  console.log(`\n--- ASCII Gantt (${chartWidth} chars = ${totalHours.toFixed(0)}h) ---`);

  // Header with scale
  const scaleInterval = Math.ceil(totalHours / 10); // ~10 marks
  let header = ' '.repeat(labelWidth) + ' |';
  for (let h = 0; h <= totalHours; h += scaleInterval) {
    const pos = Math.floor(h / hoursPerChar);
    if (pos < chartWidth) {
      const label = h.toFixed(0);
      header = header.substring(0, labelWidth + 2 + pos) + label + header.substring(labelWidth + 2 + pos + label.length);
    }
  }
  console.log(header);
  console.log('-'.repeat(labelWidth) + '-+' + '-'.repeat(chartWidth));

  // Sort tasks by start hour
  const sortedTasks = Array.from(schedule.entries())
    .sort((a, b) => a[1].startHour - b[1].startHour);

  for (const [taskId, sched] of sortedTasks) {
    const task = taskData.get(taskId);
    const status = task?.status?.toLowerCase() || '';

    // Calculate bar position
    const startPos = Math.floor((sched.startHour - metrics.minStartHour) / hoursPerChar);
    const endPos = Math.ceil((sched.endHour - metrics.minStartHour) / hoursPerChar);
    const barLength = Math.max(1, endPos - startPos);

    // Choose character based on status
    let barChar = '█';
    if (status === 'done') barChar = '▓';
    else if (status === 'in progress' || status === 'wip') barChar = '▒';
    else if (status === 'not started') barChar = '░';

    // Build the line
    let line = ' '.repeat(chartWidth);
    const clampedStart = Math.max(0, Math.min(startPos, chartWidth - 1));
    const clampedEnd = Math.min(endPos, chartWidth);

    // Draw bar
    for (let i = clampedStart; i < clampedEnd; i++) {
      line = line.substring(0, i) + barChar + line.substring(i + 1);
    }

    // Mark overflow with !
    if (endPos > chartWidth) {
      line = line.substring(0, chartWidth - 1) + '!';
    }

    // Task label
    const label = taskId.padEnd(labelWidth).substring(0, labelWidth);
    console.log(`${label} |${line}`);
  }

  // Footer
  console.log('-'.repeat(labelWidth) + '-+' + '-'.repeat(chartWidth));
  console.log(`Legend: ▓=Done ▒=In Progress ░=Not Started █=Other !=Overflow`);
}

function getEffortConfig(): EffortConfig {
  return {
    default_duration: getConfigValue<string>('task.default_duration') || '1h',
    effort_map: getConfigValue<string>('task.effort_map') || 'S=0.5h,M=1h,L=2h,XL=4h'
  };
}

function buildTaskDataFromPrd(prd: FullPrd): Map<string, RealSchedulableTask> {
  const taskData = new Map<string, RealSchedulableTask>();
  for (const epic of prd.epics) {
    for (const task of epic.tasks) {
      const blockedBy = task.meta?.blocked_by;
      const blockers = blockedBy ? (Array.isArray(blockedBy) ? blockedBy : [blockedBy]) : [];
      taskData.set(task.id, {
        id: task.id,
        status: task.status,
        effort: task.meta?.effort as string | undefined,
        blockedBy: blockers as string[],
        startedAt: task.meta?.started_at as string | undefined,
        doneAt: task.meta?.done_at as string | undefined
      });
    }
  }
  return taskData;
}

function calculateT0(taskData: Map<string, RealSchedulableTask>): Date {
  let earliestDate: Date | null = null;
  for (const task of taskData.values()) {
    if (task.startedAt) {
      const d = new Date(task.startedAt);
      if (!earliestDate || d < earliestDate) earliestDate = d;
    }
  }
  const t0 = earliestDate ? new Date(earliestDate) : new Date();
  t0.setHours(0, 0, 0, 0);
  return t0;
}
