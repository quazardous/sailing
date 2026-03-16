/**
 * Barrel export for cli/lib — re-exports used by tests
 */
export { extractIdKey, extractNumericId } from './artefacts.js';
export { buildTaskIndex, buildEpicIndex, buildPrdIndex, buildMemoryIndex, getTask, getEpic, getPrd, getMemoryFile, getTaskEpic, getEpicPrd, clearCache as clearIndexCache } from '../managers/artefacts/index.js';
