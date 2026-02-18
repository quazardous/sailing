/**
 * Common artefact utilities - cache and shared operations
 */
import fs from 'fs';
import { loadFile, saveFile } from '../core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { parseMultiSectionContent, editArtifact, applySearchReplace, parseMarkdownSections, serializeSections } from '../../lib/artifact.js';
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
// ============================================================================
// TIMESTAMP HELPERS
// ============================================================================
/**
 * Stamp updated_at on data, backfill created_at from file mtime if missing.
 */
function stampDates(data, filePath) {
    if (!data.created_at) {
        try {
            data.created_at = fs.statSync(filePath).mtime.toISOString();
        }
        catch {
            data.created_at = new Date().toISOString();
        }
    }
    data.updated_at = new Date().toISOString();
}
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
function resolveArtefact(id, mode) {
    if (!_getTask || !_getEpic || !_getPrd || !_getStory) {
        throw new Error('Getters not initialized. Call setGetters first.');
    }
    const normalized = normalizeId(id);
    let entry = null;
    let type;
    if (normalized.startsWith('T')) {
        type = 'task';
        const t = _getTask(normalized);
        if (t)
            entry = { id: t.id, file: t.file };
    }
    else if (normalized.startsWith('E')) {
        type = 'epic';
        const e = _getEpic(normalized);
        if (e)
            entry = { id: e.id, file: e.file };
    }
    else if (normalized.startsWith('PRD-')) {
        type = 'prd';
        const p = _getPrd(normalized);
        if (p)
            entry = { id: p.id, file: p.file };
    }
    else if (normalized.startsWith('S')) {
        type = 'story';
        const s = _getStory(normalized);
        if (s)
            entry = { id: s.id, file: s.file };
    }
    else {
        if (mode === 'required')
            throw new Error(`Artefact not found: ${id}`);
        return null;
    }
    if (!entry) {
        if (mode === 'required')
            throw new Error(`Artefact not found: ${id}`);
        return null;
    }
    return { id: entry.id, file: entry.file, type };
}
/**
 * Update artefact frontmatter
 */
export function updateArtefact(id, options) {
    const resolved = resolveArtefact(id, 'required');
    const file = loadFile(resolved.file);
    if (!file) {
        throw new Error(`Could not load file: ${resolved.file}`);
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
    if (options.milestone !== undefined) {
        data.milestone = options.milestone;
        updated = true;
    }
    if (options.set) {
        for (const [k, v] of Object.entries(options.set)) {
            data[k] = v;
            updated = true;
        }
    }
    if (updated) {
        stampDates(data, resolved.file);
        saveFile(resolved.file, data, file.body);
        clearCache();
    }
    return { id: resolved.id, updated, data };
}
/**
 * Touch artefact - stamp updated_at (and backfill created_at) without modifying body
 */
export function touchArtefact(id) {
    const resolved = resolveArtefact(id, 'required');
    const file = loadFile(resolved.file);
    if (!file) {
        throw new Error(`Could not load file: ${resolved.file}`);
    }
    const data = { ...file.data };
    stampDates(data, resolved.file);
    saveFile(resolved.file, data, file.body);
    clearCache();
    return {
        id: resolved.id,
        file: resolved.file,
        updated_at: data.updated_at,
        created_at: data.created_at
    };
}
/**
 * Get artefact body (markdown content without frontmatter)
 */
export function getArtefactBody(id) {
    const resolved = resolveArtefact(id);
    if (!resolved)
        return null;
    const file = loadFile(resolved.file);
    return file?.body || null;
}
/**
 * Find section header position, ignoring headers inside HTML comments
 * Returns the index of the ## header in the original body, or -1 if not found
 */
function findSectionPosition(body, sectionName) {
    const lines = body.split('\n');
    let inComment = false;
    let position = 0;
    const escapedSection = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headerRegex = new RegExp(`^## ${escapedSection}\\s*$`, 'i');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Track HTML comment state
        const hasOpen = line.includes('<!--');
        const hasClose = line.includes('-->');
        if (hasOpen && hasClose) {
            const openIdx = line.indexOf('<!--');
            const closeIdx = line.indexOf('-->');
            if (openIdx > closeIdx) {
                inComment = true;
            }
        }
        else if (hasOpen) {
            inComment = true;
        }
        else if (hasClose) {
            inComment = false;
            position += line.length + 1;
            continue;
        }
        // Skip if inside comment
        if (!inComment && headerRegex.test(line)) {
            // Found the section header outside of comments
            // Now find where this section ends (next ## or end of file)
            let endPosition = body.length;
            let searchPos = position + line.length + 1;
            // Look for next section header (not in comment)
            let searchInComment = false;
            for (let j = i + 1; j < lines.length; j++) {
                const searchLine = lines[j];
                const searchHasOpen = searchLine.includes('<!--');
                const searchHasClose = searchLine.includes('-->');
                if (searchHasOpen && searchHasClose) {
                    const openIdx = searchLine.indexOf('<!--');
                    const closeIdx = searchLine.indexOf('-->');
                    if (openIdx > closeIdx) {
                        searchInComment = true;
                    }
                }
                else if (searchHasOpen) {
                    searchInComment = true;
                }
                else if (searchHasClose) {
                    searchInComment = false;
                    searchPos += searchLine.length + 1;
                    continue;
                }
                if (!searchInComment && /^## /.test(searchLine)) {
                    endPosition = searchPos;
                    break;
                }
                searchPos += searchLine.length + 1;
            }
            return { start: position, end: endPosition };
        }
        position += line.length + 1;
    }
    return null;
}
/**
 * Edit a section in artefact body
 * IMPORTANT: Ignores ## headers inside HTML comments to prevent corruption.
 */
export function editArtefactSection(id, section, content, options = {}) {
    const resolved = resolveArtefact(id, 'required');
    const file = loadFile(resolved.file);
    if (!file) {
        throw new Error(`Could not load file: ${resolved.file}`);
    }
    const mode = options.mode || 'replace';
    let body = file.body;
    const sectionHeader = `## ${section}`;
    // Find section position, ignoring headers in HTML comments
    const sectionPos = findSectionPosition(body, section);
    if (sectionPos) {
        const beforeSection = body.slice(0, sectionPos.start);
        const afterSection = body.slice(sectionPos.end);
        const existingSection = body.slice(sectionPos.start, sectionPos.end);
        // Extract existing content (everything after the header line)
        const headerEndIdx = existingSection.indexOf('\n');
        const existingContent = headerEndIdx >= 0 ? existingSection.slice(headerEndIdx) : '';
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
        body = beforeSection + sectionHeader + newSectionContent + afterSection;
    }
    else {
        // Section not found, append at end
        body = body.trimEnd() + `\n\n${sectionHeader}\n\n${content}\n`;
    }
    const data = { ...file.data };
    stampDates(data, resolved.file);
    saveFile(resolved.file, data, body);
    clearCache();
    return { id: resolved.id, section, updated: true };
}
/**
 * Edit multiple sections in artefact body using ## header format
 */
export function editArtefactMultiSection(id, content, defaultOp = 'replace') {
    const resolved = resolveArtefact(id, 'required');
    const ops = parseMultiSectionContent(content, defaultOp);
    if (ops.length === 0) {
        throw new Error('No sections found in content. Use ## Section format.');
    }
    const result = editArtifact(resolved.file, ops);
    if (!result.success) {
        throw new Error(result.errors?.join(', ') || 'Edit failed');
    }
    // editArtifact writes directly — reload to stamp dates
    if (result.applied > 0) {
        const file = loadFile(resolved.file);
        if (file) {
            const data = { ...file.data };
            stampDates(data, resolved.file);
            saveFile(resolved.file, data, file.body);
        }
    }
    clearCache();
    // Reload file to measure line counts per edited section
    const editedNames = new Set(ops.map(op => op.section));
    const reloaded = loadFile(resolved.file);
    const sections = [];
    if (reloaded?.body) {
        for (const name of editedNames) {
            const pos = findSectionPosition(reloaded.body, name);
            if (pos) {
                const sectionText = reloaded.body.slice(pos.start, pos.end);
                sections.push({ name, lines: sectionText.split('\n').length });
            }
            else {
                sections.push({ name, lines: 0 });
            }
        }
    }
    else {
        for (const name of editedNames) {
            sections.push({ name, lines: 0 });
        }
    }
    return {
        id: resolved.id,
        sections,
        updated: true
    };
}
/**
 * Patch artefact body using old_string → new_string replacement.
 * If section is provided, scopes the search to that section only.
 * If regexp is true, old_string is treated as a regex pattern.
 */
export function patchArtefact(id, oldString, newString, options = {}) {
    if (oldString === newString) {
        throw new Error('old_string and new_string are identical — nothing to change');
    }
    const resolved = resolveArtefact(id, 'required');
    const file = loadFile(resolved.file);
    if (!file) {
        throw new Error(`Could not load file: ${resolved.file}`);
    }
    let body = file.body;
    if (options.section) {
        // Scope to a specific section
        const parsed = parseMarkdownSections(`---\n---\n${body}`);
        const sectionContent = parsed.sections.get(options.section);
        if (sectionContent === undefined) {
            throw new Error(`Section not found: ${options.section}`);
        }
        let newContent;
        if (options.regexp) {
            const regex = new RegExp(oldString, 'g');
            if (!regex.test(sectionContent)) {
                throw new Error(`old_string pattern not found in section "${options.section}"`);
            }
            newContent = sectionContent.replace(new RegExp(oldString, 'g'), newString);
        }
        else {
            const result = applySearchReplace(sectionContent, oldString, newString);
            if (!result.success) {
                throw new Error(`old_string not found in section "${options.section}"`);
            }
            newContent = result.content;
        }
        parsed.sections.set(options.section, newContent);
        // Serialize back — strip the dummy frontmatter we added
        const serialized = serializeSections(parsed);
        // Remove the "---\n---\n" prefix
        const fmEnd = serialized.indexOf('---', 3);
        body = serialized.slice(fmEnd + 4); // skip "---\n"
    }
    else {
        // Full body patch
        if (options.regexp) {
            const regex = new RegExp(oldString, 'g');
            if (!regex.test(body)) {
                throw new Error('old_string pattern not found in artefact body');
            }
            body = body.replace(new RegExp(oldString, 'g'), newString);
        }
        else {
            const result = applySearchReplace(body, oldString, newString);
            if (!result.success) {
                throw new Error('old_string not found in artefact body');
            }
            body = result.content;
        }
    }
    const data = { ...file.data };
    stampDates(data, resolved.file);
    saveFile(resolved.file, data, body);
    clearCache();
    // Extract context lines around the replacement
    const contextLines = 2;
    const bodyLines = body.split('\n');
    const newStringFirstLine = newString.split('\n')[0];
    const matchIdx = bodyLines.findIndex(l => l.includes(newStringFirstLine));
    let context;
    if (matchIdx >= 0) {
        const start = Math.max(0, matchIdx - contextLines);
        const end = Math.min(bodyLines.length, matchIdx + newString.split('\n').length + contextLines);
        context = bodyLines.slice(start, end).join('\n');
    }
    return { id: resolved.id, section: options.section, updated: true, context };
}
/**
 * Add a dependency between artefacts (Tasks or Epics)
 * Updates the blocked_by field in the artefact's frontmatter
 */
export function addArtefactDependency(id, blockedBy) {
    // Dependencies only supported for tasks and epics
    const source = resolveArtefact(id);
    const blocker = resolveArtefact(blockedBy);
    if (!source || (source.type !== 'task' && source.type !== 'epic')) {
        return {
            id: normalizeId(id),
            blockedBy: normalizeId(blockedBy),
            added: false,
            message: `Artefact not found: ${id}. Only Tasks (T001) and Epics (E001) can have dependencies.`
        };
    }
    if (!blocker || (blocker.type !== 'task' && blocker.type !== 'epic')) {
        return {
            id: source.id,
            blockedBy: normalizeId(blockedBy),
            added: false,
            message: `Blocker not found: ${blockedBy}. Only Tasks (T001) and Epics (E001) can be blockers.`
        };
    }
    // Load and update
    const file = loadFile(source.file);
    if (!file) {
        return {
            id: source.id,
            blockedBy: blocker.id,
            added: false,
            message: `Could not load artefact file`
        };
    }
    if (!Array.isArray(file.data.blocked_by)) {
        file.data.blocked_by = [];
    }
    if (file.data.blocked_by.includes(blocker.id)) {
        return {
            id: source.id,
            blockedBy: blocker.id,
            added: false,
            message: `Dependency already exists`
        };
    }
    file.data.blocked_by.push(blocker.id);
    saveFile(source.file, file.data, file.body);
    clearCache();
    return {
        id: source.id,
        blockedBy: blocker.id,
        added: true,
        message: `Added: ${source.id} (${source.type}) blocked by ${blocker.id} (${blocker.type})`
    };
}
