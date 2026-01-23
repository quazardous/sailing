/**
 * Artefacts Manager - Unified export
 *
 * This module re-exports all artefact operations from domain-specific modules.
 * Commands should import from here, NOT from individual modules.
 */

// Common operations
export {
  clearCache,
  updateArtefact,
  getArtefactBody,
  editArtefactSection,
  editArtefactMultiSection,
  setGetters
} from './common.js';
export type {
  UpdateArtefactOptions,
  UpdateArtefactResult,
  EditSectionOptions,
  EditSectionResult,
  EditMultiSectionResult
} from './common.js';

// Task operations
export {
  buildTaskIndex,
  getTask,
  getAllTasks,
  getTasksForEpic,
  getTaskEpic,
  countTasks,
  createTask,
  addTaskDependency
} from './task.js';
export type { AddDependencyResult } from './task.js';
export type {
  TaskQueryOptions,
  CreateTaskOptions,
  CreateTaskResult
} from './task.js';

// Epic operations
export {
  buildEpicIndex,
  getEpic,
  getAllEpics,
  getEpicsForPrd,
  getEpicPrd,
  countEpics,
  createEpic
} from './epic.js';
export type {
  EpicQueryOptions,
  CreateEpicOptions,
  CreateEpicResult
} from './epic.js';

// PRD operations
export {
  buildPrdIndex,
  getPrd,
  prdIdFromDir,
  getAllPrds,
  getPrdBranching,
  getFullPrd,
  getAllFullPrds,
  createPrd
} from './prd.js';
export type {
  CreatePrdOptions,
  CreatePrdResult
} from './prd.js';

// Story operations
export {
  buildStoryIndex,
  getStory,
  getAllStories,
  getStoriesForPrd,
  countStories,
  findStoryFile,
  createStory
} from './story.js';
export type {
  StoryQueryOptions,
  CreateStoryOptions,
  CreateStoryResult
} from './story.js';

// Memory operations
export {
  buildMemoryIndex,
  getMemoryFile,
  buildLogIndex,
  getLogFile,
  invalidateLogIndex
} from './memory.js';

// Relationship queries that span multiple types
import { getPrd } from './prd.js';
import { getAllTasks } from './task.js';
import { getAllStories } from './story.js';
import type { TaskIndexEntry, StoryIndexEntry } from '../../lib/types/entities.js';

/**
 * Get all tasks for a specific PRD
 */
export function getTasksForPrd(prdId: string | number): TaskIndexEntry[] {
  const prd = getPrd(prdId);
  if (!prd) return [];
  return getAllTasks({ prdDir: prd.dir });
}

// Re-export types for convenience
export type {
  TaskIndexEntry,
  EpicIndexEntry,
  PrdIndexEntry,
  StoryIndexEntry,
  FullPrd,
  FullEpic,
  FullTask
} from '../../lib/types/entities.js';

// Initialize getters for common.ts (needed for update/edit functions)
import { setGetters } from './common.js';
import { getTask } from './task.js';
import { getEpic } from './epic.js';
import { getStory } from './story.js';

// Auto-initialize on import
setGetters(getTask, getEpic, getPrd, getStory);
