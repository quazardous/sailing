/**
 * Entity Resolution
 *
 * Centralized functions for finding PRD/Epic/Task/Story files.
 * Single source of truth for entity path resolution.
 */
import fs from 'fs';
import path from 'path';
import { getPrdsDir, getMemoryDir, loadFile } from './core.js';

/**
 * Find task file by ID
 * @param {string} taskId - Task ID (e.g., T042)
 * @returns {string|null} Absolute path to task file or null
 */
export function findTaskFile(taskId) {
  taskId = normalizeId(taskId, 'T');
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return null;

  for (const prdDir of fs.readdirSync(prdsDir)) {
    const tasksDir = path.join(prdsDir, prdDir, 'tasks');
    if (!fs.existsSync(tasksDir)) continue;

    for (const file of fs.readdirSync(tasksDir)) {
      if (file.startsWith(taskId + '-') && file.endsWith('.md')) {
        return path.join(tasksDir, file);
      }
    }
  }
  return null;
}

/**
 * Find epic file by ID
 * @param {string} epicId - Epic ID (e.g., E001)
 * @returns {string|null} Absolute path to epic file or null
 */
export function findEpicFile(epicId) {
  epicId = normalizeId(epicId, 'E');
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return null;

  for (const prdDir of fs.readdirSync(prdsDir)) {
    const epicsDir = path.join(prdsDir, prdDir, 'epics');
    if (!fs.existsSync(epicsDir)) continue;

    for (const file of fs.readdirSync(epicsDir)) {
      if (file.startsWith(epicId + '-') && file.endsWith('.md')) {
        return path.join(epicsDir, file);
      }
    }
  }
  return null;
}

/**
 * Find PRD file by ID
 * @param {string} prdId - PRD ID (e.g., PRD-001)
 * @returns {string|null} Absolute path to prd.md or null
 */
export function findPrdFile(prdId) {
  prdId = normalizeId(prdId, 'PRD-');
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return null;

  for (const prdDir of fs.readdirSync(prdsDir)) {
    if (prdDir.startsWith(prdId + '-') || prdDir === prdId) {
      const prdFile = path.join(prdsDir, prdDir, 'prd.md');
      if (fs.existsSync(prdFile)) return prdFile;
    }
  }
  return null;
}

/**
 * Find story file by ID
 * @param {string} storyId - Story ID (e.g., S001)
 * @returns {string|null} Absolute path to story file or null
 */
export function findStoryFile(storyId) {
  storyId = normalizeId(storyId, 'S');
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return null;

  for (const prdDir of fs.readdirSync(prdsDir)) {
    const storiesDir = path.join(prdsDir, prdDir, 'stories');
    if (!fs.existsSync(storiesDir)) continue;

    for (const file of fs.readdirSync(storiesDir)) {
      if (file.startsWith(storyId + '-') && file.endsWith('.md')) {
        return path.join(storiesDir, file);
      }
    }
  }
  return null;
}

/**
 * Find memory file for epic
 * @param {string} epicId - Epic ID
 * @returns {string|null} Absolute path to memory file or null
 */
export function findMemoryFile(epicId) {
  epicId = normalizeId(epicId, 'E');
  const memoryPath = path.join(getMemoryDir(), `${epicId}.md`);
  return fs.existsSync(memoryPath) ? memoryPath : null;
}

/**
 * Extract PRD ID from parent field
 * @param {string} parent - Parent field (e.g., "PRD-001 / E002")
 * @returns {string|null} PRD ID or null
 */
export function extractPrdId(parent) {
  if (!parent) return null;
  const match = parent.match(/PRD-\d+/);
  return match ? match[0] : null;
}

/**
 * Extract Epic ID from parent field
 * @param {string} parent - Parent field (e.g., "PRD-001 / E002")
 * @returns {string|null} Epic ID or null
 */
export function extractEpicId(parent) {
  if (!parent) return null;
  const match = parent.match(/E\d+/);
  return match ? match[0] : null;
}

/**
 * Extract Task ID from string
 * @param {string} str - String containing task ID
 * @returns {string|null} Task ID or null
 */
export function extractTaskId(str) {
  if (!str) return null;
  const match = str.match(/T\d+/);
  return match ? match[0] : null;
}

/**
 * Normalize entity ID
 * @param {string} id - Raw ID
 * @param {string} prefix - Expected prefix (T, E, S, PRD-)
 * @returns {string} Normalized ID
 */
export function normalizeId(id, prefix) {
  if (!id) return id;
  id = id.toUpperCase();
  if (!id.startsWith(prefix)) {
    id = prefix + id;
  }
  return id;
}

/**
 * Get PRD branching strategy
 * @param {string} prdId - PRD ID
 * @returns {string} 'flat' | 'prd' | 'epic'
 */
export function getPrdBranching(prdId) {
  const prdFile = findPrdFile(prdId);
  if (!prdFile) return 'flat';

  const prd = loadFile(prdFile);
  if (!prd || !prd.data) return 'flat';

  return prd.data.branching || 'flat';
}

/**
 * Get parent info for a task
 * @param {string} taskId - Task ID
 * @returns {{ prdId: string|null, epicId: string|null, taskFile: string|null }}
 */
export function getTaskParentInfo(taskId) {
  const taskFile = findTaskFile(taskId);
  if (!taskFile) return { prdId: null, epicId: null, taskFile: null };

  const task = loadFile(taskFile);
  if (!task || !task.data) return { prdId: null, epicId: null, taskFile };

  return {
    prdId: extractPrdId(task.data.parent),
    epicId: extractEpicId(task.data.parent),
    taskFile
  };
}

/**
 * Find DEV.md file (check project root and common locations)
 * @param {string} projectRoot - Project root path
 * @returns {string|null} Path to DEV.md or null
 */
export function findDevMd(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'DEV.md'),
    path.join(projectRoot, 'DEVELOPMENT.md'),
    path.join(projectRoot, 'docs', 'DEV.md'),
    path.join(projectRoot, 'docs', 'DEVELOPMENT.md')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find TOOLSET.md file
 * @param {string} projectRoot - Project root path
 * @returns {string|null} Path to TOOLSET.md or null
 */
export function findToolset(projectRoot) {
  const candidates = [
    path.join(projectRoot, '.claude', 'TOOLSET.md'),
    path.join(projectRoot, 'TOOLSET.md')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find PRD directory containing an epic
 * @param {string} epicId - Epic ID (e.g., E0076)
 * @returns {{ prdDir: string, epicFile: string, prdId: string } | null}
 */
export function findEpicParent(epicId) {
  epicId = normalizeId(epicId, 'E');
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return null;

  for (const prdDir of fs.readdirSync(prdsDir)) {
    const prdPath = path.join(prdsDir, prdDir);
    const epicsDir = path.join(prdPath, 'epics');
    if (!fs.existsSync(epicsDir)) continue;

    for (const file of fs.readdirSync(epicsDir)) {
      if (file.startsWith(epicId + '-') && file.endsWith('.md')) {
        const prdId = prdDir.match(/^PRD-\d+/)?.[0] || prdDir.split('-').slice(0, 2).join('-');
        return {
          prdDir: prdPath,
          epicFile: path.join(epicsDir, file),
          prdId
        };
      }
    }
  }
  return null;
}
