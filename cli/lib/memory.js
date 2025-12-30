/**
 * Memory operations library
 * Centralized functions for memory file manipulation
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, findFiles, loadFile, getMemoryDir } from './core.js';
import { normalizeId } from './normalize.js';

// Dynamic getter for memory directory
export function getMemoryDirPath() {
  return getMemoryDir();
}

/**
 * Ensure memory directory exists
 */
export function ensureMemoryDir() {
  const memDir = getMemoryDirPath();
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }
}

/**
 * Get path to memory file (.md)
 */
export function memoryFilePath(epicId) {
  return path.join(getMemoryDirPath(), `${normalizeId(epicId)}.md`);
}

/**
 * Get path to log file (.log)
 */
export function logFilePath(id) {
  return path.join(getMemoryDirPath(), `${normalizeId(id)}.log`);
}

/**
 * Check if memory file exists
 */
export function memoryFileExists(epicId) {
  return fs.existsSync(memoryFilePath(epicId));
}

/**
 * Check if log file exists
 */
export function logFileExists(id) {
  return fs.existsSync(logFilePath(id));
}

/**
 * Read log file content (trimmed)
 */
export function readLogFile(id) {
  const filePath = logFilePath(id);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8').trim();
}

/**
 * Append to log file
 */
export function appendLogFile(id, content) {
  ensureMemoryDir();
  fs.appendFileSync(logFilePath(id), content);
}

/**
 * Delete log file
 */
export function deleteLogFile(id) {
  const filePath = logFilePath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Find all log files
 * @returns {Array<{id: string, type: 'task'|'epic'|'other', path: string}>}
 */
export function findLogFiles() {
  ensureMemoryDir();
  const memDir = getMemoryDirPath();
  return fs.readdirSync(memDir)
    .filter(f => f.endsWith('.log'))
    .map(f => {
      const id = f.replace('.log', '');
      return {
        id,
        type: id.startsWith('E') ? 'epic' : id.startsWith('T') ? 'task' : 'other',
        path: path.join(memDir, f)
      };
    });
}

/**
 * Find parent epic for a task
 * @returns {{epicId: string, title: string}|null}
 */
export function findTaskEpic(taskId) {
  for (const prdDir of findPrdDirs()) {
    const tasksDir = path.join(prdDir, 'tasks');
    const taskFiles = findFiles(tasksDir, new RegExp(`^${taskId}.*\\.md$`));
    if (taskFiles.length > 0) {
      const file = loadFile(taskFiles[0]);
      if (file?.data?.parent) {
        const match = file.data.parent.match(/E\d+/);
        if (match) {
          return {
            epicId: normalizeId(match[0]),
            title: file.data.title || taskId
          };
        }
      }
    }
  }
  return null;
}

/**
 * Parse log content and count entries by level
 * Format: "2025-12-27T15:08:03.293Z [T139] [INFO] message"
 */
export function parseLogLevels(content) {
  const counts = { TIP: 0, INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 };
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // Match level after optional [TNNN] prefix
    // Format: "timestamp [TNNN] [LEVEL] message" or "timestamp [LEVEL] message"
    const match = line.match(/\[T\d+\]\s*\[(\w+)\]|\[(\w+)\]/);
    if (match) {
      const level = (match[1] || match[2]).toUpperCase();
      if (counts.hasOwnProperty(level)) {
        counts[level]++;
      }
    }
  }

  return counts;
}

/**
 * Create memory file from template
 */
export function createMemoryFile(epicId) {
  ensureMemoryDir();
  const mdPath = memoryFilePath(epicId);
  const now = new Date().toISOString();
  const content = `---
epic: ${epicId}
created: '${now}'
updated: '${now}'
---

# Memory: ${epicId}

## Agent Context

<!--
Actionable tips for agents. NO [TIP] prefix.
-->

## Escalation

<!--
Issues requiring attention. Keep [TNNN] for traceability.
-->

## Changelog

<!--
Chronological, with [TNNN] refs. NOT raw logs.
-->
`;
  fs.writeFileSync(mdPath, content);
  return mdPath;
}

/**
 * Merge a task log into its parent epic log
 * @returns {{merged: boolean, epicId: string|null, deleted: boolean}}
 */
export function mergeTaskLog(taskId) {
  const taskLogPath = logFilePath(taskId);
  if (!fs.existsSync(taskLogPath)) {
    return { merged: false, epicId: null, deleted: false };
  }

  const content = fs.readFileSync(taskLogPath, 'utf8').trim();

  // Delete empty logs
  if (!content) {
    fs.unlinkSync(taskLogPath);
    return { merged: false, epicId: null, deleted: true };
  }

  const taskInfo = findTaskEpic(taskId);
  if (!taskInfo) {
    return { merged: false, epicId: null, deleted: false };
  }

  // Prefix each line with [TNNN] after timestamp
  const prefixedLines = content.split('\n').map(line => {
    // Format: "2025-12-27T15:08:03.293Z [INFO] message"
    // → "2025-12-27T15:08:03.293Z [T139] [INFO] message"
    return line.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) /, `$1 [${taskId}] `);
  }).join('\n');

  // Append to epic log
  const epicLogPath = logFilePath(taskInfo.epicId);
  fs.appendFileSync(epicLogPath, prefixedLines + '\n');

  // Delete task log after merge
  fs.unlinkSync(taskLogPath);

  return { merged: true, epicId: taskInfo.epicId, deleted: false };
}
