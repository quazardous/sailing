// Read operations
import { getTask, getAllTasks as getAllTasksFn, getTasksForEpic as getTasksForEpicFn, getTaskEpic as getTaskEpicFn, countTasks as countTasksFn, createTask as createTaskFn, addTaskDependency as addTaskDependencyFn } from './task.js';
import { getEpic, getAllEpics as getAllEpicsFn, getEpicsForPrd as getEpicsForPrdFn, getEpicPrd as getEpicPrdFn, countEpics as countEpicsFn, createEpic as createEpicFn } from './epic.js';
import { getPrd, getAllPrds as getAllPrdsFn, getFullPrd as getFullPrdFn, getAllFullPrds as getAllFullPrdsFn, getPrdBranching as getPrdBranchingFn, createPrd as createPrdFn } from './prd.js';
import { getStory, getAllStories as getAllStoriesFn, getStoriesForPrd as getStoriesForPrdFn, countStories as countStoriesFn, createStory as createStoryFn } from './story.js';
import { getArchivedArtefact as getArchivedArtefactFn, getAllArchivedTasks as getAllArchivedTasksFn, getAllArchivedEpics as getAllArchivedEpicsFn, getAllArchivedPrds as getAllArchivedPrdsFn, buildArchiveIndex } from './archive.js';
import { searchArtefacts } from './search.js';
import { loadFile as coreLoadFile } from '../core-manager.js';
import { clearCache as clearCacheFn, updateArtefact as updateArtefactFn, touchArtefact as touchArtefactFn, editArtefactSection as editArtefactSectionFn, editArtefactMultiSection as editArtefactMultiSectionFn, patchArtefact as patchArtefactFn, addArtefactDependency as addArtefactDependencyFn, getArtefactBody as getArtefactBodyFn } from './common.js';
export class FileArtefactStore {
    // -- Single lookups --
    getTask(id) { return getTask(id); }
    getEpic(id) { return getEpic(id); }
    getPrd(id) { return getPrd(id); }
    getStory(id) { return getStory(id); }
    getArchivedArtefact(id) { return getArchivedArtefactFn(id); }
    // -- List queries --
    getAllTasks(opts) { return getAllTasksFn(opts); }
    getAllEpics(opts) { return getAllEpicsFn(opts); }
    getAllPrds() { return getAllPrdsFn(); }
    getAllStories(opts) { return getAllStoriesFn(opts); }
    getAllArchivedTasks(opts) { return getAllArchivedTasksFn(opts); }
    getAllArchivedEpics(opts) { return getAllArchivedEpicsFn(opts); }
    getAllArchivedPrds() { return getAllArchivedPrdsFn(); }
    getAllArchivedArtefacts(opts) {
        const index = buildArchiveIndex();
        let entries = [...index.values()];
        if (opts?.type)
            entries = entries.filter(e => e.type === opts.type);
        if (opts?.prd) {
            const m = (/PRD-?0*(\d+)/i).exec(opts.prd);
            if (m) {
                const num = m[1];
                entries = entries.filter(e => { const n = (/PRD-0*(\d+)/i).exec(e.prdId); return n && n[1] === num; });
            }
        }
        if (opts?.status)
            entries = entries.filter(e => e.status === opts.status);
        return entries;
    }
    // -- Search --
    search(query, options) { return searchArtefacts(query, options); }
    // -- File access --
    loadFile(filePath) {
        const loaded = coreLoadFile(filePath);
        if (!loaded)
            return null;
        return { data: loaded.data, body: loaded.body };
    }
    // -- Relationship queries --
    getTasksForEpic(epicId) { return getTasksForEpicFn(epicId); }
    getTaskEpic(taskId) { return getTaskEpicFn(taskId); }
    getEpicsForPrd(prdId) { return getEpicsForPrdFn(prdId); }
    getEpicPrd(epicId) { return getEpicPrdFn(epicId); }
    getStoriesForPrd(prdId) { return getStoriesForPrdFn(prdId); }
    getTasksForPrd(prdId) {
        const prd = getPrd(prdId);
        if (!prd)
            return [];
        return getAllTasksFn({ prdDir: prd.dir });
    }
    // -- Counts --
    countTasks(opts) { return countTasksFn(opts); }
    countEpics(opts) { return countEpicsFn(opts); }
    countStories(opts) { return countStoriesFn(opts); }
    // -- Full entity views --
    getFullPrd(prdId) { return getFullPrdFn(prdId); }
    getAllFullPrds() { return getAllFullPrdsFn(); }
    // -- PRD utilities --
    getPrdBranching(prdId) { return getPrdBranchingFn(prdId); }
    // -- Body access --
    getArtefactBody(id) { return getArtefactBodyFn(id); }
    // -- Create --
    createTask(epicId, title, options) { return createTaskFn(epicId, title, options); }
    createEpic(prdId, title, options) { return createEpicFn(prdId, title, options); }
    createPrd(title, options) { return createPrdFn(title, options); }
    createStory(prdId, title, options) { return createStoryFn(prdId, title, options); }
    // -- Update --
    updateArtefact(id, options) { return updateArtefactFn(id, options); }
    touchArtefact(id) { return touchArtefactFn(id); }
    // -- Edit body --
    editArtefactSection(id, section, content, options) { return editArtefactSectionFn(id, section, content, options); }
    editArtefactMultiSection(id, content, defaultOp) { return editArtefactMultiSectionFn(id, content, defaultOp); }
    patchArtefact(id, oldString, newString, options) { return patchArtefactFn(id, oldString, newString, options); }
    // -- Dependencies --
    addArtefactDependency(id, blockedBy) { return addArtefactDependencyFn(id, blockedBy); }
    addTaskDependency(taskId, blockedBy) { return addTaskDependencyFn(taskId, blockedBy); }
    // -- Cache --
    clearCache() { clearCacheFn(); }
}
let _store = null;
export function getStore() {
    if (!_store)
        _store = new FileArtefactStore();
    return _store;
}
