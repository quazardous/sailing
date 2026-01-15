/**
 * Memory Manager
 *
 * Business logic for memory and log operations.
 * Internal implementation in lib/memory.ts and lib/memory-section.ts.
 *
 * - Task log merging into epic logs
 * - Pending memory detection
 * - Memory file lifecycle
 * - Section editing (extract, find, edit)
 */
import fs from 'fs';
import path from 'path';
import {
  findLogFiles,
  readLogFile,
  mergeTaskLog,
  findTaskEpic,
  ensureMemoryDir,
  getMemoryDirPath,
  logFilePath,
  memoryFilePath,
  memoryFileExists,
  parseLogLevels,
  createMemoryFile,
  prdMemoryFilePath,
  prdMemoryExists,
  createPrdMemoryFile,
  projectMemoryFilePath,
  projectMemoryExists,
  getHierarchicalMemory,
  findEpicPrd,
  hasPendingMemoryLogs
} from '../lib/memory.js';
import {
  extractAllSections,
  findSection,
  editSection,
  parseMultiSectionInput,
  AGENT_RELEVANT_SECTIONS,
  getAgentMemory
} from '../lib/memory-section.js';
import { getMemoryDir } from './core-manager.js';
import { normalizeId } from '../lib/normalize.js';
import { getTasksForEpic as artefactsGetTasksForEpic } from './artefacts-manager.js';

// Re-export memory functions for external use
export {
  // From lib/memory.js
  getMemoryDirPath,
  ensureMemoryDir,
  logFilePath,
  memoryFilePath,
  memoryFileExists,
  readLogFile,
  findLogFiles,
  findTaskEpic,
  parseLogLevels,
  createMemoryFile,
  mergeTaskLog,
  prdMemoryFilePath,
  prdMemoryExists,
  createPrdMemoryFile,
  projectMemoryFilePath,
  projectMemoryExists,
  getHierarchicalMemory,
  findEpicPrd,
  hasPendingMemoryLogs,
  // From lib/memory-section.js
  extractAllSections,
  findSection,
  editSection,
  parseMultiSectionInput,
  AGENT_RELEVANT_SECTIONS,
  getAgentMemory
};

export interface PendingMemoryResult {
  pending: boolean;
  epics: string[];
  tasksMerged: number;
}

export interface MergeLogsResult {
  flushedCount: number;
  totalEntries: number;
  deletedEmpty: number;
  epicLogFile: string;
}

/**
 * Check for pending memory (logs not consolidated)
 * Automatically merges task logs first, then checks for epic logs
 *
 * @param epicId - Optional: filter to specific epic
 */
export function checkPendingMemory(epicId: string | null = null): PendingMemoryResult {
  // Merge task logs first
  const taskLogs = findLogFiles().filter(f => f.type === 'task');
  let tasksMerged = 0;

  for (const { id: taskId, path: taskPath } of taskLogs) {
    if (epicId) {
      const taskInfo = findTaskEpic(taskId);
      if (!taskInfo || taskInfo.epicId !== epicId) continue;
    }
    const result = mergeTaskLog(taskId, taskPath);
    if (result.merged) tasksMerged++;
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
function findTasksForEpic(epicId: string): Array<{ id: string; title: string }> {
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
export function mergeEpicTaskLogs(
  epicId: string,
  options: { keep?: boolean } = {}
): MergeLogsResult {
  const normalizedEpicId = normalizeId(epicId);
  const tasksForEpic = findTasksForEpic(normalizedEpicId);

  const result: MergeLogsResult = {
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
    if (!fs.existsSync(taskLogFile)) continue;

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
export function countTaskTips(taskId: string): number {
  const taskLog = readLogFile(taskId);
  if (!taskLog) return 0;

  const matches = taskLog.match(/\[TIP\]/g);
  return matches ? matches.length : 0;
}

/**
 * Get log statistics for an entity
 */
export function getLogStats(id: string): {
  exists: boolean;
  lines: number;
  levels: { TIP: number; INFO: number; WARN: number; ERROR: number; CRITICAL: number };
} {
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
export function deleteEpicLog(epicId: string): boolean {
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
export function getEpicLogContent(epicId: string): string | null {
  return readLogFile(normalizeId(epicId));
}
