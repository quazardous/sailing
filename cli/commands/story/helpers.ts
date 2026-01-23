/**
 * Story command helpers and types
 */
import path from 'path';
import { normalizeId, matchesPrdDir } from '../../lib/normalize.js';
import { getAllEpics, getAllTasks, getStory, getAllStories as getStoriesFromIndex, getPrd } from '../../managers/artefacts-manager.js';
import { Story } from '../../lib/types/entities.js';

export const STORY_TYPES = ['user', 'technical', 'api'];

// Types
export interface StoryListOptions {
  type?: string;
  limit?: number;
  prd?: string;
  path?: boolean;
  json?: boolean;
}

export interface StoryShowOptions {
  raw?: boolean;
  stripComments?: boolean;
  path?: boolean;
  json?: boolean;
}

export interface StoryCreateOptions {
  type: string;
  parentStory?: string;
  path?: boolean;
  json?: boolean;
}

export interface StoryUpdateOptions {
  type?: string;
  parentStory?: string;
  clearParent?: boolean;
  title?: string;
  set?: string[];
  json?: boolean;
}

export interface StoryTreeOptions {
  prd?: string;
}

export interface StoryRootsOptions {
  prd?: string;
  path?: boolean;
  json?: boolean;
}

export interface StoryLeavesOptions {
  prd?: string;
  path?: boolean;
  json?: boolean;
}

export interface StoryChildrenOptions {
  json?: boolean;
}

export interface StoryAncestorsOptions {
  json?: boolean;
}

export interface StoryOrphansOptions {
  prd?: string;
  path?: boolean;
  json?: boolean;
}

export interface StoryValidateOptions {
  prd?: string;
  json?: boolean;
}

export interface StoryBookOptions {
  prd?: string;
  epic?: string;
  task?: string;
  json?: boolean;
}

export interface StoryPatchOptions {
  file?: string;
  dryRun?: boolean;
  json?: boolean;
}

export interface StoryEditOptions {
  section?: string;
  content?: string;
  append?: boolean;
  prepend?: boolean;
  json?: boolean;
}

export interface StoryReference {
  [key: string]: string[];
}

export interface StoryReferences {
  epics: StoryReference;
  tasks: StoryReference;
}

export type StoryWithPrd = Story & { prd: string; file?: string };

/**
 * Find a story file by ID (uses artefacts.ts contract)
 */
export function findStoryFile(storyId: string): { file: string; prdDir: string } | null {
  const storyEntry = getStory(storyId);
  if (!storyEntry) return null;
  return { file: storyEntry.file, prdDir: storyEntry.prdDir };
}

/**
 * Get all stories across all PRDs (uses artefacts.ts contract)
 * @param prdFilter - Optional PRD filter
 * @param includePath - Include file paths in result (default: false for privacy)
 */
export function getAllStories(prdFilter: string | null = null, includePath = false): StoryWithPrd[] {
  // Get stories from artefacts index, optionally filter by PRD
  let storyEntries = getStoriesFromIndex();

  if (prdFilter) {
    const prd = getPrd(prdFilter);
    if (prd) {
      storyEntries = storyEntries.filter(s => s.prdDir === prd.dir);
    } else {
      // Fallback: filter by prdDir path containing prdFilter
      storyEntries = storyEntries.filter(s => matchesPrdDir(s.prdDir, prdFilter));
    }
  }

  return storyEntries.map(entry => {
    const prdName = path.basename(entry.prdDir);
    const storyEntry: StoryWithPrd = {
      id: entry.data?.id || entry.id,
      title: entry.data?.title || '',
      status: entry.data?.status || 'Draft',
      type: entry.data?.type || 'user',
      parent: entry.data?.parent || '',
      parent_story: entry.data?.parent_story || null,
      prd: prdName
    };
    if (includePath) storyEntry.file = entry.file;
    return storyEntry;
  });
}

/**
 * Get all epics and tasks with their story references
 */
export function getStoryReferences(): StoryReferences {
  const refs: StoryReferences = { epics: {}, tasks: {} };

  // Use artefacts.ts contract for epics
  for (const epicEntry of getAllEpics()) {
    const data = epicEntry.data;
    if (!data) continue;
    const stories = data.stories || [];
    stories.forEach(s => {
      const sid = normalizeId(s);
      if (!refs.epics[sid]) refs.epics[sid] = [];
      refs.epics[sid].push(data.id);
    });
  }

  // Use artefacts.ts contract for tasks
  for (const taskEntry of getAllTasks()) {
    const data = taskEntry.data;
    if (!data) continue;
    const stories = data.stories || [];
    stories.forEach(s => {
      const sid = normalizeId(s);
      if (!refs.tasks[sid]) refs.tasks[sid] = [];
      refs.tasks[sid].push(data.id);
    });
  }

  return refs;
}

/**
 * Build story tree structure
 */
export function buildStoryTree(stories: StoryWithPrd[]) {
  const byId = new Map<string, StoryWithPrd>();
  const roots: StoryWithPrd[] = [];
  const children = new Map<string, StoryWithPrd[]>();

  // Index by ID
  stories.forEach(s => {
    byId.set(normalizeId(s.id), s);
    children.set(normalizeId(s.id), []);
  });

  // Build parent-child relationships
  stories.forEach(s => {
    if (s.parent_story) {
      const parentId = normalizeId(s.parent_story);
      if (children.has(parentId)) {
        children.get(parentId)!.push(s);
      }
    } else {
      roots.push(s);
    }
  });

  return { byId, roots, children };
}
