/**
 * Common artefact utilities - cache and shared operations
 */
import { loadFile, saveFile } from '../core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { parseMultiSectionContent, editArtifact } from '../../lib/artifact.js';
// ============================================================================
// CACHE
// ============================================================================
export let _taskIndex = null;
export let _epicIndex = null;
export let _prdIndex = null;
export let _storyIndex = null;
export let _memoryIndex = null;
export let _logIndex = null;
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
export function setTaskIndex(index) { _taskIndex = index; }
export function setEpicIndex(index) { _epicIndex = index; }
export function setPrdIndex(index) { _prdIndex = index; }
export function setStoryIndex(index) { _storyIndex = index; }
export function setMemoryIndex(index) { _memoryIndex = index; }
export function setLogIndex(index) { _logIndex = index; }
// Lazy imports to avoid circular dependencies
let _getTask = null;
let _getEpic = null;
let _getPrd = null;
let _getStory = null;
export function setGetters(getTask, getEpic, getPrd, getStory) {
    _getTask = getTask;
    _getEpic = getEpic;
    _getPrd = getPrd;
    _getStory = getStory;
}
/**
 * Update artefact frontmatter
 */
export function updateArtefact(id, options) {
    if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
        throw new Error('Getters not initialized. Call setGetters first.');
    }
    const normalized = normalizeId(id);
    let entry = null;
    if (normalized.startsWith('T')) {
        const task = _getTask(normalized);
        if (task)
            entry = { file: task.file, data: task.data || {} };
    }
    else if (normalized.startsWith('E')) {
        const epic = _getEpic(normalized);
        if (epic)
            entry = { file: epic.file, data: epic.data || {} };
    }
    else if (normalized.startsWith('PRD-')) {
        const prd = _getPrd(normalized);
        if (prd)
            entry = { file: prd.file, data: prd.data || {} };
    }
    else if (normalized.startsWith('S')) {
        const story = _getStory(normalized);
        if (story)
            entry = { file: story.file, data: story.data || {} };
    }
    if (!entry) {
        throw new Error(`Artefact not found: ${id}`);
    }
    const file = loadFile(entry.file);
    if (!file) {
        throw new Error(`Could not load file: ${entry.file}`);
    }
    const data = { ...file.data };
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
export function getArtefactBody(id) {
    if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
        throw new Error('Getters not initialized. Call setGetters first.');
    }
    const normalized = normalizeId(id);
    let filePath = null;
    if (normalized.startsWith('T')) {
        const task = _getTask(normalized);
        if (task)
            filePath = task.file;
    }
    else if (normalized.startsWith('E')) {
        const epic = _getEpic(normalized);
        if (epic)
            filePath = epic.file;
    }
    else if (normalized.startsWith('PRD-')) {
        const prd = _getPrd(normalized);
        if (prd)
            filePath = prd.file;
    }
    else if (normalized.startsWith('S')) {
        const story = _getStory(normalized);
        if (story)
            filePath = story.file;
    }
    if (!filePath) {
        return null;
    }
    const file = loadFile(filePath);
    return file?.body || null;
}
/**
 * Edit a section in artefact body
 */
export function editArtefactSection(id, section, content, options = {}) {
    if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
        throw new Error('Getters not initialized. Call setGetters first.');
    }
    const normalized = normalizeId(id);
    let filePath = null;
    if (normalized.startsWith('T')) {
        const task = _getTask(normalized);
        if (task)
            filePath = task.file;
    }
    else if (normalized.startsWith('E')) {
        const epic = _getEpic(normalized);
        if (epic)
            filePath = epic.file;
    }
    else if (normalized.startsWith('PRD-')) {
        const prd = _getPrd(normalized);
        if (prd)
            filePath = prd.file;
    }
    else if (normalized.startsWith('S')) {
        const story = _getStory(normalized);
        if (story)
            filePath = story.file;
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
        let newSectionContent;
        if (mode === 'append') {
            newSectionContent = existingContent.trimEnd() + '\n\n' + content;
        }
        else if (mode === 'prepend') {
            newSectionContent = '\n\n' + content + existingContent;
        }
        else {
            newSectionContent = '\n\n' + content + '\n';
        }
        body = body.replace(sectionRegex, `${sectionHeader}${newSectionContent}`);
    }
    else {
        body = body.trimEnd() + `\n\n${sectionHeader}\n\n${content}\n`;
    }
    saveFile(filePath, file.data, body);
    clearCache();
    return { id: normalized, section, updated: true };
}
/**
 * Edit multiple sections in artefact body using ## header format
 */
export function editArtefactMultiSection(id, content, defaultOp = 'replace') {
    if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
        throw new Error('Getters not initialized. Call setGetters first.');
    }
    const normalized = normalizeId(id);
    let filePath = null;
    if (normalized.startsWith('T')) {
        const task = _getTask(normalized);
        if (task)
            filePath = task.file;
    }
    else if (normalized.startsWith('E')) {
        const epic = _getEpic(normalized);
        if (epic)
            filePath = epic.file;
    }
    else if (normalized.startsWith('PRD-')) {
        const prd = _getPrd(normalized);
        if (prd)
            filePath = prd.file;
    }
    else if (normalized.startsWith('S')) {
        const story = _getStory(normalized);
        if (story)
            filePath = story.file;
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
/**
 * Add a dependency between artefacts (Tasks or Epics)
 * Updates the blocked_by field in the artefact's frontmatter
 */
export function addArtefactDependency(id, blockedBy) {
    if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
        throw new Error('Getters not initialized. Call setGetters first.');
    }
    const normalizedId = normalizeId(id);
    const normalizedBlocker = normalizeId(blockedBy);
    // Determine type and get file path
    let filePath = null;
    let blockerFilePath = null;
    let idType = null;
    let blockerType = null;
    // Get source artefact
    if (normalizedId.startsWith('T')) {
        const task = _getTask(normalizedId);
        if (task) {
            filePath = task.file;
            idType = 'task';
        }
    }
    else if (normalizedId.startsWith('E')) {
        const epic = _getEpic(normalizedId);
        if (epic) {
            filePath = epic.file;
            idType = 'epic';
        }
    }
    // Get blocker artefact
    if (normalizedBlocker.startsWith('T')) {
        const task = _getTask(normalizedBlocker);
        if (task) {
            blockerFilePath = task.file;
            blockerType = 'task';
        }
    }
    else if (normalizedBlocker.startsWith('E')) {
        const epic = _getEpic(normalizedBlocker);
        if (epic) {
            blockerFilePath = epic.file;
            blockerType = 'epic';
        }
    }
    // Validate source
    if (!filePath || !idType) {
        return {
            id: normalizedId,
            blockedBy: normalizedBlocker,
            added: false,
            message: `Artefact not found: ${normalizedId}. Only Tasks (T001) and Epics (E001) can have dependencies.`
        };
    }
    // Validate blocker
    if (!blockerFilePath || !blockerType) {
        return {
            id: normalizedId,
            blockedBy: normalizedBlocker,
            added: false,
            message: `Blocker not found: ${normalizedBlocker}. Only Tasks (T001) and Epics (E001) can be blockers.`
        };
    }
    // Load and update
    const file = loadFile(filePath);
    if (!file) {
        return {
            id: normalizedId,
            blockedBy: normalizedBlocker,
            added: false,
            message: `Could not load artefact file`
        };
    }
    if (!Array.isArray(file.data.blocked_by)) {
        file.data.blocked_by = [];
    }
    if (file.data.blocked_by.includes(normalizedBlocker)) {
        return {
            id: normalizedId,
            blockedBy: normalizedBlocker,
            added: false,
            message: `Dependency already exists`
        };
    }
    file.data.blocked_by.push(normalizedBlocker);
    saveFile(filePath, file.data, file.body);
    clearCache();
    return {
        id: normalizedId,
        blockedBy: normalizedBlocker,
        added: true,
        message: `Added: ${normalizedId} (${idType}) blocked by ${normalizedBlocker} (${blockerType})`
    };
}
