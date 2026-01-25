/**
 * Dashboard Gantt chart generation (PURE - no manager imports)
 *
 * All config values are injected via parameters by the routes layer.
 */
import {
  calculateGanttMetrics,
  getTaskSchedules,
  calculateTheoreticalSchedule,
  calculateRealSchedule,
  getScheduleEnvelope,
  RealSchedulableTask
} from '../../lib/scheduling.js';
import type { PrdData, EpicData, SailingGanttTask, SimpleGanttTask, GanttResult, SimpleGanttResult, EffortConfig } from './types.js';

/**
 * Generate custom Gantt data for a PRD (hour-based with real scheduling)
 */
export function generatePrdGantt(prd: PrdData, effortConfig: EffortConfig): GanttResult {
  const taskData: Map<string, RealSchedulableTask & { title: string; epicId: string; epicTitle: string }> = new Map();
  let earliestDate: Date | null = null;

  for (const epic of prd.epics) {
    for (const task of epic.tasks) {
      const blockedBy = task.meta?.blocked_by;
      const blockers = blockedBy ? (Array.isArray(blockedBy) ? blockedBy : [blockedBy]) : [];
      const effort = task.meta?.effort as string | undefined;
      const startedAt = task.meta?.started_at as string | undefined;
      const doneAt = task.meta?.done_at as string | undefined;

      if (startedAt) {
        const d = new Date(startedAt);
        if (!earliestDate || d < earliestDate) {
          earliestDate = d;
        }
      }

      taskData.set(task.id, {
        id: task.id,
        title: task.title,
        status: task.status,
        effort: effort || null,
        blockedBy: blockers.filter((b): b is string => typeof b === 'string'),
        startedAt,
        doneAt,
        epicId: epic.id,
        epicTitle: epic.title
      });
    }
  }

  const t0 = earliestDate ? new Date(earliestDate) : new Date();
  t0.setHours(0, 0, 0, 0);

  const metrics = calculateGanttMetrics(taskData, effortConfig, t0);
  const schedule = getTaskSchedules(taskData, effortConfig, t0);

  // Build task-to-epic mapping and epic dependencies
  const taskToEpic = new Map<string, string>();
  for (const epic of prd.epics) {
    for (const task of epic.tasks) {
      taskToEpic.set(task.id, epic.id);
    }
  }

  const epicBlockedBy = new Map<string, Set<string>>();
  for (const epic of prd.epics) {
    epicBlockedBy.set(epic.id, new Set());
  }
  for (const epic of prd.epics) {
    for (const task of epic.tasks) {
      const blockers = task.meta?.blocked_by;
      if (!blockers) continue;
      const blockerList = Array.isArray(blockers) ? blockers : [blockers];
      for (const blockerId of blockerList) {
        if (typeof blockerId !== 'string') continue;
        const blockerEpicId = taskToEpic.get(blockerId);
        if (blockerEpicId && blockerEpicId !== epic.id) {
          epicBlockedBy.get(epic.id)?.add(blockerEpicId);
        }
      }
    }
  }

  // Topological sort of epics
  const inDegree = new Map<string, number>();
  for (const epic of prd.epics) {
    inDegree.set(epic.id, epicBlockedBy.get(epic.id)?.size || 0);
  }

  const sortedEpics: typeof prd.epics = [];
  const queue: string[] = [];

  for (const [epicId, degree] of inDegree) {
    if (degree === 0) queue.push(epicId);
  }

  while (queue.length > 0) {
    queue.sort((a, b) => {
      const epicA = prd.epics.find(e => e.id === a);
      const epicB = prd.epics.find(e => e.id === b);
      const aMin = Math.min(...(epicA?.tasks.map(t => schedule.get(t.id)?.startHour ?? Infinity) || [Infinity]));
      const bMin = Math.min(...(epicB?.tasks.map(t => schedule.get(t.id)?.startHour ?? Infinity) || [Infinity]));
      return aMin - bMin;
    });

    const epicId = queue.shift();
    const epic = prd.epics.find(e => e.id === epicId);
    if (epic) sortedEpics.push(epic);

    for (const [blockedEpicId, blockers] of epicBlockedBy) {
      if (blockers.has(epicId)) {
        const newDegree = (inDegree.get(blockedEpicId) || 1) - 1;
        inDegree.set(blockedEpicId, newDegree);
        if (newDegree === 0 && !sortedEpics.find(e => e.id === blockedEpicId)) {
          queue.push(blockedEpicId);
        }
      }
    }
  }

  for (const epic of prd.epics) {
    if (!sortedEpics.find(e => e.id === epic.id)) {
      sortedEpics.push(epic);
    }
  }

  // Build reverse dependency map
  const taskBlocks = new Map<string, string[]>();
  for (const [taskId] of taskData) {
    taskBlocks.set(taskId, []);
  }
  for (const [taskId, data] of taskData) {
    for (const blockerId of data.blockedBy) {
      if (taskData.has(blockerId)) {
        taskBlocks.get(blockerId)?.push(taskId);
      }
    }
  }

  const ganttTasks: SailingGanttTask[] = [];

  for (const epic of sortedEpics) {
    const epicTasks: SailingGanttTask[] = [];

    for (const task of epic.tasks) {
      const data = taskData.get(task.id);
      if (!data) continue;

      const taskSchedule = schedule.get(task.id);
      const isCritical = metrics.criticalPath.includes(task.id);
      const validDeps = data.blockedBy.filter(id => taskData.has(id));
      const taskName = `${task.id} ${task.title}`;

      epicTasks.push({
        id: task.id,
        name: taskName,
        startHour: taskSchedule?.startHour || 0,
        endHour: taskSchedule?.endHour || 1,
        durationHours: taskSchedule?.durationHours || 1,
        status: data.status,
        dependencies: validDeps,
        blocks: taskBlocks.get(task.id) || [],
        isCritical,
        epicId: data.epicId,
        epicTitle: data.epicTitle,
        startedAt: data.startedAt,
        doneAt: data.doneAt
      });
    }

    epicTasks.sort((a, b) => a.startHour - b.startHour);
    ganttTasks.push(...epicTasks);
  }

  return {
    tasks: ganttTasks,
    criticalPath: metrics.criticalPath,
    title: `${prd.id} - ${prd.title}`,
    totalHours: metrics.maxEndHour,
    t0,
    durationHours: metrics.totalEffortHours,
    criticalTimespanHours: metrics.criticalTimespanHours
  };
}

/**
 * Generate custom Gantt data for an Epic
 */
export function generateEpicGantt(epic: EpicData, effortConfig: EffortConfig): GanttResult {
  const taskData: Map<string, RealSchedulableTask & { title: string }> = new Map();
  let earliestDate: Date | null = null;

  for (const task of epic.tasks) {
    const blockedBy = task.meta?.blocked_by;
    const blockers = blockedBy ? (Array.isArray(blockedBy) ? blockedBy : [blockedBy]) : [];
    const effort = task.meta?.effort as string | undefined;
    const startedAt = task.meta?.started_at as string | undefined;
    const doneAt = task.meta?.done_at as string | undefined;

    if (startedAt) {
      const d = new Date(startedAt);
      if (!earliestDate || d < earliestDate) {
        earliestDate = d;
      }
    }

    taskData.set(task.id, {
      id: task.id,
      title: task.title,
      status: task.status,
      effort: effort || null,
      blockedBy: blockers.filter((b): b is string => typeof b === 'string'),
      startedAt,
      doneAt
    });
  }

  const t0 = earliestDate ? new Date(earliestDate) : new Date();
  t0.setHours(0, 0, 0, 0);

  const metrics = calculateGanttMetrics(taskData, effortConfig, t0);
  const schedule = getTaskSchedules(taskData, effortConfig, t0);

  const taskBlocks = new Map<string, string[]>();
  for (const [taskId] of taskData) {
    taskBlocks.set(taskId, []);
  }
  for (const [taskId, data] of taskData) {
    for (const blockerId of data.blockedBy) {
      if (taskData.has(blockerId)) {
        taskBlocks.get(blockerId)?.push(taskId);
      }
    }
  }

  const ganttTasks: SailingGanttTask[] = [];

  for (const task of epic.tasks) {
    const data = taskData.get(task.id);
    if (!data) continue;

    const taskSchedule = schedule.get(task.id);
    const isCritical = metrics.criticalPath.includes(task.id);
    const validDeps = data.blockedBy.filter(id => taskData.has(id));
    const taskName = `${task.id} ${task.title}`;

    ganttTasks.push({
      id: task.id,
      name: taskName,
      startHour: taskSchedule?.startHour || 0,
      endHour: taskSchedule?.endHour || 1,
      durationHours: taskSchedule?.durationHours || 1,
      status: data.status,
      dependencies: validDeps,
      blocks: taskBlocks.get(task.id) || [],
      isCritical,
      startedAt: data.startedAt,
      doneAt: data.doneAt
    });
  }

  ganttTasks.sort((a, b) => a.startHour - b.startHour);

  return {
    tasks: ganttTasks,
    criticalPath: metrics.criticalPath,
    title: `${epic.id} - ${epic.title}`,
    totalHours: metrics.maxEndHour,
    t0,
    durationHours: metrics.totalEffortHours,
    criticalTimespanHours: metrics.criticalTimespanHours
  };
}

/**
 * Generate PRD overview Gantt
 */
export function generatePrdOverviewGantt(prds: PrdData[], effortConfig: EffortConfig): SimpleGanttResult {
  const tasks: SimpleGanttTask[] = [];
  let maxEndHour = 0;
  let globalEarliestDate: Date | null = null;

  for (const prd of prds) {
    for (const epic of prd.epics) {
      for (const task of epic.tasks) {
        const startedAt = task.meta?.started_at as string | undefined;
        if (startedAt) {
          const d = new Date(startedAt);
          if (!globalEarliestDate || d < globalEarliestDate) {
            globalEarliestDate = d;
          }
        }
      }
    }
  }

  const t0 = globalEarliestDate ? new Date(globalEarliestDate) : new Date();
  t0.setHours(0, 0, 0, 0);

  for (const prd of prds) {
    const taskData: Map<string, RealSchedulableTask> = new Map();
    let earliestStartedAt: string | undefined;

    for (const epic of prd.epics) {
      for (const task of epic.tasks) {
        const blockedBy = task.meta?.blocked_by;
        const blockers = blockedBy ? (Array.isArray(blockedBy) ? blockedBy : [blockedBy]) : [];
        const effort = task.meta?.effort as string | undefined;
        const startedAt = task.meta?.started_at as string | undefined;
        const doneAt = task.meta?.done_at as string | undefined;

        if (startedAt && (!earliestStartedAt || startedAt < earliestStartedAt)) {
          earliestStartedAt = startedAt;
        }

        taskData.set(task.id, {
          id: task.id,
          effort: effort || null,
          blockedBy: blockers.filter((b): b is string => typeof b === 'string'),
          status: task.status,
          startedAt,
          doneAt
        });
      }
    }

    if (taskData.size === 0) continue;

    const schedule = calculateRealSchedule(taskData, effortConfig, t0);
    const envelope = getScheduleEnvelope(schedule);

    const theoreticalSchedule = calculateTheoreticalSchedule(taskData, effortConfig);
    const theoreticalEnvelope = getScheduleEnvelope(theoreticalSchedule);
    const criticalTimespanHours = theoreticalEnvelope.weightedHours;

    // Calculate done effort (sum of durations for Done tasks)
    let doneEffortHours = 0;
    for (const [taskId, taskSchedule] of schedule.entries()) {
      const taskInfo = taskData.get(taskId);
      if (taskInfo && taskInfo.status === 'Done') {
        doneEffortHours += taskSchedule.durationHours;
      }
    }

    let status = 'Draft';
    if (prd.doneTasks === prd.totalTasks && prd.totalTasks > 0) {
      status = 'Done';
    } else if (prd.doneTasks > 0) {
      status = 'In Progress';
    }

    // Progress based on effort (doneEffortHours / totalEffortHours)
    const progress = envelope.totalHours > 0 ? Math.round((doneEffortHours / envelope.totalHours) * 100) : 0;

    tasks.push({
      id: prd.id,
      name: `${prd.id} ${prd.title}`,
      startHour: envelope.earliestStart,
      endHour: envelope.latestEnd,
      durationHours: envelope.totalHours,
      status,
      progress,
      startedAt: earliestStartedAt,
      criticalTimespanHours,
      doneEffortHours
    });

    if (envelope.latestEnd > maxEndHour) maxEndHour = envelope.latestEnd;
  }

  return { tasks, totalHours: maxEndHour || 8, t0 };
}

/**
 * Render Gantt container with legend
 */
export function renderGantt(
  tasks: SailingGanttTask[],
  criticalPath: string[],
  title: string,
  totalHours: number,
  t0?: Date,
  durationHours?: number,
  criticalTimespanHours?: number
): string {
  let d0: Date;
  if (t0) {
    d0 = new Date(t0);
  } else {
    let earliestDate: Date | null = null;
    for (const task of tasks) {
      if (task.startedAt) {
        const d = new Date(task.startedAt);
        if (!earliestDate || d < earliestDate) {
          earliestDate = d;
        }
      }
    }
    d0 = earliestDate || new Date();
  }
  d0.setHours(0, 0, 0, 0);

  const ganttData = {
    tasks,
    totalHours,
    d0: d0.toISOString(),
    durationHours,
    criticalTimespanHours
  };
  const dataJson = JSON.stringify(ganttData).replace(/</g, '\\u003c');
  const ganttId = `gantt-${Date.now()}`;

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const statsItems: string[] = [];
  statsItems.push(`${criticalPath.length} tasks on critical path`);
  if (durationHours !== undefined) {
    statsItems.push(`${round1(durationHours)}h effort`);
  }
  if (criticalTimespanHours !== undefined) {
    statsItems.push(`${round1(criticalTimespanHours)}h critical`);
  }
  statsItems.push(`${round1(totalHours)}h span`);

  return `
    <div class="gantt-legend">
      <div class="gantt-legend-item"><div class="gantt-legend-color not-started"></div> Not Started</div>
      <div class="gantt-legend-item"><div class="gantt-legend-color active"></div> In Progress</div>
      <div class="gantt-legend-item"><div class="gantt-legend-color done"></div> Done</div>
      <div class="gantt-legend-item"><div class="gantt-legend-color crit"></div> Critical Path</div>
      <span style="margin-left: auto; font-size: 11px; color: var(--text-dim);">
        ${statsItems.join(' | ')}
      </span>
    </div>
    <div class="gantt-container">
      <div class="gantt-title">${title}</div>
      <div class="gantt-controls">
        <button class="gantt-zoom" data-zoom="hour">Hour</button>
        <button class="gantt-zoom active" data-zoom="day">Day</button>
        <button class="gantt-zoom" data-zoom="week">Week</button>
      </div>
      <div id="${ganttId}" class="sailing-gantt-target"></div>
      <script type="application/json" class="gantt-data">${dataJson}</script>
    </div>
  `;
}

/**
 * Render simple Gantt (for overview)
 */
export function renderSimpleGantt(tasks: SimpleGanttTask[], totalHours: number, title: string, t0?: Date): string {
  let d0: Date;
  if (t0) {
    d0 = new Date(t0);
  } else {
    let earliestDate: Date | null = null;
    for (const task of tasks) {
      if (task.startedAt) {
        const d = new Date(task.startedAt);
        if (!earliestDate || d < earliestDate) {
          earliestDate = d;
        }
      }
    }
    d0 = earliestDate || new Date();
  }
  d0.setHours(0, 0, 0, 0);

  const ganttData = { tasks, totalHours, d0: d0.toISOString(), simple: true };
  const dataJson = JSON.stringify(ganttData).replace(/</g, '\\u003c');
  const ganttId = `gantt-simple-${Date.now()}`;
  return `
    <div class="gantt-container" style="margin-top: 16px;">
      <div class="gantt-title">${title}</div>
      <div class="gantt-controls">
        <button class="gantt-zoom" data-zoom="day">Day</button>
        <button class="gantt-zoom active" data-zoom="week">Week</button>
        <button class="gantt-zoom" data-zoom="month">Month</button>
      </div>
      <div id="${ganttId}" class="sailing-gantt-target"></div>
      <script type="application/json" class="gantt-data">${dataJson}</script>
    </div>
  `;
}
