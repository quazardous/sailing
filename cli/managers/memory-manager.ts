/**
 * Memory Manager
 *
 * Business logic for memory and log operations.
 * Manager layer: has access to config and state.
 *
 * Hierarchy: Task → Epic → PRD → Project
 * - Task logs: temporary, merged into epic
 * - Epic memory: curated tips/issues for epic scope
 * - PRD memory: cross-epic patterns, escalated by skill
 * - Project memory: architectural decisions, universal patterns
 */
import fs from 'fs';
import path from 'path';
import { getMemoryDir, resolvePlaceholders, resolvePath, getRepoRoot } from './core-manager.js';
import { getTaskEpic as artefactsGetTaskEpic, getEpicPrd as artefactsGetEpicPrd, getTasksForEpic as artefactsGetTasksForEpic, getMemoryFile, getLogFile, invalidateLogIndex } from './artefacts-manager.js';
import { normalizeId } from '../lib/normalize.js';
import { LogFileEntry, MemoryEntry } from '../lib/types/memory.js';
import {
  extractAllSections,
  findSection,
  editSection,
  parseMultiSectionInput,
  parseLogLevels,
  AGENT_RELEVANT_SECTIONS
} from '../lib/memory-section.js';

// Re-export section functions
export {
  extractAllSections,
  findSection,
  editSection,
  parseMultiSectionInput,
  parseLogLevels,
  AGENT_RELEVANT_SECTIONS
};

// ============================================================================
// Template Helpers (internal)
// ============================================================================

function getTemplatesDir(): string {
  const custom = resolvePath('templates');
  if (custom) return custom;
  const sailingRoot = resolvePlaceholders('^/');
  return path.join(sailingRoot, 'templates');
}

function loadTemplate(templateName: string): string | null {
  const templatePath = path.join(getTemplatesDir(), templateName);
  if (fs.existsSync(templatePath)) {
    return fs.readFileSync(templatePath, 'utf8');
  }
  return null;
}

// ============================================================================
// Path Functions
// ============================================================================

export function getMemoryDirPath(): string {
  return getMemoryDir();
}

export function ensureMemoryDir(): void {
  const memDir = getMemoryDirPath();
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }
}

/**
 * Construct expected log file path (for writing new logs)
 */
export function logFilePath(id: string): string {
  return path.join(getMemoryDirPath(), `${normalizeId(id)}.log`);
}

/**
 * Find actual log file by normalized ID (uses index)
 */
function findLogFileByIndex(id: string): { path: string; exists: boolean } {
  const entry = getLogFile(id);
  if (entry) {
    return { path: entry.file, exists: true };
  }
  return { path: logFilePath(id), exists: false };
}

/**
 * Construct expected PRD memory file path (for creating new files)
 */
export function prdMemoryFilePath(prdId: string): string {
  return path.join(getMemoryDirPath(), `${normalizeId(prdId)}.md`);
}

/**
 * Find actual PRD memory file by normalized ID (uses index)
 */
export function findPrdMemoryFile(prdId: string): { path: string; exists: boolean } {
  const entry = getMemoryFile(prdId);
  if (entry && entry.type === 'prd') {
    return { path: entry.file, exists: true };
  }
  return { path: prdMemoryFilePath(prdId), exists: false };
}

/**
 * Construct expected epic memory file path (for creating new files)
 */
export function epicMemoryFilePath(epicId: string): string {
  return path.join(getMemoryDirPath(), `${normalizeId(epicId)}.md`);
}

/**
 * Find actual epic memory file by normalized ID (uses index)
 */
export function findEpicMemoryFile(epicId: string): { path: string; exists: boolean } {
  const entry = getMemoryFile(epicId);
  if (entry && entry.type === 'epic') {
    return { path: entry.file, exists: true };
  }
  return { path: epicMemoryFilePath(epicId), exists: false };
}

export function projectMemoryFilePath(): string {
  const artefactsPath = resolvePath('artefacts') || resolvePlaceholders('${haven}/artefacts');
  return path.join(artefactsPath, 'MEMORY.md');
}

// ============================================================================
// EpicMemoryManager Class (POO Encapsulation)
// ============================================================================

/**
 * Epic-scoped memory operations.
 * Encapsulates epicId to avoid parameter repetition.
 *
 * @example
 * const epicMem = getEpicMemory('E001');
 * if (!epicMem.memoryExists()) epicMem.createMemory();
 * const content = epicMem.getLogContent();
 */
export class EpicMemoryManager {
  public readonly epicId: string;
  private readonly memoryDir: string;

  constructor(epicId: string) {
    this.epicId = normalizeId(epicId);
    this.memoryDir = getMemoryDir();
  }

  // --- Path accessors ---

  getMemoryPath(): string {
    return path.join(this.memoryDir, `${this.epicId}.md`);
  }

  getLogPath(): string {
    return path.join(this.memoryDir, `${this.epicId}.log`);
  }

  // --- Existence checks ---

  memoryExists(): boolean {
    return fs.existsSync(this.getMemoryPath());
  }

  logExists(): boolean {
    return fs.existsSync(this.getLogPath());
  }

  // --- Log operations ---

  getLogContent(): string | null {
    const logPath = this.getLogPath();
    if (!fs.existsSync(logPath)) return null;
    return fs.readFileSync(logPath, 'utf8').trim();
  }

  deleteLog(): boolean {
    const logPath = this.getLogPath();
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
      return true;
    }
    return false;
  }

  // --- Memory file creation ---

  createMemory(): string {
    ensureMemoryDir();
    const mdPath = this.getMemoryPath();
    const now = new Date().toISOString();

    let content = loadTemplate('memory-epic.md');
    if (content) {
      content = content
        .replace(/E0000/g, this.epicId)
        .replace(/created: ''/g, `created: '${now}'`)
        .replace(/updated: ''/g, `updated: '${now}'`);
    } else {
      content = `---
epic: ${this.epicId}
created: '${now}'
updated: '${now}'
---

# Memory: ${this.epicId}

## Agent Context

## Escalation

## Changelog
`;
    }

    fs.writeFileSync(mdPath, content);
    return mdPath;
  }

  // --- Task log merging ---

  mergeTaskLogs(options: { keep?: boolean } = {}): MergeLogsResult {
    const tasksForEpic = findTasksForEpic(this.epicId);

    const result: MergeLogsResult = {
      flushedCount: 0,
      totalEntries: 0,
      deletedEmpty: 0,
      epicLogFile: ''
    };

    if (tasksForEpic.length === 0) {
      return result;
    }

    ensureMemoryDir();
    result.epicLogFile = this.getLogPath();

    for (const task of tasksForEpic) {
      const taskLogFile = logFilePath(task.id);
      if (!fs.existsSync(taskLogFile)) continue;

      const content = fs.readFileSync(taskLogFile, 'utf8').trim();

      if (!content) {
        if (!options.keep) {
          fs.unlinkSync(taskLogFile);
          result.deletedEmpty++;
        }
        continue;
      }

      const entries = content.split('\n').length;
      result.totalEntries += entries;

      const header = `\n### ${task.id}: ${task.title}\n`;
      fs.appendFileSync(result.epicLogFile, header + content + '\n');
      result.flushedCount++;

      if (!options.keep) {
        fs.unlinkSync(taskLogFile);
      }
    }

    return result;
  }

  // --- Agent memory (filtered for agents) ---

  getAgentMemory(): string | null {
    const parts: string[] = [];

    // 1. Epic memory
    const epicMemory = getMemoryFile(this.epicId);
    if (epicMemory && fs.existsSync(epicMemory.file)) {
      const content = fs.readFileSync(epicMemory.file, 'utf8');
      const sections = extractAllSections(content);
      const relevant = sections.filter(s => AGENT_RELEVANT_SECTIONS.includes(s.name));
      if (relevant.length > 0) {
        parts.push(`### Epic ${this.epicId}\n`);
        for (const sec of relevant) {
          parts.push(`**${sec.name}**\n${sec.content}\n`);
        }
      }
    }

    // 2. PRD memory (if exists)
    const prd = artefactsGetEpicPrd(this.epicId);
    if (prd) {
      const prdMemoryPath = path.join(this.memoryDir, `${prd.prdId}.md`);
      if (fs.existsSync(prdMemoryPath)) {
        const content = fs.readFileSync(prdMemoryPath, 'utf8');
        const sections = extractAllSections(content);
        const relevant = sections.filter(s => AGENT_RELEVANT_SECTIONS.includes(s.name));
        if (relevant.length > 0) {
          parts.push(`### PRD ${prd.prdId}\n`);
          for (const sec of relevant) {
            parts.push(`**${sec.name}**\n${sec.content}\n`);
          }
        }
      }
    }

    // 3. Project memory (if exists)
    const repoRoot = getRepoRoot();
    const projectMemoryPath = repoRoot ? path.join(repoRoot, '.sailing', 'memory', 'PROJECT.md') : null;
    if (projectMemoryPath && fs.existsSync(projectMemoryPath)) {
      const content = fs.readFileSync(projectMemoryPath, 'utf8');
      const sections = extractAllSections(content);
      const relevant = sections.filter(s => AGENT_RELEVANT_SECTIONS.includes(s.name));
      if (relevant.length > 0) {
        parts.push(`### Project\n`);
        for (const sec of relevant) {
          parts.push(`**${sec.name}**\n${sec.content}\n`);
        }
      }
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an EpicMemoryManager for an epic
 */
export function getEpicMemory(epicId: string): EpicMemoryManager {
  return new EpicMemoryManager(epicId);
}

// ============================================================================
// Helper for EpicMemoryManager (internal)
// ============================================================================

function findTasksForEpic(epicId: string): Array<{ id: string; title: string }> {
  const tasks = artefactsGetTasksForEpic(epicId);
  return tasks.map(t => ({
    id: normalizeId(t.data?.id || t.id),
    title: t.data?.title || 'Untitled'
  }));
}

// ============================================================================
// Existence Checks
// ============================================================================

export function logFileExists(id: string): boolean {
  return findLogFileByIndex(id).exists;
}

export function prdMemoryExists(prdId: string): boolean {
  return findPrdMemoryFile(prdId).exists;
}

export function projectMemoryExists(): boolean {
  return fs.existsSync(projectMemoryFilePath());
}

// ============================================================================
// Log File Operations
// ============================================================================

export function readLogFile(id: string): string | null {
  const { path: filePath, exists } = findLogFileByIndex(id);
  if (!exists) return null;
  return fs.readFileSync(filePath, 'utf8').trim();
}

export function appendLogFile(id: string, content: string): void {
  ensureMemoryDir();
  fs.appendFileSync(logFilePath(id), content);
}

export function deleteLogFile(id: string): boolean {
  const { path: filePath, exists } = findLogFileByIndex(id);
  if (exists) {
    fs.unlinkSync(filePath);
    invalidateLogIndex();
    return true;
  }
  return false;
}

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

export function hasPendingMemoryLogs(): boolean {
  const epicLogs = findLogFiles().filter(f => f.type === 'epic');
  for (const { id: epicId } of epicLogs) {
    const content = readLogFile(epicId);
    if (content) return true;
  }
  return false;
}

// ============================================================================
// Hierarchy Lookups
// ============================================================================

export function findTaskEpic(taskId: string | number): { epicId: string; title: string } | null {
  const result = artefactsGetTaskEpic(taskId);
  if (!result) return null;
  return {
    epicId: normalizeId(result.epicId),
    title: result.title
  };
}

export function findEpicPrd(epicId: string | number): string | null {
  const result = artefactsGetEpicPrd(epicId);
  if (!result) return null;
  return normalizeId(result.prdId);
}

// ============================================================================
// Memory File Creation
// ============================================================================

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

export function createEpicMemoryFile(epicId: string): string {
  ensureMemoryDir();
  const normalized = normalizeId(epicId);
  const mdPath = epicMemoryFilePath(normalized);

  // Don't overwrite existing memory file
  if (fs.existsSync(mdPath)) {
    return mdPath;
  }

  const now = new Date().toISOString();

  let content = loadTemplate('memory-epic.md');
  if (content) {
    content = content
      .replace(/E000/g, normalized)
      .replace(/created: ''/g, `created: '${now}'`)
      .replace(/updated: ''/g, `updated: '${now}'`);
  } else {
    content = `---
epic: ${normalized}
created: '${now}'
updated: '${now}'
---

# Memory: ${normalized}

## Tips

## Commands

## Issues

## Solutions
`;
  }

  fs.writeFileSync(mdPath, content);
  return mdPath;
}

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

// ============================================================================
// Hierarchical Memory
// ============================================================================

export function getHierarchicalMemory(id: string): { project: MemoryEntry | null; prd: MemoryEntry | null; epic: MemoryEntry | null } {
  const result: { project: MemoryEntry | null; prd: MemoryEntry | null; epic: MemoryEntry | null } = { project: null, prd: null, epic: null };

  let epicId: string | null = null;
  if (id.startsWith('T')) {
    const taskInfo = findTaskEpic(id);
    if (taskInfo) epicId = taskInfo.epicId;
  } else if (id.startsWith('E')) {
    epicId = normalizeId(id);
  }

  if (epicId) {
    const epicMem = new EpicMemoryManager(epicId);
    if (epicMem.memoryExists()) {
      result.epic = {
        id: epicId,
        path: epicMem.getMemoryPath(),
        content: fs.readFileSync(epicMem.getMemoryPath(), 'utf8')
      };
    }
  }

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

  if (projectMemoryExists()) {
    result.project = {
      id: 'PROJECT',
      path: projectMemoryFilePath(),
      content: fs.readFileSync(projectMemoryFilePath(), 'utf8')
    };
  }

  return result;
}

// ============================================================================
// Log Merging
// ============================================================================

export function mergeTaskLog(taskId: string, actualPath: string | null = null): { merged: boolean; epicId: string | null; deleted: boolean } {
  const taskLogPath = actualPath || logFilePath(taskId);
  if (!fs.existsSync(taskLogPath)) {
    return { merged: false, epicId: null, deleted: false };
  }

  const content = fs.readFileSync(taskLogPath, 'utf8').trim();

  if (!content) {
    fs.unlinkSync(taskLogPath);
    return { merged: false, epicId: null, deleted: true };
  }

  const taskNumMatch = taskId.match(/^T0*(\d+)$/i);
  const taskNum = taskNumMatch ? parseInt(taskNumMatch[1], 10) : null;

  let taskInfo = findTaskEpic(taskId);
  if (!taskInfo && taskNum !== null) {
    taskInfo = findTaskEpic(`T${taskNum}`);
  }

  if (!taskInfo) {
    return { merged: false, epicId: null, deleted: false };
  }

  const prefixedLines = content.split('\n').map(line => {
    return line.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) /, `$1 [${taskId}] `);
  }).join('\n');

  const epicLogPath = logFilePath(taskInfo.epicId);
  fs.appendFileSync(epicLogPath, prefixedLines + '\n');

  fs.unlinkSync(taskLogPath);

  return { merged: true, epicId: taskInfo.epicId, deleted: false };
}

// ============================================================================
// Business Logic (Manager-specific)
// ============================================================================

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

export function checkPendingMemory(epicId: string | null = null): PendingMemoryResult {
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

  let epicLogs = findLogFiles().filter(f => f.type === 'epic');
  if (epicId) {
    epicLogs = epicLogs.filter(f => f.id === normalizeId(epicId));
  }

  const pendingEpics = epicLogs
    .filter(({ id }) => readLogFile(id))
    .map(({ id }) => id);

  return {
    pending: pendingEpics.length > 0,
    epics: pendingEpics,
    tasksMerged
  };
}

export function countTaskTips(taskId: string): number {
  const taskLog = readLogFile(taskId);
  if (!taskLog) return 0;

  const matches = taskLog.match(/\[TIP\]/g);
  return matches ? matches.length : 0;
}

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

// ============================================================================
// Task Log Entry
// ============================================================================

export type LogLevel = 'INFO' | 'TIP' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface TaskLogMeta {
  files?: string[];
  snippet?: string;
  cmd?: string;
}

/**
 * Append a log entry for a task.
 * Creates memory directory if needed.
 *
 * @param taskId - Task ID (e.g., T042)
 * @param level - Log level
 * @param message - Log message
 * @param meta - Optional metadata (files, snippet, cmd)
 * @returns The formatted entry that was written
 */
export function appendTaskLog(
  taskId: string,
  level: LogLevel,
  message: string,
  meta?: TaskLogMeta
): string {
  ensureMemoryDir();

  const normalizedId = normalizeId(taskId);
  const timestamp = new Date().toISOString();

  let entry = `${timestamp} [${level}] ${message}`;

  // Add metadata as JSON suffix if present
  if (meta && Object.keys(meta).length > 0) {
    const cleanMeta: Record<string, unknown> = {};
    if (meta.files?.length) cleanMeta.files = meta.files;
    if (meta.snippet) cleanMeta.snippet = meta.snippet;
    if (meta.cmd) cleanMeta.cmd = meta.cmd;

    if (Object.keys(cleanMeta).length > 0) {
      entry += ` {{${JSON.stringify(cleanMeta)}}}`;
    }
  }

  entry += '\n';

  appendLogFile(normalizedId, entry);

  return entry;
}

// ============================================================================
// Memory Section Editing (Manager-level)
// ============================================================================

export type MemoryLevel = 'epic' | 'prd' | 'project';
export type MemorySectionName = 'Agent Context' | 'Escalation' | 'Cross-Epic Patterns' | 'Architecture Decisions' | 'Patterns & Conventions' | 'Changelog' | 'Tips' | 'Commands' | 'Issues' | 'Solutions';

export interface EditMemorySectionResult {
  success: boolean;
  message: string;
  path?: string;
}

/**
 * Edit a section in a memory file (epic, PRD, or project level)
 * Creates the memory file if it doesn't exist.
 */
export function editMemorySection(
  level: MemoryLevel,
  targetId: string,
  section: MemorySectionName,
  content: string,
  operation: 'append' | 'prepend' | 'replace' = 'append'
): EditMemorySectionResult {
  const normalized = normalizeId(targetId);
  let memoryPath: string;

  // Get or create memory file (using find functions to handle ID format mismatches)
  try {
    if (level === 'epic') {
      const found = findEpicMemoryFile(normalized!);
      if (!found.exists) {
        createEpicMemoryFile(normalized!);
        memoryPath = epicMemoryFilePath(normalized!);
      } else {
        memoryPath = found.path;
      }
    } else if (level === 'prd') {
      const found = findPrdMemoryFile(normalized!);
      if (!found.exists) {
        createPrdMemoryFile(normalized!);
        memoryPath = prdMemoryFilePath(normalized!);
      } else {
        memoryPath = found.path;
      }
    } else {
      memoryPath = projectMemoryFilePath();
      if (!fs.existsSync(memoryPath)) {
        createProjectMemoryFile();
      }
    }
  } catch (err) {
    return {
      success: false,
      message: `Failed to access memory file: ${err}`
    };
  }

  // Read current content
  const memoryContent = fs.readFileSync(memoryPath, 'utf8');

  // Edit the section
  const editResult = editSection(memoryContent, section, content, operation);

  if ('warning' in editResult) {
    return {
      success: false,
      message: editResult.warning,
      path: memoryPath
    };
  }

  if ('error' in editResult) {
    return {
      success: false,
      message: editResult.error,
      path: memoryPath
    };
  }

  // Write back
  fs.writeFileSync(memoryPath, editResult.content);

  const actionVerb = operation === 'append' ? 'Appended to' : operation === 'prepend' ? 'Prepended to' : 'Replaced';
  return {
    success: true,
    message: `${actionVerb} ${section} in ${level} ${normalized}`,
    path: memoryPath
  };
}

// ============================================================================
// Flush Epic Logs (after consolidation)
// ============================================================================

export interface FlushEpicLogsResult {
  epicId: string;
  flushed: boolean;
  entriesCleared: number;
}

/**
 * Flush/clear epic logs after consolidation into memory
 */
export function flushEpicLogs(epicId: string): FlushEpicLogsResult {
  const normalized = normalizeId(epicId);
  const content = readLogFile(normalized);

  if (!content) {
    return { epicId: normalized, flushed: false, entriesCleared: 0 };
  }

  const entriesCount = content.split('\n').filter(l => l.trim()).length;
  const deleted = deleteLogFile(normalized);

  return {
    epicId: normalized,
    flushed: deleted,
    entriesCleared: deleted ? entriesCount : 0
  };
}

