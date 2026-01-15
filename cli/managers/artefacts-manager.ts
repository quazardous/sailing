/**
 * Artefacts Manager - I/O and cache layer for artefact access
 *
 * This manager handles:
 * - File system operations (reading PRDs, epics, tasks, stories)
 * - Path resolution (via core.ts)
 * - Index caching and invalidation
 * - Orchestration of lib/artefacts.ts pure functions
 *
 * Commands should import from here, NOT from lib/artefacts.ts directly.
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, getMemoryDir, getPrdsDir } from './core-manager.js';
import { extractIdKey } from '../lib/artefacts.js';
import { extractEpicId, normalizeId } from '../lib/normalize.js';
import type {
  Task,
  Epic,
  Prd,
  Story,
  TaskIndexEntry,
  EpicIndexEntry,
  PrdIndexEntry,
  StoryIndexEntry,
  FullPrd,
  FullEpic,
  FullTask
} from '../lib/types/entities.js';

// ============================================================================
// CACHE
// ============================================================================

let _taskIndex: Map<string, TaskIndexEntry> | null = null;
let _epicIndex: Map<string, EpicIndexEntry> | null = null;
let _prdIndex: Map<number, PrdIndexEntry> | null = null;
let _storyIndex: Map<string, StoryIndexEntry> | null = null;
let _memoryIndex: Map<string, { key: string; type: 'epic' | 'prd'; file: string }> | null = null;

/**
 * Clear all caches (call after artefact changes)
 */
export function clearCache() {
  _taskIndex = null;
  _epicIndex = null;
  _prdIndex = null;
  _storyIndex = null;
  _memoryIndex = null;
}

// ============================================================================
// INDEX BUILDERS (I/O happens here)
// ============================================================================

/**
 * Build task index across all PRDs
 */
export function buildTaskIndex(): Map<string, TaskIndexEntry> {
  if (_taskIndex) return _taskIndex;

  _taskIndex = new Map();
  const duplicates: { key: string; existing: string; new: string }[] = [];

  for (const prdDir of findPrdDirs()) {
    const tasksDir = path.join(prdDir, 'tasks');
    if (!fs.existsSync(tasksDir)) continue;

    const files = fs.readdirSync(tasksDir).filter(f => /^T\d+[a-z]?.*\.md$/i.test(f));

    for (const file of files) {
      const key = extractIdKey(file, 'T');
      if (key === null) continue;

      const filePath = path.join(tasksDir, file);
      const idMatch = file.match(/^(T\d+[a-z]?)/i);
      const id = idMatch ? idMatch[1] : `T${key}`;

      const loaded = loadFile<Task>(filePath);
      const status = loaded?.data?.status;

      if (_taskIndex.has(key)) {
        const existingEntry = _taskIndex.get(key);
        const existingStatus = existingEntry.data?.status;
        if (status !== 'Done' || existingStatus !== 'Done') {
          duplicates.push({ key, existing: existingEntry.file, new: filePath });
        }
      }

      _taskIndex.set(key, {
        key,
        id,
        file: filePath,
        prdDir,
        data: loaded?.data || {}
      });
    }
  }

  if (duplicates.length > 0) {
    console.error(`⚠ Duplicate task IDs found:`);
    for (const d of duplicates) {
      console.error(`  T${d.key}: ${d.existing} vs ${d.new}`);
    }
  }

  return _taskIndex;
}

/**
 * Build epic index across all PRDs
 */
export function buildEpicIndex(): Map<string, EpicIndexEntry> {
  if (_epicIndex) return _epicIndex;

  _epicIndex = new Map();
  const duplicates: { key: string; existing: string; new: string }[] = [];

  for (const prdDir of findPrdDirs()) {
    const epicsDir = path.join(prdDir, 'epics');
    if (!fs.existsSync(epicsDir)) continue;

    const files = fs.readdirSync(epicsDir).filter(f => /^E\d+[a-z]?.*\.md$/i.test(f));

    for (const file of files) {
      const key = extractIdKey(file, 'E');
      if (key === null) continue;

      const filePath = path.join(epicsDir, file);
      const idMatch = file.match(/^(E\d+[a-z]?)/i);
      const id = idMatch ? idMatch[1] : `E${key}`;

      const loaded = loadFile<Epic>(filePath);
      const status = loaded?.data?.status;

      if (_epicIndex.has(key)) {
        const existingEntry = _epicIndex.get(key);
        const existingStatus = existingEntry.data?.status;
        if (status !== 'Done' || existingStatus !== 'Done') {
          duplicates.push({ key, existing: existingEntry.file, new: filePath });
        }
      }

      _epicIndex.set(key, {
        key,
        id,
        file: filePath,
        prdDir,
        data: loaded?.data || {}
      });
    }
  }

  if (duplicates.length > 0) {
    console.error(`⚠ Duplicate epic IDs found:`);
    for (const d of duplicates) {
      console.error(`  E${d.key}: ${d.existing} vs ${d.new}`);
    }
  }

  return _epicIndex;
}

/**
 * Build PRD index
 */
export function buildPrdIndex(): Map<number, PrdIndexEntry> {
  if (_prdIndex) return _prdIndex;

  _prdIndex = new Map();
  const duplicates: { num: number; existing: string; new: string }[] = [];

  for (const prdDir of findPrdDirs()) {
    const dirname = path.basename(prdDir);
    const match = dirname.match(/^PRD-0*(\d+)/i);
    if (!match) continue;

    const num = parseInt(match[1], 10);
    const idMatch = dirname.match(/^(PRD-\d+)/i);
    const id = idMatch ? idMatch[1] : `PRD-${num}`;

    const prdFile = path.join(prdDir, 'prd.md');
    const loaded = fs.existsSync(prdFile) ? loadFile<Prd>(prdFile) : null;

    if (_prdIndex.has(num)) {
      duplicates.push({ num, existing: _prdIndex.get(num).dir, new: prdDir });
    }

    _prdIndex.set(num, {
      num,
      id,
      dir: prdDir,
      file: prdFile,
      data: loaded?.data || {}
    });
  }

  if (duplicates.length > 0) {
    console.error(`⚠ Duplicate PRD numbers found:`);
    for (const d of duplicates) {
      console.error(`  PRD-${d.num}: ${d.existing} vs ${d.new}`);
    }
  }

  return _prdIndex;
}

/**
 * Build story index across all PRDs
 */
export function buildStoryIndex(): Map<string, StoryIndexEntry> {
  if (_storyIndex) return _storyIndex;

  _storyIndex = new Map();
  const duplicates: { key: string; existing: string; new: string }[] = [];

  for (const prdDir of findPrdDirs()) {
    const storiesDir = path.join(prdDir, 'stories');
    if (!fs.existsSync(storiesDir)) continue;

    const files = fs.readdirSync(storiesDir).filter(f => /^S\d+[a-z]?.*\.md$/i.test(f));

    for (const file of files) {
      const key = extractIdKey(file, 'S');
      if (key === null) continue;

      const filePath = path.join(storiesDir, file);
      const idMatch = file.match(/^(S\d+[a-z]?)/i);
      const id = idMatch ? idMatch[1] : `S${key}`;

      const loaded = loadFile<Story>(filePath);

      if (_storyIndex.has(key)) {
        duplicates.push({ key, existing: _storyIndex.get(key).file, new: filePath });
      }

      _storyIndex.set(key, {
        key,
        id,
        file: filePath,
        prdDir,
        data: loaded?.data || {}
      });
    }
  }

  if (duplicates.length > 0) {
    console.error(`⚠ Duplicate story IDs found:`);
    for (const d of duplicates) {
      console.error(`  S${d.key}: ${d.existing} vs ${d.new}`);
    }
  }

  return _storyIndex;
}

/**
 * Build memory file index
 */
export function buildMemoryIndex(): Map<string, { key: string; type: 'epic' | 'prd'; file: string }> {
  if (_memoryIndex) return _memoryIndex;

  _memoryIndex = new Map();
  const memDir = getMemoryDir();

  if (!fs.existsSync(memDir)) return _memoryIndex;

  const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    const filePath = path.join(memDir, file);

    const epicMatch = file.match(/^E0*(\d+)([a-z])?\.md$/i);
    if (epicMatch) {
      const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
      _memoryIndex.set(key, { key, type: 'epic', file: filePath });
      continue;
    }

    const prdMatch = file.match(/^PRD-0*(\d+)\.md$/i);
    if (prdMatch) {
      const key = 'PRD-' + prdMatch[1];
      _memoryIndex.set(key, { key, type: 'prd', file: filePath });
    }
  }

  return _memoryIndex;
}

// ============================================================================
// GETTERS (single item)
// ============================================================================

/**
 * Get task by ID (any format: 39, "39", "39a", "T39", "T039", "T00039")
 */
export function getTask(taskId: string | number): TaskIndexEntry | null {
  const index = buildTaskIndex();

  let key: string | null;
  if (typeof taskId === 'number') {
    key = String(taskId);
  } else {
    const match = String(taskId).match(/^T?0*(\d+)([a-z])?$/i);
    if (match) {
      key = match[1] + (match[2] ? match[2].toLowerCase() : '');
    } else {
      key = null;
    }
  }

  if (key === null) return null;
  return index.get(key) || null;
}

/**
 * Get epic by ID (any format: 14, "14", "E14", "E014", "E0014")
 */
export function getEpic(epicId: string | number): EpicIndexEntry | null {
  const index = buildEpicIndex();

  let key: string | null;
  if (typeof epicId === 'number') {
    key = String(epicId);
  } else {
    const match = String(epicId).match(/^E?0*(\d+)([a-z])?$/i);
    if (match) {
      key = match[1] + (match[2] ? match[2].toLowerCase() : '');
    } else {
      key = null;
    }
  }

  if (key === null) return null;
  return index.get(key) || null;
}

/**
 * Get PRD by ID (any format: 1, "1", "PRD-1", "PRD-001")
 */
export function getPrd(prdId: string | number): PrdIndexEntry | null {
  const index = buildPrdIndex();

  let num: number | null;
  if (typeof prdId === 'number') {
    num = prdId;
  } else {
    const match = String(prdId).match(/^(?:PRD-?)?0*(\d+)$/i);
    num = match ? parseInt(match[1], 10) : null;
  }

  if (num === null) return null;
  return index.get(num) || null;
}

/**
 * Get story by ID (any format: 1, "1", "S1", "S001", "S0001")
 */
export function getStory(storyId: string | number): StoryIndexEntry | null {
  const index = buildStoryIndex();

  let key: string | null;
  if (typeof storyId === 'number') {
    key = String(storyId);
  } else {
    const match = String(storyId).match(/^S?0*(\d+)([a-z])?$/i);
    if (match) {
      key = match[1] + (match[2] ? match[2].toLowerCase() : '');
    } else {
      key = null;
    }
  }

  if (key === null) return null;
  return index.get(key) || null;
}

/**
 * Get memory file by ID
 */
export function getMemoryFile(id: string | number) {
  const index = buildMemoryIndex();

  const epicMatch = String(id).match(/^E0*(\d+)([a-z])?$/i);
  if (epicMatch) {
    const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
    return index.get(key) || null;
  }

  const prdMatch = String(id).match(/^PRD-?0*(\d+)$/i);
  if (prdMatch) {
    const key = 'PRD-' + prdMatch[1];
    return index.get(key) || null;
  }

  return null;
}

// ============================================================================
// QUERY OPTIONS
// ============================================================================

export interface TaskQueryOptions {
  prdDir?: string;
  epicId?: string;
  status?: string | string[];
}

export interface EpicQueryOptions {
  prdDir?: string;
  status?: string | string[];
}

export interface StoryQueryOptions {
  prdDir?: string;
  type?: 'user' | 'technical' | 'api';
}

// ============================================================================
// QUERY FUNCTIONS (collections)
// ============================================================================

/**
 * Get all tasks matching optional filters
 */
export function getAllTasks(options: TaskQueryOptions = {}): TaskIndexEntry[] {
  const index = buildTaskIndex();
  let tasks = [...index.values()];

  if (options.prdDir) {
    tasks = tasks.filter(t => t.prdDir === options.prdDir);
  }

  if (options.epicId) {
    const epicKey = String(options.epicId).replace(/^E0*/i, '').toLowerCase();
    tasks = tasks.filter(t => {
      const parent = t.data?.parent || '';
      const match = parent.match(/E0*(\d+)([a-z])?/i);
      if (!match) return false;
      const taskEpicKey = match[1] + (match[2] ? match[2].toLowerCase() : '');
      return taskEpicKey === epicKey;
    });
  }

  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    tasks = tasks.filter(t => statuses.includes(t.data?.status));
  }

  return tasks;
}

/**
 * Get all epics matching optional filters
 */
export function getAllEpics(options: EpicQueryOptions = {}): EpicIndexEntry[] {
  const index = buildEpicIndex();
  let epics = [...index.values()];

  if (options.prdDir) {
    epics = epics.filter(e => e.prdDir === options.prdDir);
  }

  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    epics = epics.filter(e => statuses.includes(e.data?.status));
  }

  return epics;
}

/**
 * Get all stories matching optional filters
 */
export function getAllStories(options: StoryQueryOptions = {}): StoryIndexEntry[] {
  const index = buildStoryIndex();
  let stories = [...index.values()];

  if (options.prdDir) {
    stories = stories.filter(s => s.prdDir === options.prdDir);
  }

  if (options.type) {
    stories = stories.filter(s => s.data?.type === options.type);
  }

  return stories;
}

/**
 * Get all PRD entries
 */
export function getAllPrds(): PrdIndexEntry[] {
  const index = buildPrdIndex();
  return [...index.values()].sort((a, b) => a.num - b.num);
}

// ============================================================================
// RELATIONSHIP QUERIES
// ============================================================================

/**
 * Get all tasks for a specific epic
 */
export function getTasksForEpic(epicId: string | number): TaskIndexEntry[] {
  return getAllTasks({ epicId: String(epicId) });
}

/**
 * Get all epics for a specific PRD
 */
export function getEpicsForPrd(prdId: string | number): EpicIndexEntry[] {
  const prd = getPrd(prdId);
  if (!prd) return [];
  return getAllEpics({ prdDir: prd.dir });
}

/**
 * Get all tasks for a specific PRD
 */
export function getTasksForPrd(prdId: string | number): TaskIndexEntry[] {
  const prd = getPrd(prdId);
  if (!prd) return [];
  return getAllTasks({ prdDir: prd.dir });
}

/**
 * Get all stories for a specific PRD
 */
export function getStoriesForPrd(prdId: string | number): StoryIndexEntry[] {
  const prd = getPrd(prdId);
  if (!prd) return [];
  return getAllStories({ prdDir: prd.dir });
}

/**
 * Get parent epic for a task
 */
export function getTaskEpic(taskId: string | number) {
  const task = getTask(taskId);
  if (!task) return null;

  const parent = task.data?.parent;
  if (!parent) return null;

  const epicMatch = parent.match(/E0*(\d+)([a-z])?/i);
  if (!epicMatch) return null;

  const epicKey = epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
  const epic = getEpic(epicKey);

  return {
    epicId: epic?.id || `E${epicKey}`,
    epicKey,
    title: task.data?.title || `Task ${taskId}`
  };
}

/**
 * Get parent PRD for an epic
 */
export function getEpicPrd(epicId: string | number) {
  const epic = getEpic(epicId);
  if (!epic) return null;

  const dirname = path.basename(epic.prdDir);
  const match = dirname.match(/^PRD-0*(\d+)/i);
  if (!match) return null;

  const prdNum = parseInt(match[1], 10);
  const prd = getPrd(prdNum);

  return {
    prdId: prd?.id || `PRD-${prdNum}`,
    prdNum
  };
}

// ============================================================================
// COUNT HELPERS
// ============================================================================

export function countTasks(options: TaskQueryOptions = {}): number {
  return getAllTasks(options).length;
}

export function countEpics(options: EpicQueryOptions = {}): number {
  return getAllEpics(options).length;
}

export function countStories(options: StoryQueryOptions = {}): number {
  return getAllStories(options).length;
}

// ============================================================================
// FULL PRD (with hierarchy)
// ============================================================================

/**
 * Get a fully populated PRD with all its epics and tasks
 */
export function getFullPrd(prdId: string | number): FullPrd | null {
  const prdEntry = getPrd(prdId);
  if (!prdEntry) return null;

  const epicIndex = buildEpicIndex();
  const taskIndex = buildTaskIndex();
  const prdDir = prdEntry.dir;

  const prdLoaded = loadFile(prdEntry.file);

  const epics: FullEpic[] = [];
  let totalTasks = 0;
  let doneTasks = 0;

  for (const [, epic] of epicIndex) {
    if (epic.prdDir !== prdDir) continue;

    const epicId = epic.data?.id || `E${epic.key}`;
    const tasks: FullTask[] = [];

    for (const [, task] of taskIndex) {
      if (task.prdDir !== prdDir) continue;

      const taskParent = task.data?.parent || '';
      const taskEpicId = extractEpicId(taskParent);

      if (taskEpicId === epicId || taskEpicId === `E${epic.key}` ||
          (taskEpicId && epic.key === taskEpicId.replace(/^E0*/, ''))) {
        const taskLoaded = loadFile(task.file);
        tasks.push({
          id: task.data?.id || `T${task.key}`,
          title: task.data?.title || 'Untitled',
          status: task.data?.status || 'Draft',
          description: taskLoaded?.body || '',
          meta: task.data || {}
        });
        totalTasks++;
        if (task.data?.status === 'Done') doneTasks++;
      }
    }

    tasks.sort((a, b) => a.id.localeCompare(b.id));

    const epicLoaded = loadFile(epic.file);
    epics.push({
      id: epicId,
      title: epic.data?.title || 'Untitled',
      status: epic.data?.status || 'Draft',
      description: epicLoaded?.body || '',
      meta: epic.data || {},
      tasks
    });
  }

  epics.sort((a, b) => a.id.localeCompare(b.id));

  return {
    id: prdEntry.data?.id || prdEntry.id,
    title: prdEntry.data?.title || 'Untitled',
    status: prdEntry.data?.status || 'Draft',
    description: prdLoaded?.body || '',
    meta: prdEntry.data || {},
    epics,
    totalTasks,
    doneTasks,
    progress: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
  };
}

/**
 * Get all PRDs fully populated
 */
export function getAllFullPrds(): FullPrd[] {
  const prdIndex = buildPrdIndex();
  const prds: FullPrd[] = [];

  for (const [num] of prdIndex) {
    const prd = getFullPrd(num);
    if (prd) prds.push(prd);
  }

  prds.sort((a, b) => a.id.localeCompare(b.id));
  return prds;
}

// ============================================================================
// Story and PRD Utilities (merged from lib/entities.ts)
// ============================================================================

/**
 * Find story file by ID
 * @param storyId - Story ID (e.g., S001)
 * @returns Absolute path to story file or null
 */
export function findStoryFile(storyId: string): string | null {
  const normalized = normalizeId(storyId);
  if (!normalized) return null;

  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return null;

  for (const prdDir of fs.readdirSync(prdsDir)) {
    const storiesDir = path.join(prdsDir, prdDir, 'stories');
    if (!fs.existsSync(storiesDir)) continue;

    for (const file of fs.readdirSync(storiesDir)) {
      if (file.startsWith(normalized + '-') && file.endsWith('.md')) {
        return path.join(storiesDir, file);
      }
    }
  }
  return null;
}

/**
 * Get PRD branching strategy
 * @param prdId - PRD ID
 * @returns 'flat' | 'prd' | 'epic'
 */
export function getPrdBranching(prdId: string | number): string {
  const prd = getPrd(prdId);
  if (!prd) return 'flat';

  return prd.data?.branching || 'flat';
}

// Re-export types for convenience
export type { TaskIndexEntry, EpicIndexEntry, PrdIndexEntry, StoryIndexEntry };
