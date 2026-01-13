/**
 * Memory operations library
 * Centralized functions for memory file manipulation
 *
 * Hierarchy: Task → Epic → PRD → Project
 * - Task logs: temporary, merged into epic
 * - Epic memory: curated tips/issues for epic scope
 * - PRD memory: cross-epic patterns, escalated by skill
 * - Project memory: architectural decisions, universal patterns
 * TODO[P3]: Separate pure parsing from CLI-facing utilities to simplify gradual TS adoption.
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, findFiles, loadFile, getMemoryDir } from './core.js';
import { resolvePlaceholders, resolvePath } from './paths.js';
import { normalizeId } from './normalize.js';
import { getTaskEpic as indexGetTaskEpic, getEpicPrd as indexGetEpicPrd } from './index.js';
import { LogFileEntry, LogLevelCounts, MemoryEntry } from './types/memory.js';

/**
 * Get templates directory
 */
function getTemplatesDir(): string {
  const custom = resolvePath('templates');
  if (custom) return custom;
  // Fallback to sailing repo templates
  const sailingRoot = resolvePlaceholders('^/');
  return path.join(sailingRoot, 'templates');
}

/**
 * Load template file content
 */
function loadTemplate(templateName: string): string | null {
  const templatePath = path.join(getTemplatesDir(), templateName);
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, 'utf8');
  }
  return null;
}

// Dynamic getter for memory directory
export function getMemoryDirPath(): string {
  return getMemoryDir();
}

/**
 * Ensure memory directory exists
 */
export function ensureMemoryDir(): void {
  const memDir = getMemoryDirPath();
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }
}

/**
 * Get path to memory file (.md)
 */
export function memoryFilePath(epicId: string): string {
  return path.join(getMemoryDirPath(), `${normalizeId(epicId)}.md`);
}

/**
 * Get path to log file (.log)
 */
export function logFilePath(id: string): string {
  return path.join(getMemoryDirPath(), `${normalizeId(id)}.log`);
}

/**
 * Check if memory file exists
 */
export function memoryFileExists(epicId: string): boolean {
  return fs.existsSync(memoryFilePath(epicId));
}

/**
 * Check if log file exists
 */
export function logFileExists(id: string): boolean {
  return fs.existsSync(logFilePath(id));
}

/**
 * Read log file content (trimmed)
 */
export function readLogFile(id: string): string | null {
  const filePath = logFilePath(id);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8').trim();
}

/**
 * Append to log file
 */
export function appendLogFile(id: string, content: string): void {
  ensureMemoryDir();
  fs.appendFileSync(logFilePath(id), content);
}

/**
 * Delete log file
 */
export function deleteLogFile(id: string): boolean {
  const filePath = logFilePath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Find all log files
 */
export function findLogFiles(): LogFileEntry[] {
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
 * Uses index library for format-agnostic lookup (T039, T0039, T00039 all work)
 */
export function findTaskEpic(taskId: string | number): { epicId: string; title: string } | null {
  const result = indexGetTaskEpic(taskId);
  if (!result) return null;

  return {
    epicId: normalizeId(result.epicId),
    title: result.title
  };
}

/**
 * Parse log content and count entries by level
 * Format: "2025-12-27T15:08:03.293Z [T139] [INFO] message"
 */
export function parseLogLevels(content: string): LogLevelCounts {
  const counts: LogLevelCounts = { TIP: 0, INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 };
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    // Match level after optional [TNNN] prefix
    // Format: "timestamp [TNNN] [LEVEL] message" or "timestamp [LEVEL] message"
    const match = line.match(/ \[T\d+\]\s*\[(\w+)\]|\[(\w+)\]/);
    if (match) {
      const level = (match[1] || match[2]).toUpperCase();
      if (Object.prototype.hasOwnProperty.call(counts, level)) {
        counts[level]++;
      }
    }
  }

  return counts;
}

/**
 * Create epic memory file from template
 */
export function createMemoryFile(epicId: string): string {
  ensureMemoryDir();
  const mdPath = memoryFilePath(epicId);
  const now = new Date().toISOString();

  // Try to load template
  let content = loadTemplate('memory-epic.md');
  if (content) {
    content = content
      .replace(/E0000/g, epicId)
      .replace(/created: ''/g, `created: '${now}'`)
      .replace(/updated: ''/g, `updated: '${now}'`);
  } else {
    // Fallback if template not found
    content = `--- 
epic: ${epicId}
created: '${now}'
updated: '${now}'
---

# Memory: ${epicId}

## Agent Context

## Escalation

## Changelog
`;
  }

  fs.writeFileSync(mdPath, content);
  return mdPath;
}

// ============ PRD Memory ============ 

/**
 * Get path to PRD memory file
 */
export function prdMemoryFilePath(prdId: string): string {
  return path.join(getMemoryDirPath(), `${normalizeId(prdId)}.md`);
}

/**
 * Check if PRD memory exists
 */
export function prdMemoryExists(prdId: string): boolean {
  return fs.existsSync(prdMemoryFilePath(prdId));
}

/**
 * Create PRD memory file from template
 */
export function createPrdMemoryFile(prdId: string): string {
  ensureMemoryDir();
  const mdPath = prdMemoryFilePath(prdId);
  const now = new Date().toISOString();

  let content = loadTemplate('memory-prd.md');
  if (content) {
    content = content
      .replace(/PRD-000/g, prdId)
      .replace(/created: ''/g, `created: '${now}'`)
      .replace(/updated: ''/g, `updated: '${now}'`);
  } else {
    content = `--- 
prd: ${prdId}
created: '${now}'
updated: '${now}'
---

# Memory: ${prdId}

## Cross-Epic Patterns

## Decisions

## Escalation
`;
  }

  fs.writeFileSync(mdPath, content);
  return mdPath;
}

// ============ Project Memory ============ 

/**
 * Get path to project memory file (MEMORY.md in artefacts)
 */
export function projectMemoryFilePath(): string {
  const artefactsPath = resolvePath('artefacts') || resolvePlaceholders('${haven}/artefacts');
  return path.join(artefactsPath, 'MEMORY.md');
}

/**
 * Check if project memory exists
 */
export function projectMemoryExists(): boolean {
  return fs.existsSync(projectMemoryFilePath());
}

/**
 * Create project memory file from template
 */
export function createProjectMemoryFile(projectName = ''): string {
  const mdPath = projectMemoryFilePath();
  const dir = path.dirname(mdPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const now = new Date().toISOString();

  let content = loadTemplate('memory-dist.md');
  if (content) {
    content = content
      .replace(/project: ''/g, `project: '${projectName}'`)
      .replace(/updated: ''/g, `updated: '${now}'`);
  } else {
    content = `--- 
project: '${projectName}'
updated: '${now}'
---

# Project Memory

## Architecture Decisions

## Patterns & Conventions

## Lessons Learned
`;
  }

  fs.writeFileSync(mdPath, content);
  return mdPath;
}

// ============ Hierarchical Memory ============ 

/**
 * Find parent PRD for an epic
 * Uses index library for format-agnostic lookup
 * @returns {string|null} Normalized PRD ID (e.g., "PRD-001")
 */
export function findEpicPrd(epicId: string | number): string | null {
  const result = indexGetEpicPrd(epicId);
  if (!result) return null;
  return normalizeId(result.prdId);
}

/**
 * Get hierarchical memory content for a task/epic
 * Returns: { project, prd, epic } with content for each level
 */
export function getHierarchicalMemory(id: string): { project: MemoryEntry | null; prd: MemoryEntry | null; epic: MemoryEntry | null } {
  const result: { project: MemoryEntry | null; prd: MemoryEntry | null; epic: MemoryEntry | null } = { project: null, prd: null, epic: null };

  // Resolve epic ID
  let epicId: string | null = null;
  if (id.startsWith('T')) {
    const taskInfo = findTaskEpic(id);
    if (taskInfo) epicId = taskInfo.epicId;
  } else if (id.startsWith('E')) {
    epicId = normalizeId(id);
  }

  // Get epic memory
  if (epicId && memoryFileExists(epicId)) {
    result.epic = {
      id: epicId,
      path: memoryFilePath(epicId),
      content: fs.readFileSync(memoryFilePath(epicId), 'utf8')
    };
  }

  // Get PRD memory
  if (epicId) {
    const prdId = findEpicPrd(epicId);
    if (prdId && prdMemoryExists(prdId)) {
      result.prd = {
        id: prdId,
        path: prdMemoryFilePath(prdId),
        content: fs.readFileSync(prdMemoryFilePath(prdId), 'utf8')
      };
    }
  }

  // Get project memory
  if (projectMemoryExists()) {
    result.project = {
      id: 'PROJECT',
      path: projectMemoryFilePath(),
      content: fs.readFileSync(projectMemoryFilePath(), 'utf8')
    };
  }

  return result;
}

/**
 * Merge a task log into its parent epic log
 * @param {string} taskId - Task ID (any format: T1, T001, T00001)
 * @param {string} [actualPath] - Actual file path (avoids normalization issues)
 * @returns {{merged: boolean, epicId: string|null, deleted: boolean}}
 */
export function mergeTaskLog(taskId: string, actualPath: string | null = null): { merged: boolean; epicId: string | null; deleted: boolean } {
  // Use actual path if provided, otherwise calculate (may fail if format differs)
  const taskLogPath = actualPath || logFilePath(taskId);
  if (!fs.existsSync(taskLogPath)) {
    return { merged: false, epicId: null, deleted: false };
  }

  const content = fs.readFileSync(taskLogPath, 'utf8').trim();

  // Delete empty logs
  if (!content) {
    fs.unlinkSync(taskLogPath);
    return { merged: false, epicId: null, deleted: true };
  }

  // Extract numeric part from taskId (T00039 → 39, T1 → 1)
  const taskNumMatch = taskId.match(/^T0*(\d+)$/i);
  const taskNum = taskNumMatch ? parseInt(taskNumMatch[1], 10) : null;

  // Find epic using findTaskEpic (tries multiple ID formats)
  let taskInfo = findTaskEpic(taskId);

  // If not found, try with just the number (handles format changes)
  if (!taskInfo && taskNum !== null) {
    taskInfo = findTaskEpic(`T${taskNum}`);
  }

  if (!taskInfo) {
    return { merged: false, epicId: null, deleted: false };
  }

  // Prefix each line with [TNNN] after timestamp (use original taskId from filename)
  const prefixedLines = content.split('\n').map(line => {
    // Format: "2025-12-27T15:08:03.293Z [INFO] message"
    // → "2025-12-27T15:08:03.293Z [T00039] [INFO] message"
    return line.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) /, `$1 [${taskId}] `);
  }).join('\n');

  // Append to epic log (use normalized epic ID for consistency)
  const epicLogPath = logFilePath(taskInfo.epicId);
  fs.appendFileSync(epicLogPath, prefixedLines + '\n');

  // Delete task log after merge
  fs.unlinkSync(taskLogPath);

  return { merged: true, epicId: taskInfo.epicId, deleted: false };
}