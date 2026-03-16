/**
 * Status Manager
 *
 * Handles status transition orchestration for entities.
 * Business logic for auto-escalation and cascading status updates.
 *
 * - Task starts → Epic/PRD auto-escalate to "In Progress"
 * - Task completes → Epic auto-done check → PRD auto-done check
 */
import path from 'path';
import { loadFile, saveFile, findPrdDirs } from './core-manager.js';
import { normalizeId, matchesPrdDir, isSameId } from '../lib/normalize.js';
import { getStore } from './artefacts-manager.js';
import { isStatusDone, isStatusNotStarted, isStatusCancelled, isStatusAutoDone, isStatusDraft, isStatusReviewed, isStatusBreakdown, statusEquals } from '../lib/lexicon.js';
import { buildDependencyGraph } from './graph-manager.js';
/**
 * Find an epic file by ID
 */
function findEpicFile(epicId) {
    return getStore().getEpic(epicId)?.file || null;
}
/**
 * Find PRD file from parent string
 */
function findPrdFile(parent) {
    const prdMatch = parent ? /PRD-(\d+)/i.exec(parent) : null;
    if (!prdMatch)
        return null;
    const prdId = `PRD-${prdMatch[1].padStart(3, '0')}`;
    const prdDir = findPrdDirs().find(d => matchesPrdDir(d, prdId));
    if (!prdDir)
        return null;
    return {
        prdId,
        prdFile: path.join(prdDir, 'prd.md'),
        prdDir
    };
}
/**
 * Check if a status is before Breakdown (should escalate to Breakdown)
 */
function isPreBreakdownStatus(status) {
    return isStatusNotStarted(status) || isStatusDraft(status)
        || isStatusReviewed(status)
        || statusEquals(status, 'approved') || statusEquals(status, 'inreview');
}
/**
 * Check if a status is a pre-progress state (should escalate to In Progress)
 */
function isPreProgressStatus(status) {
    return isPreBreakdownStatus(status) || isStatusBreakdown(status);
}
/**
 * Auto-escalate Epic to "In Progress" when a task starts
 * Only escalates if Epic is in a pre-progress status
 */
export function escalateEpicToInProgress(epicId) {
    const epicFile = findEpicFile(epicId);
    if (!epicFile) {
        return { updated: false, entityId: epicId, message: 'Epic not found' };
    }
    const epicData = loadFile(epicFile);
    if (!epicData?.data) {
        return { updated: false, entityId: epicId, message: 'Could not load epic' };
    }
    if (!isPreProgressStatus(epicData.data.status)) {
        return { updated: false, entityId: epicId, message: 'Epic already started' };
    }
    const previousStatus = epicData.data.status;
    epicData.data.status = 'In Progress';
    saveFile(epicFile, epicData.data, epicData.body);
    return {
        updated: true,
        entityId: epicId,
        previousStatus: previousStatus,
        newStatus: 'In Progress',
        message: `Epic ${epicId} → In Progress`
    };
}
/**
 * Auto-escalate PRD to "In Progress" when a task starts
 * Only escalates if PRD is in Draft, Approved, or not started status
 */
export function escalatePrdToInProgress(parent) {
    const prdInfo = findPrdFile(parent);
    if (!prdInfo) {
        return { updated: false, entityId: 'unknown', message: 'PRD not found' };
    }
    const { prdId, prdFile } = prdInfo;
    const prdData = loadFile(prdFile);
    if (!prdData?.data) {
        return { updated: false, entityId: prdId, message: 'Could not load PRD' };
    }
    const status = prdData.data.status;
    if (!isPreProgressStatus(status)) {
        return { updated: false, entityId: prdId, message: 'PRD already in progress' };
    }
    const previousStatus = status;
    prdData.data.status = 'In Progress';
    saveFile(prdFile, prdData.data, prdData.body);
    return {
        updated: true,
        entityId: prdId,
        previousStatus: previousStatus,
        newStatus: 'In Progress',
        message: `PRD ${prdId} → In Progress`
    };
}
/**
 * Auto-escalate both Epic and PRD when a task starts
 * Returns results for each entity that was updated
 */
export function escalateOnTaskStart(taskData) {
    const result = {};
    // Extract Epic ID from parent
    const epicMatch = taskData.parent ? /E(\d+)/i.exec(taskData.parent) : null;
    if (epicMatch) {
        const epicId = normalizeId(`E${epicMatch[1]}`);
        result.epic = escalateEpicToInProgress(epicId);
    }
    // Extract PRD ID from parent
    if (taskData.parent) {
        result.prd = escalatePrdToInProgress(taskData.parent);
    }
    return result;
}
/**
 * Auto-escalate Epic to "Breakdown" when a task is created under it
 * Only escalates if Epic is in a pre-breakdown status
 */
export function escalateEpicToBreakdown(epicId) {
    const epicFile = findEpicFile(epicId);
    if (!epicFile) {
        return { updated: false, entityId: epicId, message: 'Epic not found' };
    }
    const epicData = loadFile(epicFile);
    if (!epicData?.data) {
        return { updated: false, entityId: epicId, message: 'Could not load epic' };
    }
    if (!isPreBreakdownStatus(epicData.data.status)) {
        return { updated: false, entityId: epicId, message: 'Epic already at or past Breakdown' };
    }
    const previousStatus = epicData.data.status;
    epicData.data.status = 'Breakdown';
    saveFile(epicFile, epicData.data, epicData.body);
    return {
        updated: true,
        entityId: epicId,
        previousStatus,
        newStatus: 'Breakdown',
        message: `Epic ${epicId} → Breakdown`
    };
}
/**
 * Auto-escalate PRD to "Breakdown" when an epic is created under it
 * Only escalates if PRD is in a pre-breakdown status
 */
export function escalatePrdToBreakdown(parent) {
    const prdInfo = findPrdFile(parent);
    if (!prdInfo) {
        return { updated: false, entityId: 'unknown', message: 'PRD not found' };
    }
    const { prdId, prdFile } = prdInfo;
    const prdData = loadFile(prdFile);
    if (!prdData?.data) {
        return { updated: false, entityId: prdId, message: 'Could not load PRD' };
    }
    const status = prdData.data.status;
    if (!isPreBreakdownStatus(status)) {
        return { updated: false, entityId: prdId, message: 'PRD already at or past Breakdown' };
    }
    const previousStatus = status;
    prdData.data.status = 'Breakdown';
    saveFile(prdFile, prdData.data, prdData.body);
    return {
        updated: true,
        entityId: prdId,
        previousStatus,
        newStatus: 'Breakdown',
        message: `PRD ${prdId} → Breakdown`
    };
}
/**
 * Auto-escalate parent to "Breakdown" when a child artefact is created
 * - Creating a task → escalates parent epic to Breakdown
 * - Creating an epic → escalates parent PRD to Breakdown
 */
export function escalateOnChildCreate(childType, parent) {
    const result = {};
    if (childType === 'task') {
        const epicMatch = /E(\d+)/i.exec(parent);
        if (epicMatch) {
            const epicId = normalizeId(`E${epicMatch[1]}`);
            result.epic = escalateEpicToBreakdown(epicId);
        }
    }
    else if (childType === 'epic') {
        result.prd = escalatePrdToBreakdown(parent);
    }
    return result;
}
/**
 * Check if all tasks in an epic are done/cancelled
 */
function areAllEpicTasksDone(epicId, currentTaskId) {
    const { tasks } = buildDependencyGraph();
    // Find all tasks for this epic
    const epicTasks = [...tasks.values()].filter(t => {
        const taskEpicRaw = t.parent ? /E\d+/i.exec(t.parent)?.[0] : null;
        return taskEpicRaw ? isSameId(taskEpicRaw, epicId) : false;
    });
    if (epicTasks.length === 0)
        return false;
    return epicTasks.every(t => isStatusDone(t.status) ||
        isStatusCancelled(t.status) ||
        (currentTaskId && t.id === normalizeId(currentTaskId)));
}
/**
 * Check if all epics in a PRD are done/cancelled
 */
function areAllPrdEpicsDone(prdDir) {
    // Find PRD from prdDir
    const prdDirname = path.basename(prdDir);
    const prdMatch = /^PRD-0*(\d+)/i.exec(prdDirname);
    if (!prdMatch)
        return false;
    const epics = getStore().getEpicsForPrd(parseInt(prdMatch[1], 10));
    if (epics.length === 0)
        return false;
    return epics.every(epic => isStatusDone(epic.data?.status) || isStatusCancelled(epic.data?.status));
}
/**
 * Update Epic to Auto-Done if all tasks are complete
 */
export function checkAndUpdateEpicAutoDone(epicId, currentTaskId) {
    if (!areAllEpicTasksDone(epicId, currentTaskId)) {
        return { updated: false, entityId: epicId, message: 'Not all tasks are done' };
    }
    const epicFile = findEpicFile(epicId);
    if (!epicFile) {
        return { updated: false, entityId: epicId, message: 'Epic not found' };
    }
    const epicData = loadFile(epicFile);
    if (!epicData?.data) {
        return { updated: false, entityId: epicId, message: 'Could not load epic' };
    }
    if (isStatusDone(epicData.data.status) || isStatusAutoDone(epicData.data.status)) {
        return { updated: false, entityId: epicId, message: 'Epic already done' };
    }
    const previousStatus = epicData.data.status;
    epicData.data.status = 'Auto-Done';
    saveFile(epicFile, epicData.data, epicData.body);
    return {
        updated: true,
        entityId: epicId,
        previousStatus: previousStatus,
        newStatus: 'Auto-Done',
        message: `Epic ${epicId} → Auto-Done (to be reviewed for completion)`
    };
}
/**
 * Update PRD to Auto-Done if all epics are complete
 */
export function checkAndUpdatePrdAutoDone(parent) {
    const prdInfo = findPrdFile(parent);
    if (!prdInfo) {
        return { updated: false, entityId: 'unknown', message: 'PRD not found' };
    }
    const { prdId, prdFile, prdDir } = prdInfo;
    if (!areAllPrdEpicsDone(prdDir)) {
        return { updated: false, entityId: prdId, message: 'Not all epics are done' };
    }
    const prdData = loadFile(prdFile);
    if (!prdData?.data) {
        return { updated: false, entityId: prdId, message: 'Could not load PRD' };
    }
    if (isStatusDone(prdData.data.status) || isStatusAutoDone(prdData.data.status)) {
        return { updated: false, entityId: prdId, message: 'PRD already done' };
    }
    const previousStatus = prdData.data.status;
    prdData.data.status = 'Auto-Done';
    saveFile(prdFile, prdData.data, prdData.body);
    return {
        updated: true,
        entityId: prdId,
        previousStatus: previousStatus,
        newStatus: 'Auto-Done',
        message: `PRD ${prdId} → Auto-Done (to be reviewed for completion)`
    };
}
/**
 * Cascade task completion: check and update Epic then PRD
 * Call this after a task is marked as Done
 */
export function cascadeTaskCompletion(taskId, taskData) {
    const result = {
        task: { updated: true, entityId: taskId, newStatus: 'Done' }
    };
    // Extract Epic ID from parent
    const epicMatch = taskData.parent ? /E(\d+)/i.exec(taskData.parent) : null;
    if (!epicMatch)
        return result;
    const epicId = normalizeId(`E${epicMatch[1]}`);
    // Check if Epic should be Auto-Done
    result.epic = checkAndUpdateEpicAutoDone(epicId, taskId);
    // If Epic was updated to Auto-Done, check PRD
    if (result.epic.updated && taskData.parent) {
        result.prd = checkAndUpdatePrdAutoDone(taskData.parent);
        // If PRD wasn't auto-done, check if it should be In Progress
        if (!result.prd.updated) {
            const prdInfo = findPrdFile(taskData.parent);
            if (prdInfo) {
                const prdData = loadFile(prdInfo.prdFile);
                if (prdData?.data) {
                    const status = prdData.data.status;
                    if (isPreProgressStatus(status)) {
                        prdData.data.status = 'In Progress';
                        saveFile(prdInfo.prdFile, prdData.data, prdData.body);
                        result.prd = {
                            updated: true,
                            entityId: prdInfo.prdId,
                            previousStatus: status,
                            newStatus: 'In Progress',
                            message: `PRD ${prdInfo.prdId} → In Progress`
                        };
                    }
                }
            }
        }
    }
    return result;
}
