/**
 * Artefacts Manager - Unified export
 *
 * This module re-exports all artefact operations from domain-specific modules.
 * Commands should import from here, NOT from individual modules.
 */
// Common operations
export { clearCache, updateArtefact, getArtefactBody, editArtefactSection, editArtefactMultiSection, addArtefactDependency, setGetters } from './common.js';
// Task operations
export { buildTaskIndex, getTask, getAllTasks, getTasksForEpic, getTaskEpic, countTasks, createTask, addTaskDependency } from './task.js';
// Epic operations
export { buildEpicIndex, getEpic, getAllEpics, getEpicsForPrd, getEpicPrd, countEpics, createEpic } from './epic.js';
// PRD operations
export { buildPrdIndex, getPrd, prdIdFromDir, getAllPrds, getPrdBranching, getFullPrd, getAllFullPrds, createPrd } from './prd.js';
// Story operations
export { buildStoryIndex, getStory, getAllStories, getStoriesForPrd, countStories, findStoryFile, createStory } from './story.js';
// Memory operations
export { buildMemoryIndex, getMemoryFile, buildLogIndex, getLogFile, invalidateLogIndex } from './memory.js';
// Relationship queries that span multiple types
import { getPrd } from './prd.js';
import { getAllTasks } from './task.js';
import { normalizeId, matchesPrd as matchesPrdLib } from '../../lib/normalize.js';
/**
 * Match PRD ID (handles format variations: PRD-1, PRD-001, 1)
 */
export function matchesPrd(prdId, filter) {
    if (!prdId || !filter)
        return false;
    return matchesPrdLib(prdId, filter);
}
/**
 * Match epic ID (handles format variations: E1, E001, E01)
 */
export function matchesEpic(epicId, filter) {
    if (!epicId || !filter)
        return false;
    return normalizeId(epicId) === normalizeId(filter);
}
/**
 * Get all tasks for a specific PRD
 */
export function getTasksForPrd(prdId) {
    const prd = getPrd(prdId);
    if (!prd)
        return [];
    return getAllTasks({ prdDir: prd.dir });
}
// Initialize getters for common.ts (needed for update/edit functions)
import { setGetters } from './common.js';
import { getTask } from './task.js';
import { getEpic } from './epic.js';
import { getStory } from './story.js';
// Auto-initialize on import
setGetters(getTask, getEpic, getPrd, getStory);
