/**
 * Artefact indexing library
 *
 * Indexes tasks, epics, stories by numeric ID across all PRDs.
 * Handles format changes (T001 → T0001 → T00001) by extracting numeric part.
 *
 * Usage:
 *   const index = buildTaskIndex();
 *   const task = index.get(39);  // Returns task file info for task 39
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, getMemoryDir } from './core.js';
// Cache for indexes (cleared when needed)
let _taskIndex = null;
let _epicIndex = null;
let _prdIndex = null;
let _memoryIndex = null;
/**
 * Extract ID key from filename (number + optional suffix)
 * T039-foo.md → "39", T0039-bar.md → "39", T00039.md → "39"
 * E001-foo.md → "1", E0001.md → "1"
 * E005a-foo.md → "5a", E005b-bar.md → "5b"
 */
export function extractIdKey(filename, prefix = 'T') {
    // Match prefix + optional leading zeros + digits + optional letter suffix
    const match = filename.match(new RegExp(`^${prefix}0*(\\d+)([a-z])?`, 'i'));
    if (!match)
        return null;
    const num = match[1];
    const suffix = match[2] ? match[2].toLowerCase() : '';
    return num + suffix; // "39", "5a", "5b"
}
/**
 * Extract numeric part only (for backward compat)
 */
export function extractNumericId(filename, prefix = 'T') {
    const match = filename.match(new RegExp(`^${prefix}0*(\\d+)`, 'i'));
    return match ? parseInt(match[1], 10) : null;
}
/**
 * Build task index across all PRDs
 * Keys are strings: "39", "39a", "39b" (supports letter suffixes)
 * @returns {Map<string, {key: string, id: string, file: string, prdDir: string, data: object}>}
 */
export function buildTaskIndex() {
    if (_taskIndex)
        return _taskIndex;
    _taskIndex = new Map();
    const duplicates = [];
    for (const prdDir of findPrdDirs()) {
        const tasksDir = path.join(prdDir, 'tasks');
        if (!fs.existsSync(tasksDir))
            continue;
        const files = fs.readdirSync(tasksDir).filter(f => /^T\d+[a-z]?.*\.md$/i.test(f));
        for (const file of files) {
            const key = extractIdKey(file, 'T');
            if (key === null)
                continue;
            const filePath = path.join(tasksDir, file);
            const idMatch = file.match(/^(T\d+[a-z]?)/i);
            const id = idMatch ? idMatch[1] : `T${key}`;
            // Load file data (frontmatter)
            const loaded = loadFile(filePath);
            const status = loaded?.data?.status;
            // Check for duplicate (only warn if not Done)
            if (_taskIndex.has(key)) {
                const existingEntry = _taskIndex.get(key);
                const existingStatus = existingEntry.data?.status;
                if (status !== 'Done' || existingStatus !== 'Done') {
                    duplicates.push({ key, existing: existingEntry.file, new: filePath });
                }
            }
            _taskIndex.set(key, {
                key,
                id,
                file: filePath,
                prdDir,
                data: loaded?.data || {}
            });
        }
    }
    // Warn about duplicates
    if (duplicates.length > 0) {
        console.error(`⚠ Duplicate task IDs found:`);
        for (const d of duplicates) {
            console.error(`  T${d.key}: ${d.existing} vs ${d.new}`);
        }
    }
    return _taskIndex;
}
/**
 * Build epic index across all PRDs
 * Keys are strings: "5", "5a", "5b" (supports letter suffixes)
 * @returns {Map<string, {key: string, id: string, file: string, prdDir: string, data: object}>}
 */
export function buildEpicIndex() {
    if (_epicIndex)
        return _epicIndex;
    _epicIndex = new Map();
    const duplicates = [];
    for (const prdDir of findPrdDirs()) {
        const epicsDir = path.join(prdDir, 'epics');
        if (!fs.existsSync(epicsDir))
            continue;
        const files = fs.readdirSync(epicsDir).filter(f => /^E\d+[a-z]?.*\.md$/i.test(f));
        for (const file of files) {
            const key = extractIdKey(file, 'E');
            if (key === null)
                continue;
            const filePath = path.join(epicsDir, file);
            const idMatch = file.match(/^(E\d+[a-z]?)/i);
            const id = idMatch ? idMatch[1] : `E${key}`;
            // Load file data (frontmatter)
            const loaded = loadFile(filePath);
            const status = loaded?.data?.status;
            // Check for duplicate (only warn if not Done)
            if (_epicIndex.has(key)) {
                const existingEntry = _epicIndex.get(key);
                const existingStatus = existingEntry.data?.status;
                // Only warn if at least one is active (not Done)
                if (status !== 'Done' || existingStatus !== 'Done') {
                    duplicates.push({ key, existing: existingEntry.file, new: filePath });
                }
            }
            _epicIndex.set(key, {
                key,
                id,
                file: filePath,
                prdDir,
                data: loaded?.data || {}
            });
        }
    }
    // Warn about duplicates
    if (duplicates.length > 0) {
        console.error(`⚠ Duplicate epic IDs found:`);
        for (const d of duplicates) {
            console.error(`  E${d.key}: ${d.existing} vs ${d.new}`);
        }
    }
    return _epicIndex;
}
/**
 * Get task by ID (any format: 39, "39", "39a", "T39", "T039", "T00039", "T039a")
 * @returns {{key, id, file, prdDir, data}|null}
 */
export function getTask(taskId) {
    const index = buildTaskIndex();
    // Extract key (number + optional suffix) from various formats
    let key;
    if (typeof taskId === 'number') {
        key = String(taskId);
    }
    else {
        const match = String(taskId).match(/^T?0*(\d+)([a-z])?$/i);
        if (match) {
            key = match[1] + (match[2] ? match[2].toLowerCase() : '');
        }
        else {
            key = null;
        }
    }
    if (key === null)
        return null;
    return index.get(key) || null;
}
/**
 * Get epic by ID (any format: 14, "14", "14b", "E14", "E014", "E0014", "E005b")
 * @returns {{key, id, file, prdDir, data}|null}
 */
export function getEpic(epicId) {
    const index = buildEpicIndex();
    // Extract key (number + optional suffix) from various formats
    let key;
    if (typeof epicId === 'number') {
        key = String(epicId);
    }
    else {
        const match = String(epicId).match(/^E?0*(\d+)([a-z])?$/i);
        if (match) {
            key = match[1] + (match[2] ? match[2].toLowerCase() : '');
        }
        else {
            key = null;
        }
    }
    if (key === null)
        return null;
    return index.get(key) || null;
}
/**
 * Get parent epic for a task
 * @param {string|number} taskId - Task ID in any format
 * @returns {{epicId: string, epicKey: string, title: string}|null}
 */
export function getTaskEpic(taskId) {
    const task = getTask(taskId);
    if (!task)
        return null;
    const parent = task.data?.parent;
    if (!parent)
        return null;
    // Extract epic ID from parent (format: "PRD-001 / E014" or "E005b" or just "E14")
    const epicMatch = parent.match(/E0*(\d+)([a-z])?/i);
    if (!epicMatch)
        return null;
    const epicKey = epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
    const epic = getEpic(epicKey);
    return {
        epicId: epic?.id || `E${epicKey}`,
        epicKey,
        title: task.data?.title || `Task ${taskId}`
    };
}
/**
 * Build PRD index
 * @returns {Map<number, {num: number, id: string, dir: string, file: string, data: object}>}
 */
export function buildPrdIndex() {
    if (_prdIndex)
        return _prdIndex;
    _prdIndex = new Map();
    const duplicates = [];
    for (const prdDir of findPrdDirs()) {
        const dirname = path.basename(prdDir);
        // PRD-001-title → 1, PRD-012-foo → 12
        const match = dirname.match(/^PRD-0*(\d+)/i);
        if (!match)
            continue;
        const num = parseInt(match[1], 10);
        const idMatch = dirname.match(/^(PRD-\d+)/i);
        const id = idMatch ? idMatch[1] : `PRD-${num}`;
        // Find prd.md file
        const prdFile = path.join(prdDir, 'prd.md');
        const loaded = fs.existsSync(prdFile) ? loadFile(prdFile) : null;
        // Check for duplicate
        if (_prdIndex.has(num)) {
            duplicates.push({ num, existing: _prdIndex.get(num).dir, new: prdDir });
        }
        _prdIndex.set(num, {
            num,
            id,
            dir: prdDir,
            file: prdFile,
            data: loaded?.data || {}
        });
    }
    // Warn about duplicates
    if (duplicates.length > 0) {
        console.error(`⚠ Duplicate PRD numbers found:`);
        for (const d of duplicates) {
            console.error(`  PRD-${d.num}: ${d.existing} vs ${d.new}`);
        }
    }
    return _prdIndex;
}
/**
 * Get PRD by numeric ID (any format: 1, "1", "PRD-1", "PRD-001")
 * @returns {{num, id, dir, file, data}|null}
 */
export function getPrd(prdId) {
    const index = buildPrdIndex();
    // Extract number from various formats
    let num;
    if (typeof prdId === 'number') {
        num = prdId;
    }
    else {
        const match = String(prdId).match(/^(?:PRD-?)?0*(\d+)$/i);
        num = match ? parseInt(match[1], 10) : null;
    }
    if (num === null)
        return null;
    return index.get(num) || null;
}
/**
 * Get parent PRD for an epic
 * @param {string|number} epicId - Epic ID in any format
 * @returns {{prdId: string, prdNum: number}|null}
 */
export function getEpicPrd(epicId) {
    const epic = getEpic(epicId);
    if (!epic)
        return null;
    // Extract PRD from prdDir path
    const dirname = path.basename(epic.prdDir);
    const match = dirname.match(/^PRD-0*(\d+)/i);
    if (!match)
        return null;
    const prdNum = parseInt(match[1], 10);
    const prd = getPrd(prdNum);
    return {
        prdId: prd?.id || `PRD-${prdNum}`,
        prdNum
    };
}
/**
 * Build memory file index
 * Indexes E*.md and PRD-*.md files in memory directory
 * @returns {Map<string, {key: string, type: 'epic'|'prd', file: string}>}
 */
export function buildMemoryIndex() {
    if (_memoryIndex)
        return _memoryIndex;
    _memoryIndex = new Map();
    const memDir = getMemoryDir();
    if (!fs.existsSync(memDir))
        return _memoryIndex;
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
        const filePath = path.join(memDir, file);
        // Epic memory: E001.md, E0001.md, E001a.md
        const epicMatch = file.match(/^E0*(\d+)([a-z])?\.md$/i);
        if (epicMatch) {
            const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
            _memoryIndex.set(key, { key, type: 'epic', file: filePath });
            continue;
        }
        // PRD memory: PRD-001.md, PRD-1.md
        const prdMatch = file.match(/^PRD-0*(\d+)\.md$/i);
        if (prdMatch) {
            const key = 'PRD-' + prdMatch[1];
            _memoryIndex.set(key, { key, type: 'prd', file: filePath });
        }
    }
    return _memoryIndex;
}
/**
 * Get memory file by ID (any format: E14, E014, E0014, PRD-1, PRD-001)
 * @returns {{key, type, file}|null}
 */
export function getMemoryFile(id) {
    const index = buildMemoryIndex();
    // Epic format
    const epicMatch = String(id).match(/^E0*(\d+)([a-z])?$/i);
    if (epicMatch) {
        const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
        return index.get(key) || null;
    }
    // PRD format
    const prdMatch = String(id).match(/^PRD-?0*(\d+)$/i);
    if (prdMatch) {
        const key = 'PRD-' + prdMatch[1];
        return index.get(key) || null;
    }
    return null;
}
/**
 * Clear all caches (call after artefact changes)
 */
export function clearIndexCache() {
    _taskIndex = null;
    _epicIndex = null;
    _prdIndex = null;
    _memoryIndex = null;
}
