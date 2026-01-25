/**
 * PRD artefact operations
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, getPrdsDir, toKebab, loadTemplate, formatId } from '../core-manager.js';
import { nextId } from '../state-manager.js';
import { createPrdMemoryFile } from '../memory-manager.js';
import { extractEpicId } from '../../lib/normalize.js';
import { _prdIndex, setPrdIndex, clearCache } from './common.js';
import { buildEpicIndex } from './epic.js';
import { buildTaskIndex } from './task.js';
import type {
  Prd,
  PrdIndexEntry,
  FullPrd,
  FullEpic,
  FullTask
} from '../../lib/types/entities.js';

// ============================================================================
// INDEX
// ============================================================================

/**
 * Build PRD index
 */
export function buildPrdIndex(): Map<number, PrdIndexEntry> {
  if (_prdIndex) return _prdIndex;

  const index = new Map<number, PrdIndexEntry>();
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

    if (index.has(num)) {
      duplicates.push({ num, existing: index.get(num)!.dir, new: prdDir });
    }

    index.set(num, {
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

  setPrdIndex(index);
  return index;
}

// ============================================================================
// GETTERS
// ============================================================================

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
 * Extract PRD ID from a prdDir path
 * E.g., "/path/to/PRD-001-my-project" → "PRD-001"
 */
export function prdIdFromDir(prdDir: string): string {
  const dirname = path.basename(prdDir);
  const match = dirname.match(/^(PRD-\d+)/i);
  return match ? match[1] : dirname;
}

// ============================================================================
// QUERY
// ============================================================================

/**
 * Get all PRD entries
 */
export function getAllPrds(): PrdIndexEntry[] {
  const index = buildPrdIndex();
  return [...index.values()].sort((a, b) => a.num - b.num);
}

/**
 * Get PRD branching strategy
 */
export function getPrdBranching(prdId: string | number): string {
  const prd = getPrd(prdId);
  if (!prd) return 'flat';

  return prd.data?.branching || 'flat';
}

// ============================================================================
// FULL PRD (with hierarchy) - Lazy imports to avoid circular deps
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
// CREATE
// ============================================================================

export interface CreatePrdOptions {
  tags?: string[];
}

export interface CreatePrdResult {
  id: string;
  title: string;
  dir: string;
  file: string;
}

/**
 * Create a new PRD
 */
export function createPrd(title: string, options: CreatePrdOptions = {}): CreatePrdResult {
  const num = nextId('prd');
  const id = formatId('PRD-', num);
  const dirName = `${id}-${toKebab(title)}`;
  const prdsDir = getPrdsDir();
  const prdDir = path.join(prdsDir, dirName);

  if (!fs.existsSync(prdsDir)) {
    fs.mkdirSync(prdsDir, { recursive: true });
  }

  fs.mkdirSync(prdDir);
  fs.mkdirSync(path.join(prdDir, 'epics'));
  fs.mkdirSync(path.join(prdDir, 'tasks'));

  const data: Prd = {
    id,
    title,
    status: 'Draft',
    parent: '',
    tags: options.tags?.map(t => toKebab(t)) || []
  };

  let body = loadTemplate('prd');
  if (body) {
    body = body.replace(/^---[\s\S]*?---\s*/, '');
  } else {
    body = `\n## Summary\n\n[Describe the problem]\n\n## Goals\n\n- [Goal 1]\n\n## Non-Goals\n\n- [Non-goal 1]\n\n## Technical Approach\n\n[High-level approach]\n`;
  }

  const prdFile = path.join(prdDir, 'prd.md');
  saveFile(prdFile, data, body);
  createPrdMemoryFile(id);
  clearCache();

  return { id, title, dir: prdDir, file: prdFile };
}
