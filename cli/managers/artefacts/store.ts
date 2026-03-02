/**
 * ArtefactStore — unified interface for all artefact operations.
 *
 * Abstracts storage backend so consumers don't depend on filesystem layout.
 * Current implementation: FileArtefactStore (file-store.ts).
 * Future: DB or API backends can implement this same interface.
 */
import type {
  TaskIndexEntry,
  EpicIndexEntry,
  PrdIndexEntry,
  StoryIndexEntry,
  ArchiveEntry,
  FullPrd
} from '../../lib/types/entities.js';
import type { TaskQueryOptions, CreateTaskOptions, CreateTaskResult } from './task.js';
import type { EpicQueryOptions, CreateEpicOptions, CreateEpicResult } from './epic.js';
import type { CreatePrdOptions, CreatePrdResult } from './prd.js';
import type { StoryQueryOptions, CreateStoryOptions, CreateStoryResult } from './story.js';
import type { ArchiveQueryOptions } from './archive.js';
import type { SearchOptions, SearchHit } from './search.js';
import type {
  UpdateArtefactOptions,
  UpdateArtefactResult,
  TouchArtefactResult,
  EditSectionOptions,
  EditSectionResult,
  EditMultiSectionResult,
  PatchArtefactResult,
  AddDependencyResult as ArtefactDependencyResult
} from './common.js';
import type { AddDependencyResult as TaskDependencyResult } from './task.js';

// ============================================================================
// READ-ONLY SUBSET
// ============================================================================

export interface ArtefactReadStore {
  // Single lookups
  getTask(id: string | number): TaskIndexEntry | null;
  getEpic(id: string | number): EpicIndexEntry | null;
  getPrd(id: string | number): PrdIndexEntry | null;
  getStory(id: string | number): StoryIndexEntry | null;
  getArchivedArtefact(id: string): ArchiveEntry | null;

  // List queries
  getAllTasks(opts?: TaskQueryOptions): TaskIndexEntry[];
  getAllEpics(opts?: EpicQueryOptions): EpicIndexEntry[];
  getAllPrds(): PrdIndexEntry[];
  getAllStories(opts?: StoryQueryOptions): StoryIndexEntry[];
  getAllArchivedTasks(opts?: ArchiveQueryOptions): ArchiveEntry[];
  getAllArchivedEpics(opts?: ArchiveQueryOptions): ArchiveEntry[];
  getAllArchivedPrds(): ArchiveEntry[];
  getAllArchivedArtefacts(opts?: ArchiveQueryOptions & { type?: 'task' | 'epic' | 'prd' }): ArchiveEntry[];

  // Search
  search(query: string, options?: SearchOptions): SearchHit[];

  // File access (needed for body/section reads)
  loadFile(filePath: string): { data: Record<string, unknown>; body: string } | null;
}

// ============================================================================
// FULL STORE (read + write)
// ============================================================================

export interface ArtefactStore extends ArtefactReadStore {
  // Relationship queries
  getTasksForEpic(epicId: string | number): TaskIndexEntry[];
  getTaskEpic(taskId: string | number): { epicId: string; epicKey: string; title: string } | null;
  getEpicsForPrd(prdId: string | number): EpicIndexEntry[];
  getEpicPrd(epicId: string | number): { prdId: string; prdNum: number } | null;
  getStoriesForPrd(prdId: string | number): StoryIndexEntry[];
  getTasksForPrd(prdId: string | number): TaskIndexEntry[];

  // Counts
  countTasks(opts?: TaskQueryOptions): number;
  countEpics(opts?: EpicQueryOptions): number;
  countStories(opts?: StoryQueryOptions): number;

  // Full entity views
  getFullPrd(prdId: string | number): FullPrd | null;
  getAllFullPrds(): FullPrd[];

  // PRD utilities
  getPrdBranching(prdId: string | number): string;

  // Body access
  getArtefactBody(id: string): string | null;

  // Create
  createTask(epicId: string, title: string, options?: CreateTaskOptions): CreateTaskResult;
  createEpic(prdId: string, title: string, options?: CreateEpicOptions): CreateEpicResult;
  createPrd(title: string, options?: CreatePrdOptions): CreatePrdResult;
  createStory(prdId: string, title: string, options?: CreateStoryOptions): CreateStoryResult;

  // Update
  updateArtefact(id: string, options: UpdateArtefactOptions): UpdateArtefactResult;
  touchArtefact(id: string): TouchArtefactResult;

  // Edit body
  editArtefactSection(id: string, section: string, content: string, options?: EditSectionOptions): EditSectionResult;
  editArtefactMultiSection(id: string, content: string, defaultOp?: 'replace' | 'append' | 'prepend'): EditMultiSectionResult;
  patchArtefact(id: string, oldString: string, newString: string, options?: { section?: string; regexp?: boolean }): PatchArtefactResult;

  // Dependencies
  addArtefactDependency(id: string, blockedBy: string): ArtefactDependencyResult;
  addTaskDependency(taskId: string, blockedBy: string): TaskDependencyResult;

  // Cache
  clearCache(): void;
}
