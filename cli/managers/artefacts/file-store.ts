/**
 * FileArtefactStore — filesystem-backed implementation of ArtefactStore.
 *
 * Thin wrapper that delegates to existing module functions.
 * Preserves all direct imports (60+ consumers unchanged).
 */
import type { ArtefactStore } from './store.js';
import type {
  TaskIndexEntry,
  EpicIndexEntry,
  PrdIndexEntry,
  StoryIndexEntry,
  PanicIndexEntry,
  ArchiveEntry,
  FullPrd
} from '../../lib/types/entities.js';
import type { TaskQueryOptions, CreateTaskOptions, CreateTaskResult } from './task.js';
import type { EpicQueryOptions, CreateEpicOptions, CreateEpicResult } from './epic.js';
import type { CreatePrdOptions, CreatePrdResult } from './prd.js';
import type { StoryQueryOptions, CreateStoryOptions, CreateStoryResult } from './story.js';
import type { PanicQueryOptions, CreatePanicOptions, CreatePanicResult } from './panic.js';
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

// Read operations
import { getTask, getAllTasks as getAllTasksFn, getTasksForEpic as getTasksForEpicFn, getTaskEpic as getTaskEpicFn, countTasks as countTasksFn, createTask as createTaskFn, addTaskDependency as addTaskDependencyFn } from './task.js';
import { getEpic, getAllEpics as getAllEpicsFn, getEpicsForPrd as getEpicsForPrdFn, getEpicPrd as getEpicPrdFn, countEpics as countEpicsFn, createEpic as createEpicFn } from './epic.js';
import { getPrd, getAllPrds as getAllPrdsFn, getFullPrd as getFullPrdFn, getAllFullPrds as getAllFullPrdsFn, getPrdBranching as getPrdBranchingFn, createPrd as createPrdFn } from './prd.js';
import { getStory, getAllStories as getAllStoriesFn, getStoriesForPrd as getStoriesForPrdFn, countStories as countStoriesFn, createStory as createStoryFn } from './story.js';
import { getPanic, getAllPanics as getAllPanicsFn, getPanicsForScope as getPanicsForScopeFn, countOpenPanics as countOpenPanicsFn, createPanic as createPanicFn } from './panic.js';
import { getArchivedArtefact as getArchivedArtefactFn, getAllArchivedTasks as getAllArchivedTasksFn, getAllArchivedEpics as getAllArchivedEpicsFn, getAllArchivedPrds as getAllArchivedPrdsFn, buildArchiveIndex } from './archive.js';
import { searchArtefacts } from './search.js';
import { loadFile as coreLoadFile } from '../core-manager.js';
import { clearCache as clearCacheFn, updateArtefact as updateArtefactFn, touchArtefact as touchArtefactFn, editArtefactSection as editArtefactSectionFn, editArtefactMultiSection as editArtefactMultiSectionFn, patchArtefact as patchArtefactFn, addArtefactDependency as addArtefactDependencyFn, getArtefactBody as getArtefactBodyFn } from './common.js';


export class FileArtefactStore implements ArtefactStore {
  // -- Single lookups --
  getTask(id: string | number): TaskIndexEntry | null { return getTask(id); }
  getEpic(id: string | number): EpicIndexEntry | null { return getEpic(id); }
  getPrd(id: string | number): PrdIndexEntry | null { return getPrd(id); }
  getStory(id: string | number): StoryIndexEntry | null { return getStory(id); }
  getPanic(id: string | number): PanicIndexEntry | null { return getPanic(id); }
  getArchivedArtefact(id: string): ArchiveEntry | null { return getArchivedArtefactFn(id); }

  // -- List queries --
  getAllTasks(opts?: TaskQueryOptions): TaskIndexEntry[] { return getAllTasksFn(opts); }
  getAllEpics(opts?: EpicQueryOptions): EpicIndexEntry[] { return getAllEpicsFn(opts); }
  getAllPrds(): PrdIndexEntry[] { return getAllPrdsFn(); }
  getAllStories(opts?: StoryQueryOptions): StoryIndexEntry[] { return getAllStoriesFn(opts); }
  getAllPanics(opts?: PanicQueryOptions): PanicIndexEntry[] { return getAllPanicsFn(opts); }
  getAllArchivedTasks(opts?: ArchiveQueryOptions): ArchiveEntry[] { return getAllArchivedTasksFn(opts); }
  getAllArchivedEpics(opts?: ArchiveQueryOptions): ArchiveEntry[] { return getAllArchivedEpicsFn(opts); }
  getAllArchivedPrds(): ArchiveEntry[] { return getAllArchivedPrdsFn(); }

  getAllArchivedArtefacts(opts?: ArchiveQueryOptions & { type?: 'task' | 'epic' | 'prd' }): ArchiveEntry[] {
    const index = buildArchiveIndex();
    let entries = [...index.values()];
    if (opts?.type) entries = entries.filter(e => e.type === opts.type);
    if (opts?.prd) {
      const m = (/PRD-?0*(\d+)/i).exec(opts.prd);
      if (m) {
        const num = m[1];
        entries = entries.filter(e => { const n = (/PRD-0*(\d+)/i).exec(e.prdId); return n && n[1] === num; });
      }
    }
    if (opts?.status) entries = entries.filter(e => e.status === opts.status);
    return entries;
  }

  // -- Search --
  search(query: string, options?: SearchOptions): SearchHit[] { return searchArtefacts(query, options); }

  // -- File access --
  loadFile(filePath: string): { data: Record<string, unknown>; body: string } | null {
    const loaded = coreLoadFile(filePath);
    if (!loaded) return null;
    return { data: loaded.data, body: loaded.body };
  }

  // -- Relationship queries --
  getTasksForEpic(epicId: string | number): TaskIndexEntry[] { return getTasksForEpicFn(epicId); }
  getTaskEpic(taskId: string | number) { return getTaskEpicFn(taskId); }
  getEpicsForPrd(prdId: string | number): EpicIndexEntry[] { return getEpicsForPrdFn(prdId); }
  getEpicPrd(epicId: string | number) { return getEpicPrdFn(epicId); }
  getStoriesForPrd(prdId: string | number): StoryIndexEntry[] { return getStoriesForPrdFn(prdId); }
  getPanicsForScope(scopeId: string): PanicIndexEntry[] { return getPanicsForScopeFn(scopeId); }
  countOpenPanics(opts?: PanicQueryOptions): number { return countOpenPanicsFn(opts); }
  getTasksForPrd(prdId: string | number): TaskIndexEntry[] {
    const prd = getPrd(prdId);
    if (!prd) return [];
    return getAllTasksFn({ prdDir: prd.dir });
  }

  // -- Counts --
  countTasks(opts?: TaskQueryOptions): number { return countTasksFn(opts); }
  countEpics(opts?: EpicQueryOptions): number { return countEpicsFn(opts); }
  countStories(opts?: StoryQueryOptions): number { return countStoriesFn(opts); }

  // -- Full entity views --
  getFullPrd(prdId: string | number): FullPrd | null { return getFullPrdFn(prdId); }
  getAllFullPrds(): FullPrd[] { return getAllFullPrdsFn(); }

  // -- PRD utilities --
  getPrdBranching(prdId: string | number): string { return getPrdBranchingFn(prdId); }

  // -- Body access --
  getArtefactBody(id: string): string | null { return getArtefactBodyFn(id); }

  // -- Create --
  createTask(epicId: string, title: string, options?: CreateTaskOptions): CreateTaskResult { return createTaskFn(epicId, title, options); }
  createEpic(prdId: string, title: string, options?: CreateEpicOptions): CreateEpicResult { return createEpicFn(prdId, title, options); }
  createPrd(title: string, options?: CreatePrdOptions): CreatePrdResult { return createPrdFn(title, options); }
  createStory(prdId: string, title: string, options?: CreateStoryOptions): CreateStoryResult { return createStoryFn(prdId, title, options); }
  createPanic(scopeId: string, title: string, options?: CreatePanicOptions): CreatePanicResult { return createPanicFn(scopeId, title, options); }

  // -- Update --
  updateArtefact(id: string, options: UpdateArtefactOptions): UpdateArtefactResult { return updateArtefactFn(id, options); }
  touchArtefact(id: string): TouchArtefactResult { return touchArtefactFn(id); }

  // -- Edit body --
  editArtefactSection(id: string, section: string, content: string, options?: EditSectionOptions): EditSectionResult { return editArtefactSectionFn(id, section, content, options); }
  editArtefactMultiSection(id: string, content: string, defaultOp?: 'replace' | 'append' | 'prepend'): EditMultiSectionResult { return editArtefactMultiSectionFn(id, content, defaultOp); }
  patchArtefact(id: string, oldString: string, newString: string, options?: { section?: string; regexp?: boolean }): PatchArtefactResult { return patchArtefactFn(id, oldString, newString, options); }

  // -- Dependencies --
  addArtefactDependency(id: string, blockedBy: string): ArtefactDependencyResult { return addArtefactDependencyFn(id, blockedBy); }
  addTaskDependency(taskId: string, blockedBy: string): TaskDependencyResult { return addTaskDependencyFn(taskId, blockedBy); }

  // -- Cache --
  clearCache(): void { clearCacheFn(); }
}

let _store: FileArtefactStore | null = null;

export function getStore(): ArtefactStore {
  if (!_store) _store = new FileArtefactStore();
  return _store;
}
