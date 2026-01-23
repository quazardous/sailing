/**
 * Artefact Operations - High-level artefact operations shared by CLI and MCP
 */
import { getTask, getEpic, getPrd, getStory, getArtefactBody } from '../managers/artefacts-manager.js';
import { normalizeId } from '../lib/normalize.js';
import type { TaskIndexEntry, EpicIndexEntry, PrdIndexEntry, StoryIndexEntry } from '../lib/types/entities.js';

// ============================================================================
// SHOW ARTEFACT
// ============================================================================

export type ArtefactType = 'task' | 'epic' | 'prd' | 'story' | 'unknown';

export interface ShowArtefactOptions {
  raw?: boolean;
}

export interface ShowArtefactResult {
  id: string;
  type: ArtefactType;
  exists: boolean;
  data?: Record<string, unknown>;
  body?: string;
}

/**
 * Detect artefact type from ID
 */
export function detectArtefactType(id: string): ArtefactType {
  const normalized = normalizeId(id);
  if (normalized.startsWith('T')) return 'task';
  if (normalized.startsWith('E')) return 'epic';
  if (normalized.startsWith('PRD-')) return 'prd';
  if (normalized.startsWith('S')) return 'story';
  return 'unknown';
}

/**
 * Show artefact details (task, epic, prd, story)
 */
export function showArtefact(id: string, options: ShowArtefactOptions = {}): ShowArtefactResult {
  const normalized = normalizeId(id);
  const type = detectArtefactType(normalized);

  if (type === 'unknown') {
    return { id: normalized, type, exists: false };
  }

  let entry: TaskIndexEntry | EpicIndexEntry | PrdIndexEntry | StoryIndexEntry | null = null;

  switch (type) {
    case 'task':
      entry = getTask(normalized);
      break;
    case 'epic':
      entry = getEpic(normalized);
      break;
    case 'prd':
      entry = getPrd(normalized);
      break;
    case 'story':
      entry = getStory(normalized);
      break;
  }

  if (!entry) {
    return { id: normalized, type, exists: false };
  }

  const result: ShowArtefactResult = {
    id: normalized,
    type,
    exists: true,
    data: entry.data as Record<string, unknown>
  };

  // Include raw body if requested
  if (options.raw) {
    const body = getArtefactBody(normalized);
    if (body) {
      result.body = body;
    }
  }

  return result;
}
