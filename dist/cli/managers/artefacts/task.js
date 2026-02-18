/**
 * Task artefact operations
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, toKebab, loadTemplate, formatId, getFileTimestamps } from '../core-manager.js';
import { nextId } from '../state-manager.js';
import { extractIdKey } from '../../lib/artefacts.js';
import { normalizeId, extractEpicId } from '../../lib/normalize.js';
import { _taskIndex, setTaskIndex, clearCache } from './common.js';
import { getEpic } from './epic.js';
import { prdIdFromDir } from './prd.js';
// ============================================================================
// INDEX
// ============================================================================
/**
 * Build task index across all PRDs
 */
export function buildTaskIndex() {
    if (_taskIndex)
        return _taskIndex;
    const index = new Map();
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
            const loaded = loadFile(filePath);
            const status = loaded?.data?.status;
            if (index.has(key)) {
                const existingEntry = index.get(key);
                const existingStatus = existingEntry.data?.status;
                if (status !== 'Done' || existingStatus !== 'Done') {
                    duplicates.push({ key, existing: existingEntry.file, new: filePath });
                }
            }
            const timestamps = getFileTimestamps(filePath);
            index.set(key, {
                key,
                id,
                file: filePath,
                prdId: prdIdFromDir(prdDir),
                epicId: extractEpicId(loaded?.data?.parent),
                prdDir,
                data: loaded?.data || {},
                createdAt: timestamps.createdAt,
                modifiedAt: timestamps.modifiedAt
            });
        }
    }
    if (duplicates.length > 0) {
        console.error(`⚠ Duplicate task IDs found:`);
        for (const d of duplicates) {
            console.error(`  T${d.key}: ${d.existing} vs ${d.new}`);
        }
    }
    setTaskIndex(index);
    return index;
}
// ============================================================================
// GETTERS
// ============================================================================
/**
 * Get task by ID (any format: 39, "39", "39a", "T39", "T039", "T00039")
 */
export function getTask(taskId) {
    const index = buildTaskIndex();
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
 * Get all tasks matching optional filters
 */
export function getAllTasks(options = {}) {
    const index = buildTaskIndex();
    let tasks = [...index.values()];
    if (options.prdDir) {
        tasks = tasks.filter(t => t.prdDir === options.prdDir);
    }
    if (options.epicId) {
        const epicKey = String(options.epicId).replace(/^E0*/i, '').toLowerCase();
        tasks = tasks.filter(t => {
            const parent = t.data?.parent || '';
            const match = parent.match(/E0*(\d+)([a-z])?/i);
            if (!match)
                return false;
            const taskEpicKey = match[1] + (match[2] ? match[2].toLowerCase() : '');
            return taskEpicKey === epicKey;
        });
    }
    if (options.status) {
        const statuses = Array.isArray(options.status) ? options.status : [options.status];
        tasks = tasks.filter(t => statuses.includes(t.data?.status));
    }
    if (options.tags && options.tags.length > 0) {
        tasks = tasks.filter(t => {
            const taskTags = t.data?.tags || [];
            return options.tags.some(tag => taskTags.includes(tag));
        });
    }
    return tasks;
}
/**
 * Get all tasks for a specific epic
 */
export function getTasksForEpic(epicId) {
    return getAllTasks({ epicId: String(epicId) });
}
/**
 * Get parent epic for a task
 */
export function getTaskEpic(taskId) {
    const task = getTask(taskId);
    if (!task)
        return null;
    const parent = task.data?.parent;
    if (!parent)
        return null;
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
export function countTasks(options = {}) {
    return getAllTasks(options).length;
}
/**
 * Create a new task under an epic
 */
export function createTask(epicId, title, options = {}) {
    const epic = getEpic(epicId);
    if (!epic) {
        throw new Error(`Epic not found: ${epicId}`);
    }
    const prdDir = epic.prdDir;
    const dirname = path.basename(prdDir);
    const prdIdMatch = dirname.match(/^(PRD-\d+)/i);
    const prdId = prdIdMatch ? prdIdMatch[1] : dirname.split('-').slice(0, 2).join('-');
    const tasksDir = path.join(prdDir, 'tasks');
    if (!fs.existsSync(tasksDir)) {
        fs.mkdirSync(tasksDir, { recursive: true });
    }
    const num = nextId('task');
    const id = formatId('T', num);
    const filename = `${id}-${toKebab(title)}.md`;
    const taskPath = path.join(tasksDir, filename);
    const now = options.created_at || new Date().toISOString();
    const data = {
        id,
        title,
        status: 'Not Started',
        parent: `${prdId} / ${epic.id}`,
        assignee: '',
        blocked_by: [],
        stories: options.stories?.map(s => normalizeId(s)) || [],
        tags: options.tags?.map(t => toKebab(t)) || [],
        effort: '1h',
        priority: 'normal',
        target_versions: options.targetVersions || {},
        created_at: now,
        updated_at: now
    };
    let body = loadTemplate('task');
    if (body) {
        body = body.replace(/^---[\s\S]*?---\s*/, '');
    }
    else {
        body = `\n## Description\n\n[Add description]\n\n## Deliverables\n\n- [ ] [Deliverable 1]\n\n## Log\n`;
    }
    saveFile(taskPath, data, body);
    clearCache();
    return { id, title, parent: data.parent, file: taskPath };
}
/**
 * Add a dependency between tasks
 */
export function addTaskDependency(taskId, blockedBy) {
    const task = getTask(taskId);
    if (!task) {
        return { taskId: normalizeId(taskId) ?? taskId, blockedBy: normalizeId(blockedBy) ?? blockedBy, added: false, message: `Task not found: ${taskId}` };
    }
    const blocker = getTask(blockedBy);
    if (!blocker) {
        return { taskId: task.id, blockedBy: normalizeId(blockedBy) ?? blockedBy, added: false, message: `Blocker task not found: ${blockedBy}` };
    }
    const file = loadFile(task.file);
    if (!file) {
        return { taskId: task.id, blockedBy: blocker.id, added: false, message: `Could not load task file` };
    }
    if (!Array.isArray(file.data.blocked_by)) {
        file.data.blocked_by = [];
    }
    if (file.data.blocked_by.includes(blocker.id)) {
        return { taskId: task.id, blockedBy: blocker.id, added: false, message: `Dependency already exists` };
    }
    file.data.blocked_by.push(blocker.id);
    saveFile(task.file, file.data, file.body);
    clearCache();
    return { taskId: task.id, blockedBy: blocker.id, added: true, message: `Added: ${task.id} blocked by ${blocker.id}` };
}
