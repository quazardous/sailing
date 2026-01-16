/**
 * Memory Manager
 *
 * Business logic for memory and log operations.
 * Pure functions are in lib/memory.ts.
 *
 * - Task log merging into epic logs
 * - Pending memory detection
 * - Memory file lifecycle
 */
import fs from 'fs';
import path from 'path';
import { findLogFiles, readLogFile, mergeTaskLog, findTaskEpic, ensureMemoryDir, getMemoryDirPath, logFilePath, parseLogLevels } from '../memory.js';
import { normalizeId } from '../normalize.js';
import { getTasksForEpic as artefactsGetTasksForEpic } from '../artefacts.js';
/**
 * Check for pending memory (logs not consolidated)
 * Automatically merges task logs first, then checks for epic logs
 *
 * @param epicId - Optional: filter to specific epic
 */
export function checkPendingMemory(epicId = null) {
    // Merge task logs first
    const taskLogs = findLogFiles().filter(f => f.type === 'task');
    let tasksMerged = 0;
    for (const { id: taskId, path: taskPath } of taskLogs) {
        if (epicId) {
            const taskInfo = findTaskEpic(taskId);
            if (!taskInfo || taskInfo.epicId !== epicId)
                continue;
        }
        const result = mergeTaskLog(taskId, taskPath);
        if (result.merged)
            tasksMerged++;
    }
    // Check for epic logs
    let epicLogs = findLogFiles().filter(f => f.type === 'epic');
    if (epicId) {
        epicLogs = epicLogs.filter(f => f.id === normalizeId(epicId));
    }
    const pendingEpics = epicLogs
        .filter(({ id }) => readLogFile(id)) // Has content
        .map(({ id }) => id);
    return {
        pending: pendingEpics.length > 0,
        epics: pendingEpics,
        tasksMerged
    };
}
/**
 * Find all tasks belonging to an epic
 * Uses artefacts.ts for lookup (contract compliance)
 */
function findTasksForEpic(epicId) {
    const tasks = artefactsGetTasksForEpic(epicId);
    return tasks.map(t => ({
        id: normalizeId(t.data?.id || t.id),
        title: t.data?.title || 'Untitled'
    }));
}
/**
 * Merge all task logs into epic log with headers
 * This is the orchestration function for epic:merge-logs
 *
 * @param epicId - Epic ID
 * @param options - { keep: boolean } - keep task logs after merge
 */
export function mergeEpicTaskLogs(epicId, options = {}) {
    const normalizedEpicId = normalizeId(epicId);
    const tasksForEpic = findTasksForEpic(normalizedEpicId);
    const result = {
        flushedCount: 0,
        totalEntries: 0,
        deletedEmpty: 0,
        epicLogFile: ''
    };
    if (tasksForEpic.length === 0) {
        return result;
    }
    // Ensure memory directory exists
    ensureMemoryDir();
    const memDir = getMemoryDirPath();
    result.epicLogFile = path.join(memDir, `${normalizedEpicId}.log`);
    // Process each task log
    for (const task of tasksForEpic) {
        const taskLogFile = logFilePath(task.id);
        if (!fs.existsSync(taskLogFile))
            continue;
        const content = fs.readFileSync(taskLogFile, 'utf8').trim();
        // Delete empty logs
        if (!content) {
            if (!options.keep) {
                fs.unlinkSync(taskLogFile);
                result.deletedEmpty++;
            }
            continue;
        }
        const entries = content.split('\n').length;
        result.totalEntries += entries;
        // Append to epic log with task header
        const header = `\n### ${task.id}: ${task.title}\n`;
        fs.appendFileSync(result.epicLogFile, header + content + '\n');
        result.flushedCount++;
        // Clear task log unless --keep
        if (!options.keep) {
            fs.unlinkSync(taskLogFile);
        }
    }
    return result;
}
/**
 * Count TIP log entries in a task's log file
 */
export function countTaskTips(taskId) {
    const taskLog = readLogFile(taskId);
    if (!taskLog)
        return 0;
    const matches = taskLog.match(/\[TIP\]/g);
    return matches ? matches.length : 0;
}
/**
 * Get log statistics for an entity
 */
export function getLogStats(id) {
    const content = readLogFile(id);
    if (!content) {
        return {
            exists: false,
            lines: 0,
            levels: { TIP: 0, INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 }
        };
    }
    return {
        exists: true,
        lines: content.split('\n').filter(l => l.trim()).length,
        levels: parseLogLevels(content)
    };
}
/**
 * Delete epic log file
 */
export function deleteEpicLog(epicId) {
    const epicLogFile = logFilePath(normalizeId(epicId));
    if (fs.existsSync(epicLogFile)) {
        fs.unlinkSync(epicLogFile);
        return true;
    }
    return false;
}
/**
 * Get epic log content
 */
export function getEpicLogContent(epicId) {
    return readLogFile(normalizeId(epicId));
}
