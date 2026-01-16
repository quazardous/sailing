/**
 * Dashboard data fetching functions
 */
import fs from 'fs';
import path from 'path';
import { findFiles, loadFile, getMemoryDir } from '../../managers/core-manager.js';
import { buildPrdIndex, buildEpicIndex, buildTaskIndex } from '../../managers/artefacts-manager.js';
import { extractEpicId } from '../../lib/normalize.js';
/**
 * Get all PRDs with their epics and tasks using indexes
 */
export function getPrdsDataImpl() {
    const prdIndex = buildPrdIndex();
    const epicIndex = buildEpicIndex();
    const taskIndex = buildTaskIndex();
    const prds = [];
    for (const [, prd] of prdIndex) {
        const prdId = prd.data?.id || prd.id || `PRD-${prd.num}`;
        const prdDir = prd.dir;
        const prdEpics = [];
        let totalTasks = 0;
        let doneTasks = 0;
        for (const [, epic] of epicIndex) {
            if (epic.prdDir !== prdDir)
                continue;
            const epicId = epic.data?.id || `E${epic.key}`;
            const epicTasks = [];
            for (const [, task] of taskIndex) {
                if (task.prdDir !== prdDir)
                    continue;
                const taskParent = task.data?.parent || '';
                const taskEpicId = extractEpicId(taskParent);
                if (taskEpicId === epicId || taskEpicId === `E${epic.key}` ||
                    (taskEpicId && epic.key === taskEpicId.replace(/^E0*/, ''))) {
                    const taskLoaded = loadFile(task.file);
                    epicTasks.push({
                        id: task.data?.id || `T${task.key}`,
                        title: task.data?.title || 'Untitled',
                        status: task.data?.status || 'Draft',
                        description: taskLoaded?.body || '',
                        meta: task.data || {}
                    });
                    totalTasks++;
                    if (task.data?.status === 'Done')
                        doneTasks++;
                }
            }
            const epicLoaded = loadFile(epic.file);
            prdEpics.push({
                id: epicId,
                title: epic.data?.title || 'Untitled',
                status: epic.data?.status || 'Draft',
                description: epicLoaded?.body || '',
                meta: epic.data || {},
                tasks: epicTasks
            });
        }
        const prdLoaded = loadFile(prd.file);
        prds.push({
            id: prdId,
            title: prd.data?.title || 'Untitled',
            status: prd.data?.status || 'Draft',
            description: prdLoaded?.body || '',
            meta: prd.data || {},
            epics: prdEpics,
            totalTasks,
            doneTasks,
            progress: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
        });
    }
    return prds;
}
/**
 * Get blockers (blocked tasks/epics) using indexes
 */
export function getBlockersImpl() {
    const blockers = [];
    const epicIndex = buildEpicIndex();
    const taskIndex = buildTaskIndex();
    for (const [, epic] of epicIndex) {
        if (epic.data?.status === 'Blocked') {
            blockers.push({
                type: 'epic',
                id: epic.data?.id || `E${epic.key}`,
                title: epic.data?.title || 'Untitled',
                reason: epic.data?.blocked_reason || 'Unknown'
            });
        }
    }
    for (const [, task] of taskIndex) {
        if (task.data?.status === 'Blocked') {
            blockers.push({
                type: 'task',
                id: task.data?.id || `T${task.key}`,
                title: task.data?.title || 'Untitled',
                reason: task.data?.blocked_reason || 'Unknown'
            });
        }
    }
    return blockers;
}
/**
 * Get pending memory consolidations
 */
export function getPendingMemoryImpl() {
    const pending = [];
    try {
        const memoryDir = getMemoryDir();
        const logFiles = findFiles(memoryDir, '*.log');
        for (const logFile of logFiles) {
            const content = fs.readFileSync(logFile, 'utf8');
            if (content.trim()) {
                pending.push(path.basename(logFile, '.log'));
            }
        }
    }
    catch {
        // Memory dir might not exist
    }
    return pending;
}
/**
 * Get memory content for an entity
 */
export function getMemoryContent(entityId, type) {
    try {
        const memoryDir = getMemoryDir();
        const memoryFile = path.join(memoryDir, `${entityId}.md`);
        if (fs.existsSync(memoryFile)) {
            const loaded = loadFile(memoryFile);
            return loaded?.body || '';
        }
    }
    catch {
        // Memory might not exist
    }
    return '';
}
