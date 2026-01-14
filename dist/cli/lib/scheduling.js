/**
 * Scheduling utilities for theoretical datetime calculations
 *
 * Key rules:
 * - Tasks can be delayed but never advanced
 * - Hour-based continuous scheduling (no working days concept)
 * - Dependencies are respected (a task can't start before its blockers complete)
 */
import { getDuration } from './lexicon.js';
/**
 * Calculate theoretical schedule based on dependencies and durations
 * Uses topological sort to ensure tasks start after their blockers complete
 *
 * Rule: Tasks can be delayed but never advanced
 * - A task's start time is the maximum end time of all its blockers
 * - If a task has no blockers, it starts at hour 0
 *
 * @param taskData Map of task ID to task data (effort, blockedBy)
 * @param effortConfig Configuration for effort-to-duration conversion
 * @returns Map of task ID to schedule (startHour, endHour, durationHours)
 */
export function calculateTheoreticalSchedule(taskData, effortConfig) {
    const schedule = new Map();
    // Build in-degree count for topological sort
    const inDegree = new Map();
    const taskIds = Array.from(taskData.keys());
    for (const id of taskIds) {
        const data = taskData.get(id);
        // Only count blockers that exist in our task set
        const validBlockers = data.blockedBy.filter(b => taskData.has(b));
        inDegree.set(id, validBlockers.length);
    }
    // Topological sort with scheduling
    const queue = [];
    // Start with tasks that have no dependencies
    for (const [id, degree] of inDegree) {
        if (degree === 0) {
            queue.push(id);
        }
    }
    while (queue.length > 0) {
        const taskId = queue.shift();
        const data = taskData.get(taskId);
        // Calculate duration from effort
        const durationHours = getDuration(data.effort, effortConfig);
        // Calculate start time = max end time of all blockers
        // This enforces the rule: tasks can be delayed but never advanced
        const validBlockers = data.blockedBy.filter(b => taskData.has(b));
        let startHour = 0;
        for (const blockerId of validBlockers) {
            const blockerSchedule = schedule.get(blockerId);
            if (blockerSchedule && blockerSchedule.endHour > startHour) {
                startHour = blockerSchedule.endHour;
            }
        }
        const endHour = startHour + durationHours;
        schedule.set(taskId, { startHour, endHour, durationHours });
        // Update dependents
        for (const [otherId, otherData] of taskData) {
            if (otherData.blockedBy.includes(taskId)) {
                const newDegree = (inDegree.get(otherId) || 1) - 1;
                inDegree.set(otherId, newDegree);
                if (newDegree === 0) {
                    queue.push(otherId);
                }
            }
        }
    }
    // Handle any remaining tasks (circular dependencies) - place at end
    for (const id of taskIds) {
        if (!schedule.has(id)) {
            const data = taskData.get(id);
            const durationHours = getDuration(data.effort, effortConfig);
            // Find max end hour so far
            let maxEnd = 0;
            for (const s of schedule.values()) {
                if (s.endHour > maxEnd)
                    maxEnd = s.endHour;
            }
            schedule.set(id, { startHour: maxEnd, endHour: maxEnd + durationHours, durationHours });
        }
    }
    return schedule;
}
/**
 * Calculate real schedule based on actual dates and current time
 *
 * Rules:
 * - Done tasks: startHour from started_at, endHour from done_at (or started_at + duration)
 * - In Progress tasks: startHour from started_at, endHour = max(today + duration, theoretical)
 * - Not Started tasks: startHour = max(today, blocker end), endHour = startHour + duration
 *
 * @param taskData Map of task ID to task data with real dates
 * @param effortConfig Configuration for effort-to-duration conversion
 * @param t0 Reference date (T0) - earliest started_at among all tasks
 * @param now Optional fixed "now" date for testing (defaults to current time)
 * @returns Map of task ID to schedule (startHour, endHour, durationHours)
 */
export function calculateRealSchedule(taskData, effortConfig, t0, now) {
    // First get theoretical schedule as baseline
    const theoreticalSchedule = calculateTheoreticalSchedule(taskData, effortConfig);
    const schedule = new Map();
    const nowDate = now ?? new Date();
    const nowHoursSinceT0 = (nowDate.getTime() - t0.getTime()) / (1000 * 60 * 60);
    // Helper to convert ISO date to hours since T0
    const dateToHours = (isoDate) => {
        const d = new Date(isoDate);
        return (d.getTime() - t0.getTime()) / (1000 * 60 * 60);
    };
    // Process tasks in dependency order (use theoretical schedule order)
    // We need to process in order because Not Started tasks depend on blocker ends
    const taskIds = Array.from(taskData.keys());
    // Sort by theoretical start time to ensure blockers are processed first
    taskIds.sort((a, b) => {
        const schedA = theoreticalSchedule.get(a);
        const schedB = theoreticalSchedule.get(b);
        return (schedA?.startHour || 0) - (schedB?.startHour || 0);
    });
    // Helper: get max end hour of blockers from real schedule
    const getMaxBlockerEnd = (blockedBy) => {
        let maxEnd = 0;
        for (const blockerId of blockedBy) {
            if (!taskData.has(blockerId))
                continue;
            const blockerSched = schedule.get(blockerId);
            if (blockerSched && blockerSched.endHour > maxEnd) {
                maxEnd = blockerSched.endHour;
            }
        }
        return maxEnd;
    };
    for (const taskId of taskIds) {
        const task = taskData.get(taskId);
        const theoretical = theoreticalSchedule.get(taskId);
        const durationHours = getDuration(task.effort, effortConfig);
        const status = task.status?.toLowerCase() || '';
        const isDone = status === 'done' || status === 'auto-done';
        const isInProgress = status === 'in progress' || status === 'wip';
        // Common: calculate earliest possible start from blockers
        const maxBlockerEnd = getMaxBlockerEnd(task.blockedBy);
        const earliestStart = Math.max(nowHoursSinceT0, maxBlockerEnd);
        let startHour;
        let endHour;
        if (isDone) {
            // Done: use real dates but can shift forward to honor blockers
            // Rule: can't move to past (respect known dates), can move forward for blockers
            if (task.startedAt) {
                // Has start date: use it as minimum, but shift forward if blockers require
                startHour = Math.max(dateToHours(task.startedAt), maxBlockerEnd);
            }
            else if (task.doneAt) {
                // Only done_at: start = max(done_at - duration, maxBlockerEnd)
                const doneHour = dateToHours(task.doneAt);
                startHour = Math.max(doneHour - durationHours, maxBlockerEnd);
            }
            else {
                // No dates: position after blockers
                startHour = maxBlockerEnd;
            }
            endHour = startHour + durationHours;
        }
        else if (isInProgress) {
            // In Progress: end = max(now + duration, blockerEnd + duration)
            // Start can be shifted forward to honor blockers (same granularity rule as Done)
            endHour = Math.max(nowHoursSinceT0 + durationHours, maxBlockerEnd + durationHours);
            startHour = task.startedAt
                ? Math.max(dateToHours(task.startedAt), maxBlockerEnd)
                : earliestStart;
        }
        else {
            // Not Started: start = max(now, blockerEnd), end = start + duration
            startHour = earliestStart;
            endHour = startHour + durationHours;
        }
        schedule.set(taskId, { startHour, endHour, durationHours });
    }
    return schedule;
}
/**
 * Calculate critical path from a schedule
 * Critical path = the longest sequence of dependent tasks
 * Tasks on critical path have zero slack (any delay extends the project)
 *
 * @param taskData Map of task ID to task data (needs blockedBy)
 * @param schedule Map of task ID to schedule
 * @returns Array of task IDs on the critical path
 */
export function calculateCriticalPath(taskData, schedule) {
    if (schedule.size === 0)
        return [];
    // Find the project end (max endHour)
    let projectEnd = 0;
    for (const s of schedule.values()) {
        if (s.endHour > projectEnd)
            projectEnd = s.endHour;
    }
    // Find all tasks that end at project end (they're on critical path)
    // Then trace back through their dependencies
    const criticalPath = new Set();
    const toProcess = [];
    // Start with tasks that end at project end
    for (const [id, s] of schedule) {
        if (s.endHour === projectEnd) {
            criticalPath.add(id);
            toProcess.push(id);
        }
    }
    // Trace back through dependencies
    while (toProcess.length > 0) {
        const taskId = toProcess.pop();
        const task = taskData.get(taskId);
        if (!task)
            continue;
        const taskSchedule = schedule.get(taskId);
        if (!taskSchedule)
            continue;
        // A dependency is critical if it ends exactly when this task starts
        for (const depId of task.blockedBy) {
            if (criticalPath.has(depId))
                continue;
            const depSchedule = schedule.get(depId);
            if (depSchedule && depSchedule.endHour === taskSchedule.startHour) {
                criticalPath.add(depId);
                toProcess.push(depId);
            }
        }
    }
    return Array.from(criticalPath);
}
/**
 * Get the weighted envelope of a schedule
 * Useful for summarizing the time span of a PRD or Epic
 *
 * @param schedule Map of task ID to schedule
 * @returns Envelope with total hours, span, and critical path info
 */
export function getScheduleEnvelope(schedule) {
    if (schedule.size === 0) {
        return {
            totalHours: 0,
            weightedHours: 0,
            earliestStart: 0,
            latestEnd: 0,
            criticalPathLength: 0,
            taskCount: 0
        };
    }
    let totalHours = 0;
    let earliestStart = Infinity;
    let latestEnd = 0;
    for (const s of schedule.values()) {
        totalHours += s.durationHours;
        if (s.startHour < earliestStart)
            earliestStart = s.startHour;
        if (s.endHour > latestEnd)
            latestEnd = s.endHour;
    }
    const weightedHours = latestEnd - earliestStart;
    return {
        totalHours,
        weightedHours,
        earliestStart,
        latestEnd,
        criticalPathLength: weightedHours, // Critical path length equals the weighted span
        taskCount: schedule.size
    };
}
/**
 * Delay a task and cascade the delay to all dependent tasks
 * Rule: tasks can be delayed but never advanced
 *
 * @param schedule Current schedule
 * @param taskId Task to delay
 * @param delayHours Number of hours to delay
 * @param taskData Task dependency data
 * @returns New schedule with delays applied
 */
export function delayTask(schedule, taskId, delayHours, taskData) {
    if (delayHours <= 0)
        return schedule;
    const newSchedule = new Map(schedule);
    const toProcess = [taskId];
    const processed = new Set();
    while (toProcess.length > 0) {
        const currentId = toProcess.shift();
        if (processed.has(currentId))
            continue;
        processed.add(currentId);
        const currentSchedule = newSchedule.get(currentId);
        if (!currentSchedule)
            continue;
        // Apply delay if this is the originally delayed task
        // or if its new start is after a blocker's end
        let newStartHour = currentSchedule.startHour;
        if (currentId === taskId) {
            newStartHour = currentSchedule.startHour + delayHours;
        }
        else {
            // Check if any blocker's end is now later than our start
            const task = taskData.get(currentId);
            if (task) {
                for (const blockerId of task.blockedBy) {
                    const blockerSchedule = newSchedule.get(blockerId);
                    if (blockerSchedule && blockerSchedule.endHour > newStartHour) {
                        newStartHour = blockerSchedule.endHour;
                    }
                }
            }
        }
        // Update if start changed
        if (newStartHour !== currentSchedule.startHour) {
            newSchedule.set(currentId, {
                startHour: newStartHour,
                endHour: newStartHour + currentSchedule.durationHours,
                durationHours: currentSchedule.durationHours
            });
            // Add all tasks that depend on this one to process queue
            for (const [otherId, otherData] of taskData) {
                if (otherData.blockedBy.includes(currentId) && !processed.has(otherId)) {
                    toProcess.push(otherId);
                }
            }
        }
    }
    return newSchedule;
}
/**
 * Calculate parallel efficiency (how much parallelization is happening)
 * 1.0 = fully serial (critical path = total hours)
 * Higher values indicate more parallelization
 *
 * @param envelope Schedule envelope
 * @returns Parallelization factor (totalHours / weightedHours)
 */
export function calculateParallelEfficiency(envelope) {
    if (envelope.weightedHours === 0)
        return 1;
    return envelope.totalHours / envelope.weightedHours;
}
/**
 * Calculate all Gantt metrics from task data
 * Centralizes all scheduling calculations for Gantt display
 *
 * @param taskData Map of task ID to schedulable task data
 * @param effortConfig Configuration for effort-to-duration conversion
 * @param t0 Reference date (T0) for real schedule calculation
 * @param now Optional fixed "now" date for testing (defaults to current time)
 * @returns All Gantt metrics
 */
export function calculateGanttMetrics(taskData, effortConfig, t0, now) {
    // Calculate real schedule based on actual dates
    const realSchedule = calculateRealSchedule(taskData, effortConfig, t0, now);
    // Calculate theoretical schedule for critical path (durations + blockers, no real dates)
    const theoreticalSchedule = calculateTheoreticalSchedule(taskData, effortConfig);
    const criticalPath = calculateCriticalPath(taskData, theoreticalSchedule);
    // Get theoretical envelope for critical timespan
    const theoreticalEnvelope = getScheduleEnvelope(theoreticalSchedule);
    const criticalTimespanHours = theoreticalEnvelope.weightedHours;
    // Calculate total effort (sum of all task durations)
    let totalEffortHours = 0;
    for (const s of realSchedule.values()) {
        totalEffortHours += s.durationHours;
    }
    // Calculate real span (maxEnd - minStart) - includes in-progress "now" extension
    let maxEndHour = 0;
    let minStartHour = Infinity;
    for (const s of realSchedule.values()) {
        if (s.endHour > maxEndHour)
            maxEndHour = s.endHour;
        if (s.startHour < minStartHour)
            minStartHour = s.startHour;
    }
    if (minStartHour === Infinity)
        minStartHour = 0;
    const realSpanHours = maxEndHour - minStartHour;
    // Calculate display span for chart width (excludes in-progress "now" extension)
    // For in-progress tasks, use start + duration instead of their actual endHour
    let displayMaxEndHour = 0;
    for (const [taskId, s] of realSchedule) {
        const task = taskData.get(taskId);
        const status = task?.status?.toLowerCase() || '';
        const isInProgress = status === 'in progress' || status === 'wip';
        // For in-progress: use start + duration (not "now" extension)
        // For others: use actual end
        const displayEnd = isInProgress ? s.startHour + s.durationHours : s.endHour;
        if (displayEnd > displayMaxEndHour)
            displayMaxEndHour = displayEnd;
    }
    const displaySpanHours = displayMaxEndHour - minStartHour;
    return {
        realSpanHours,
        displaySpanHours,
        totalEffortHours,
        criticalTimespanHours,
        minStartHour,
        maxEndHour,
        displayMaxEndHour,
        criticalPath
    };
}
/**
 * Get task schedule from real schedule calculation
 * Helper to get individual task schedules for Gantt bar positioning
 * @param now Optional fixed "now" date for testing (defaults to current time)
 */
export function getTaskSchedules(taskData, effortConfig, t0, now) {
    return calculateRealSchedule(taskData, effortConfig, t0, now);
}
