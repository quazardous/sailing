/**
 * Story Operations - High-level story operations shared by CLI and MCP
 */
import { normalizeId } from '../lib/normalize.js';
import { getAllStories, getAllEpics, getAllTasks, getPrd } from '../managers/artefacts/index.js';

// ============================================================================
// TYPES
// ============================================================================

export interface OrphanStoriesOptions {
  prd?: string;
}

export interface OrphanStory {
  id: string;
  title: string;
  type: string;
  prd: string;
}

export interface OrphanStoriesResult {
  orphans: OrphanStory[];
  total: number;
}

export interface ValidationIssue {
  type: 'orphan' | 'invalid_parent';
  storyId: string;
  message: string;
}

export interface ValidateStoriesOptions {
  prd?: string;
}

export interface ValidateStoriesResult {
  valid: boolean;
  issues: ValidationIssue[];
  storyCount: number;
}

// ============================================================================
// HELPER: Get story references
// ============================================================================

interface StoryReferences {
  epics: Record<string, string[]>;
  tasks: Record<string, string[]>;
}

function getStoryReferences(): StoryReferences {
  const refs: StoryReferences = { epics: {}, tasks: {} };

  // Collect epic references
  for (const epicEntry of getAllEpics()) {
    const data = epicEntry.data;
    if (!data) continue;
    const stories = data.stories || [];
    stories.forEach((s: string) => {
      const sid = normalizeId(s);
      if (!refs.epics[sid]) refs.epics[sid] = [];
      refs.epics[sid].push(data.id);
    });
  }

  // Collect task references
  for (const taskEntry of getAllTasks()) {
    const data = taskEntry.data;
    if (!data) continue;
    const stories = data.stories || [];
    stories.forEach((s: string) => {
      const sid = normalizeId(s);
      if (!refs.tasks[sid]) refs.tasks[sid] = [];
      refs.tasks[sid].push(data.id);
    });
  }

  return refs;
}

// ============================================================================
// HELPER: Get all stories with PRD info
// ============================================================================

interface StoryWithPrd {
  id: string;
  title: string;
  type: string;
  prd: string;
  parent_story?: string | null;
}

function getStoriesWithPrd(prdFilter?: string): StoryWithPrd[] {
  let storyEntries = getAllStories();

  if (prdFilter) {
    const prd = getPrd(prdFilter);
    if (prd) {
      storyEntries = storyEntries.filter(s => s.prdId === prd.id);
    } else {
      // Fallback: try normalized ID match or substring match
      const normalizedFilter = normalizeId(prdFilter);
      storyEntries = storyEntries.filter(s =>
        s.prdId === normalizedFilter ||
        s.prdId.toLowerCase().includes(prdFilter.toLowerCase())
      );
    }
  }

  return storyEntries.map(entry => ({
    id: entry.data?.id || entry.id,
    title: entry.data?.title || '',
    type: entry.data?.type || 'user',
    prd: entry.prdId,
    parent_story: entry.data?.parent_story || null
  }));
}

// ============================================================================
// GET ORPHAN STORIES
// ============================================================================

/**
 * Get orphan stories (not referenced by any task)
 */
export function getOrphanStories(options: OrphanStoriesOptions = {}): OrphanStoriesResult {
  const stories = getStoriesWithPrd(options.prd);
  const refs = getStoryReferences();

  const orphans: OrphanStory[] = [];

  for (const story of stories) {
    const storyId = normalizeId(story.id);
    const taskRefs = refs.tasks[storyId] || [];

    if (taskRefs.length === 0) {
      orphans.push({
        id: story.id,
        title: story.title,
        type: story.type,
        prd: story.prd
      });
    }
  }

  return { orphans, total: orphans.length };
}

// ============================================================================
// VALIDATE STORIES
// ============================================================================

/**
 * Validate stories (check for orphans and invalid parent references)
 */
export function validateStories(options: ValidateStoriesOptions = {}): ValidateStoriesResult {
  const stories = getStoriesWithPrd(options.prd);
  const refs = getStoryReferences();
  const issues: ValidationIssue[] = [];

  // Build story IDs set for parent validation
  const storyIds = new Set(stories.map(s => normalizeId(s.id)));

  for (const story of stories) {
    const storyId = normalizeId(story.id);

    // Check for orphan stories
    const taskRefs = refs.tasks[storyId] || [];
    if (taskRefs.length === 0) {
      issues.push({
        type: 'orphan',
        storyId: story.id,
        message: `Story ${story.id} has no task references`
      });
    }

    // Check for invalid parent_story references
    if (story.parent_story && !storyIds.has(normalizeId(story.parent_story))) {
      issues.push({
        type: 'invalid_parent',
        storyId: story.id,
        message: `Story ${story.id} references non-existent parent_story: ${story.parent_story}`
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    storyCount: stories.length
  };
}
