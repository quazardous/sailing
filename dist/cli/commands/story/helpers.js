/**
 * Story command helpers and types
 */
import { normalizeId } from '../../lib/normalize.js';
import { getAllEpics, getAllTasks, getStory, getAllStories as getStoriesFromIndex, getPrd, matchesPrd } from '../../managers/artefacts-manager.js';
export const STORY_TYPES = ['user', 'technical', 'api'];
/**
 * Find a story file by ID (uses artefacts.ts contract)
 */
export function findStoryFile(storyId) {
    const storyEntry = getStory(storyId);
    if (!storyEntry)
        return null;
    return { file: storyEntry.file, prdDir: storyEntry.prdDir, prdId: storyEntry.prdId };
}
/**
 * Get all stories across all PRDs (uses artefacts.ts contract)
 * @param prdFilter - Optional PRD filter
 * @param includePath - Include file paths in result (default: false for privacy)
 */
export function getAllStories(prdFilter = null, includePath = false) {
    // Get stories from artefacts index, optionally filter by PRD
    let storyEntries = getStoriesFromIndex();
    if (prdFilter) {
        const prd = getPrd(prdFilter);
        if (prd) {
            storyEntries = storyEntries.filter(s => s.prdId === prd.id);
        }
        else {
            // Fallback: filter by prdId
            storyEntries = storyEntries.filter(s => matchesPrd(s.prdId, prdFilter));
        }
    }
    return storyEntries.map(entry => {
        const storyEntry = {
            id: entry.data?.id || entry.id,
            title: entry.data?.title || '',
            status: entry.data?.status || 'Draft',
            type: entry.data?.type || 'user',
            parent: entry.data?.parent || '',
            parent_story: entry.data?.parent_story || null,
            prd: entry.prdId
        };
        if (includePath)
            storyEntry.file = entry.file;
        return storyEntry;
    });
}
/**
 * Get all epics and tasks with their story references
 */
export function getStoryReferences() {
    const refs = { epics: {}, tasks: {} };
    // Use artefacts.ts contract for epics
    for (const epicEntry of getAllEpics()) {
        const data = epicEntry.data;
        if (!data)
            continue;
        const stories = data.stories || [];
        stories.forEach(s => {
            const sid = normalizeId(s);
            if (!refs.epics[sid])
                refs.epics[sid] = [];
            refs.epics[sid].push(data.id);
        });
    }
    // Use artefacts.ts contract for tasks
    for (const taskEntry of getAllTasks()) {
        const data = taskEntry.data;
        if (!data)
            continue;
        const stories = data.stories || [];
        stories.forEach(s => {
            const sid = normalizeId(s);
            if (!refs.tasks[sid])
                refs.tasks[sid] = [];
            refs.tasks[sid].push(data.id);
        });
    }
    return refs;
}
/**
 * Build story tree structure
 */
export function buildStoryTree(stories) {
    const byId = new Map();
    const roots = [];
    const children = new Map();
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
                children.get(parentId).push(s);
            }
        }
        else {
            roots.push(s);
        }
    });
    return { byId, roots, children };
}
