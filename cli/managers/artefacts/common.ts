/**
 * Common artefact utilities - cache and shared operations
 */
import { loadFile, saveFile } from '../core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { parseMultiSectionContent, editArtifact } from '../../lib/artifact.js';
import type {
  TaskIndexEntry,
  EpicIndexEntry,
  PrdIndexEntry,
  StoryIndexEntry
} from '../../lib/types/entities.js';

// ============================================================================
// CACHE
// ============================================================================

export let _taskIndex: Map<string, TaskIndexEntry> | null = null;
export let _epicIndex: Map<string, EpicIndexEntry> | null = null;
export let _prdIndex: Map<number, PrdIndexEntry> | null = null;
export let _storyIndex: Map<string, StoryIndexEntry> | null = null;
export let _memoryIndex: Map<string, { key: string; type: 'epic' | 'prd'; file: string }> | null = null;
export let _logIndex: Map<string, { key: string; type: 'epic' | 'task'; file: string }> | null = null;

/**
 * Clear all caches (call after artefact changes)
 */
export function clearCache() {
  _taskIndex = null;
  _epicIndex = null;
  _prdIndex = null;
  _storyIndex = null;
  _memoryIndex = null;
  _logIndex = null;
}

export function setTaskIndex(index: Map<string, TaskIndexEntry>) { _taskIndex = index; }
export function setEpicIndex(index: Map<string, EpicIndexEntry>) { _epicIndex = index; }
export function setPrdIndex(index: Map<number, PrdIndexEntry>) { _prdIndex = index; }
export function setStoryIndex(index: Map<string, StoryIndexEntry>) { _storyIndex = index; }
export function setMemoryIndex(index: Map<string, { key: string; type: 'epic' | 'prd'; file: string }>) { _memoryIndex = index; }
export function setLogIndex(index: Map<string, { key: string; type: 'epic' | 'task'; file: string }>) { _logIndex = index; }

// ============================================================================
// UPDATE FUNCTIONS (shared across types)
// ============================================================================

export interface UpdateArtefactOptions {
  status?: string;
  title?: string;
  assignee?: string;
  effort?: string;
  priority?: string;
  set?: Record<string, unknown>;
}

export interface UpdateArtefactResult {
  id: string;
  updated: boolean;
  data: Record<string, unknown>;
}

// Lazy imports to avoid circular dependencies
let _getTask: ((id: string | number) => TaskIndexEntry | null) | null = null;
let _getEpic: ((id: string | number) => EpicIndexEntry | null) | null = null;
let _getPrd: ((id: string | number) => PrdIndexEntry | null) | null = null;
let _getStory: ((id: string | number) => StoryIndexEntry | null) | null = null;

export function setGetters(
  getTask: (id: string | number) => TaskIndexEntry | null,
  getEpic: (id: string | number) => EpicIndexEntry | null,
  getPrd: (id: string | number) => PrdIndexEntry | null,
  getStory: (id: string | number) => StoryIndexEntry | null
) {
  _getTask = getTask;
  _getEpic = getEpic;
  _getPrd = getPrd;
  _getStory = getStory;
}

/**
 * Update artefact frontmatter
 */
export function updateArtefact(id: string, options: UpdateArtefactOptions): UpdateArtefactResult {
  if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
    throw new Error('Getters not initialized. Call setGetters first.');
  }

  const normalized = normalizeId(id);
  let entry: { file: string; data: Record<string, unknown> } | null = null;

  if (normalized.startsWith('T')) {
    const task = _getTask(normalized);
    if (task) entry = { file: task.file, data: task.data || {} };
  } else if (normalized.startsWith('E')) {
    const epic = _getEpic(normalized);
    if (epic) entry = { file: epic.file, data: epic.data || {} };
  } else if (normalized.startsWith('PRD-')) {
    const prd = _getPrd(normalized);
    if (prd) entry = { file: prd.file, data: prd.data || {} };
  } else if (normalized.startsWith('S')) {
    const story = _getStory(normalized);
    if (story) entry = { file: story.file, data: story.data || {} };
  }

  if (!entry) {
    throw new Error(`Artefact not found: ${id}`);
  }

  const file = loadFile(entry.file);
  if (!file) {
    throw new Error(`Could not load file: ${entry.file}`);
  }

  const data = { ...file.data } as Record<string, unknown>;
  let updated = false;

  if (options.status !== undefined) {
    data.status = options.status;
    updated = true;
  }
  if (options.title !== undefined) {
    data.title = options.title;
    updated = true;
  }
  if (options.assignee !== undefined) {
    data.assignee = options.assignee;
    updated = true;
  }
  if (options.effort !== undefined) {
    data.effort = options.effort;
    updated = true;
  }
  if (options.priority !== undefined) {
    data.priority = options.priority;
    updated = true;
  }
  if (options.set) {
    for (const [k, v] of Object.entries(options.set)) {
      data[k] = v;
      updated = true;
    }
  }

  if (updated) {
    saveFile(entry.file, data, file.body);
    clearCache();
  }

  return { id: normalized, updated, data };
}

/**
 * Get artefact body (markdown content without frontmatter)
 */
export function getArtefactBody(id: string): string | null {
  if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
    throw new Error('Getters not initialized. Call setGetters first.');
  }

  const normalized = normalizeId(id);
  let filePath: string | null = null;

  if (normalized.startsWith('T')) {
    const task = _getTask(normalized);
    if (task) filePath = task.file;
  } else if (normalized.startsWith('E')) {
    const epic = _getEpic(normalized);
    if (epic) filePath = epic.file;
  } else if (normalized.startsWith('PRD-')) {
    const prd = _getPrd(normalized);
    if (prd) filePath = prd.file;
  } else if (normalized.startsWith('S')) {
    const story = _getStory(normalized);
    if (story) filePath = story.file;
  }

  if (!filePath) {
    return null;
  }

  const file = loadFile(filePath);
  return file?.body || null;
}

// ============================================================================
// EDIT FUNCTIONS (shared across types)
// ============================================================================

export interface EditSectionOptions {
  mode?: 'replace' | 'append' | 'prepend';
}

export interface EditSectionResult {
  id: string;
  section: string;
  updated: boolean;
}

/**
 * Edit a section in artefact body
 */
export function editArtefactSection(id: string, section: string, content: string, options: EditSectionOptions = {}): EditSectionResult {
  if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
    throw new Error('Getters not initialized. Call setGetters first.');
  }

  const normalized = normalizeId(id);
  let filePath: string | null = null;

  if (normalized.startsWith('T')) {
    const task = _getTask(normalized);
    if (task) filePath = task.file;
  } else if (normalized.startsWith('E')) {
    const epic = _getEpic(normalized);
    if (epic) filePath = epic.file;
  } else if (normalized.startsWith('PRD-')) {
    const prd = _getPrd(normalized);
    if (prd) filePath = prd.file;
  } else if (normalized.startsWith('S')) {
    const story = _getStory(normalized);
    if (story) filePath = story.file;
  }

  if (!filePath) {
    throw new Error(`Artefact not found: ${id}`);
  }

  const file = loadFile(filePath);
  if (!file) {
    throw new Error(`Could not load file: ${filePath}`);
  }

  const mode = options.mode || 'replace';
  let body = file.body;
  const sectionHeader = `## ${section}`;
  const sectionRegex = new RegExp(`(## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})([\\s\\S]*?)(?=\\n## |$)`, 'i');

  const match = body.match(sectionRegex);

  if (match) {
    const existingContent = match[2];
    let newSectionContent: string;

    if (mode === 'append') {
      newSectionContent = existingContent.trimEnd() + '\n\n' + content;
    } else if (mode === 'prepend') {
      newSectionContent = '\n\n' + content + existingContent;
    } else {
      newSectionContent = '\n\n' + content + '\n';
    }

    body = body.replace(sectionRegex, `${sectionHeader}${newSectionContent}`);
  } else {
    body = body.trimEnd() + `\n\n${sectionHeader}\n\n${content}\n`;
  }

  saveFile(filePath, file.data, body);
  clearCache();

  return { id: normalized, section, updated: true };
}

export interface EditMultiSectionResult {
  id: string;
  sections: string[];
  updated: boolean;
}

/**
 * Edit multiple sections in artefact body using ## header format
 */
export function editArtefactMultiSection(id: string, content: string, defaultOp: 'replace' | 'append' | 'prepend' = 'replace'): EditMultiSectionResult {
  if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
    throw new Error('Getters not initialized. Call setGetters first.');
  }

  const normalized = normalizeId(id);
  let filePath: string | null = null;

  if (normalized.startsWith('T')) {
    const task = _getTask(normalized);
    if (task) filePath = task.file;
  } else if (normalized.startsWith('E')) {
    const epic = _getEpic(normalized);
    if (epic) filePath = epic.file;
  } else if (normalized.startsWith('PRD-')) {
    const prd = _getPrd(normalized);
    if (prd) filePath = prd.file;
  } else if (normalized.startsWith('S')) {
    const story = _getStory(normalized);
    if (story) filePath = story.file;
  }

  if (!filePath) {
    throw new Error(`Artefact not found: ${id}`);
  }

  const ops = parseMultiSectionContent(content, defaultOp);

  if (ops.length === 0) {
    throw new Error('No sections found in content. Use ## Section format.');
  }

  const result = editArtifact(filePath, ops);

  if (!result.success) {
    throw new Error(result.errors?.join(', ') || 'Edit failed');
  }

  clearCache();

  return {
    id: normalized,
    sections: ops.map(op => op.section),
    updated: true
  };
}
