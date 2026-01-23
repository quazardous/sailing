/**
 * Task command helpers
 *
 * Shared utility functions for task subcommands.
 */
import { getTask, getEpic, getEpicPrd } from '../../managers/artefacts-manager.js';
import type { EpicParentInfo } from '../../lib/types/task-options.js';

/**
 * Find a task file by ID (format-agnostic via index.ts)
 */
export function findTaskFile(taskId: string): string | null {
  return getTask(taskId)?.file || null;
}

/**
 * Find PRD directory containing an epic (via index.ts)
 */
export function findEpicParent(epicId: string): EpicParentInfo | null {
  const epic = getEpic(epicId);
  if (!epic) return null;

  const prdInfo = getEpicPrd(epic.id);
  return {
    prdDir: epic.prdDir,
    epicFile: epic.file,
    prdId: prdInfo?.prdId || 'unknown'
  };
}
