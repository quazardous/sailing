/**
 * Memory Manager
 *
 * Business logic for memory and log operations.
 * Manager layer: has access to config and state.
 *
 * Hierarchy: Task → Epic → PRD → Project
 * - Task logs: temporary, merged into epic
 * - Epic memory: curated tips/issues for epic scope
 * - PRD memory: cross-epic patterns, escalated by skill
 * - Project memory: architectural decisions, universal patterns
 */
import fs from 'fs';
import path from 'path';
import { getMemoryDir, resolvePlaceholders, resolvePath, getRepoRoot } from './core-manager.js';
import { getTaskEpic as artefactsGetTaskEpic, getEpicPrd as artefactsGetEpicPrd, getTasksForEpic as artefactsGetTasksForEpic, getMemoryFile } from './artefacts-manager.js';
import { normalizeId } from '../lib/normalize.js';
import { extractAllSections, findSection, editSection, parseMultiSectionInput, parseLogLevels, AGENT_RELEVANT_SECTIONS } from '../lib/memory-section.js';
// Re-export section functions
export { extractAllSections, findSection, editSection, parseMultiSectionInput, parseLogLevels, AGENT_RELEVANT_SECTIONS };
// ============================================================================
// Template Helpers (internal)
// ============================================================================
function getTemplatesDir() {
    const custom = resolvePath('templates');
    if (custom)
        return custom;
    const sailingRoot = resolvePlaceholders('^/');
    return path.join(sailingRoot, 'templates');
}
function loadTemplate(templateName) {
    const templatePath = path.join(getTemplatesDir(), templateName);
    if (fs.existsSync(templatePath)) {
        return fs.readFileSync(templatePath, 'utf8');
    }
    return null;
}
// ============================================================================
// Path Functions
// ============================================================================
export function getMemoryDirPath() {
    return getMemoryDir();
}
export function ensureMemoryDir() {
    const memDir = getMemoryDirPath();
    if (!fs.existsSync(memDir)) {
        fs.mkdirSync(memDir, { recursive: true });
    }
}
export function logFilePath(id) {
    return path.join(getMemoryDirPath(), `${normalizeId(id)}.log`);
}
export function prdMemoryFilePath(prdId) {
    return path.join(getMemoryDirPath(), `${normalizeId(prdId)}.md`);
}
export function projectMemoryFilePath() {
    const artefactsPath = resolvePath('artefacts') || resolvePlaceholders('${haven}/artefacts');
    return path.join(artefactsPath, 'MEMORY.md');
}
// ============================================================================
// EpicMemoryManager Class (POO Encapsulation)
// ============================================================================
/**
 * Epic-scoped memory operations.
 * Encapsulates epicId to avoid parameter repetition.
 *
 * @example
 * const epicMem = getEpicMemory('E001');
 * if (!epicMem.memoryExists()) epicMem.createMemory();
 * const content = epicMem.getLogContent();
 */
export class EpicMemoryManager {
    epicId;
    memoryDir;
    constructor(epicId) {
        this.epicId = normalizeId(epicId);
        this.memoryDir = getMemoryDir();
    }
    // --- Path accessors ---
    getMemoryPath() {
        return path.join(this.memoryDir, `${this.epicId}.md`);
    }
    getLogPath() {
        return path.join(this.memoryDir, `${this.epicId}.log`);
    }
    // --- Existence checks ---
    memoryExists() {
        return fs.existsSync(this.getMemoryPath());
    }
    logExists() {
        return fs.existsSync(this.getLogPath());
    }
    // --- Log operations ---
    getLogContent() {
        const logPath = this.getLogPath();
        if (!fs.existsSync(logPath))
            return null;
        return fs.readFileSync(logPath, 'utf8').trim();
    }
    deleteLog() {
        const logPath = this.getLogPath();
        if (fs.existsSync(logPath)) {
            fs.unlinkSync(logPath);
            return true;
        }
        return false;
    }
    // --- Memory file creation ---
    createMemory() {
        ensureMemoryDir();
        const mdPath = this.getMemoryPath();
        const now = new Date().toISOString();
        let content = loadTemplate('memory-epic.md');
        if (content) {
            content = content
                .replace(/E0000/g, this.epicId)
                .replace(/created: ''/g, `created: '${now}'`)
                .replace(/updated: ''/g, `updated: '${now}'`);
        }
        else {
            content = `---
epic: ${this.epicId}
created: '${now}'
updated: '${now}'
---

# Memory: ${this.epicId}

## Agent Context

## Escalation

## Changelog
`;
        }
        fs.writeFileSync(mdPath, content);
        return mdPath;
    }
    // --- Task log merging ---
    mergeTaskLogs(options = {}) {
        const tasksForEpic = findTasksForEpic(this.epicId);
        const result = {
            flushedCount: 0,
            totalEntries: 0,
            deletedEmpty: 0,
            epicLogFile: ''
        };
        if (tasksForEpic.length === 0) {
            return result;
        }
        ensureMemoryDir();
        result.epicLogFile = this.getLogPath();
        for (const task of tasksForEpic) {
            const taskLogFile = logFilePath(task.id);
            if (!fs.existsSync(taskLogFile))
                continue;
            const content = fs.readFileSync(taskLogFile, 'utf8').trim();
            if (!content) {
                if (!options.keep) {
                    fs.unlinkSync(taskLogFile);
                    result.deletedEmpty++;
                }
                continue;
            }
            const entries = content.split('\n').length;
            result.totalEntries += entries;
            const header = `\n### ${task.id}: ${task.title}\n`;
            fs.appendFileSync(result.epicLogFile, header + content + '\n');
            result.flushedCount++;
            if (!options.keep) {
                fs.unlinkSync(taskLogFile);
            }
        }
        return result;
    }
    // --- Agent memory (filtered for agents) ---
    getAgentMemory() {
        const parts = [];
        // 1. Epic memory
        const epicMemory = getMemoryFile(this.epicId);
        if (epicMemory && fs.existsSync(epicMemory.file)) {
            const content = fs.readFileSync(epicMemory.file, 'utf8');
            const sections = extractAllSections(content);
            const relevant = sections.filter(s => AGENT_RELEVANT_SECTIONS.includes(s.name));
            if (relevant.length > 0) {
                parts.push(`### Epic ${this.epicId}\n`);
                for (const sec of relevant) {
                    parts.push(`**${sec.name}**\n${sec.content}\n`);
                }
            }
        }
        // 2. PRD memory (if exists)
        const prd = artefactsGetEpicPrd(this.epicId);
        if (prd) {
            const prdMemoryPath = path.join(this.memoryDir, `${prd.prdId}.md`);
            if (fs.existsSync(prdMemoryPath)) {
                const content = fs.readFileSync(prdMemoryPath, 'utf8');
                const sections = extractAllSections(content);
                const relevant = sections.filter(s => AGENT_RELEVANT_SECTIONS.includes(s.name));
                if (relevant.length > 0) {
                    parts.push(`### PRD ${prd.prdId}\n`);
                    for (const sec of relevant) {
                        parts.push(`**${sec.name}**\n${sec.content}\n`);
                    }
                }
            }
        }
        // 3. Project memory (if exists)
        const repoRoot = getRepoRoot();
        const projectMemoryPath = repoRoot ? path.join(repoRoot, '.sailing', 'memory', 'PROJECT.md') : null;
        if (projectMemoryPath && fs.existsSync(projectMemoryPath)) {
            const content = fs.readFileSync(projectMemoryPath, 'utf8');
            const sections = extractAllSections(content);
            const relevant = sections.filter(s => AGENT_RELEVANT_SECTIONS.includes(s.name));
            if (relevant.length > 0) {
                parts.push(`### Project\n`);
                for (const sec of relevant) {
                    parts.push(`**${sec.name}**\n${sec.content}\n`);
                }
            }
        }
        return parts.length > 0 ? parts.join('\n') : null;
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create an EpicMemoryManager for an epic
 */
export function getEpicMemory(epicId) {
    return new EpicMemoryManager(epicId);
}
// ============================================================================
// Helper for EpicMemoryManager (internal)
// ============================================================================
function findTasksForEpic(epicId) {
    const tasks = artefactsGetTasksForEpic(epicId);
    return tasks.map(t => ({
        id: normalizeId(t.data?.id || t.id),
        title: t.data?.title || 'Untitled'
    }));
}
// ============================================================================
// Existence Checks
// ============================================================================
export function logFileExists(id) {
    return fs.existsSync(logFilePath(id));
}
export function prdMemoryExists(prdId) {
    return fs.existsSync(prdMemoryFilePath(prdId));
}
export function projectMemoryExists() {
    return fs.existsSync(projectMemoryFilePath());
}
// ============================================================================
// Log File Operations
// ============================================================================
export function readLogFile(id) {
    const filePath = logFilePath(id);
    if (!fs.existsSync(filePath))
        return null;
    return fs.readFileSync(filePath, 'utf8').trim();
}
export function appendLogFile(id, content) {
    ensureMemoryDir();
    fs.appendFileSync(logFilePath(id), content);
}
export function deleteLogFile(id) {
    const filePath = logFilePath(id);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
}
export function findLogFiles() {
    ensureMemoryDir();
    const memDir = getMemoryDirPath();
    return fs.readdirSync(memDir)
        .filter(f => f.endsWith('.log'))
        .map(f => {
        const id = f.replace('.log', '');
        return {
            id,
            type: id.startsWith('E') ? 'epic' : id.startsWith('T') ? 'task' : 'other',
            path: path.join(memDir, f)
        };
    });
}
export function hasPendingMemoryLogs() {
    const epicLogs = findLogFiles().filter(f => f.type === 'epic');
    for (const { id: epicId } of epicLogs) {
        const content = readLogFile(epicId);
        if (content)
            return true;
    }
    return false;
}
// ============================================================================
// Hierarchy Lookups
// ============================================================================
export function findTaskEpic(taskId) {
    const result = artefactsGetTaskEpic(taskId);
    if (!result)
        return null;
    return {
        epicId: normalizeId(result.epicId),
        title: result.title
    };
}
export function findEpicPrd(epicId) {
    const result = artefactsGetEpicPrd(epicId);
    if (!result)
        return null;
    return normalizeId(result.prdId);
}
// ============================================================================
// Memory File Creation
// ============================================================================
export function createPrdMemoryFile(prdId) {
    ensureMemoryDir();
    const mdPath = prdMemoryFilePath(prdId);
    const now = new Date().toISOString();
    let content = loadTemplate('memory-prd.md');
    if (content) {
        content = content
            .replace(/PRD-000/g, prdId)
            .replace(/created: ''/g, `created: '${now}'`)
            .replace(/updated: ''/g, `updated: '${now}'`);
    }
    else {
        content = `---
prd: ${prdId}
created: '${now}'
updated: '${now}'
---

# Memory: ${prdId}

## Cross-Epic Patterns

## Decisions

## Escalation
`;
    }
    fs.writeFileSync(mdPath, content);
    return mdPath;
}
export function createProjectMemoryFile(projectName = '') {
    const mdPath = projectMemoryFilePath();
    const dir = path.dirname(mdPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const now = new Date().toISOString();
    let content = loadTemplate('memory-dist.md');
    if (content) {
        content = content
            .replace(/project: ''/g, `project: '${projectName}'`)
            .replace(/updated: ''/g, `updated: '${now}'`);
    }
    else {
        content = `---
project: '${projectName}'
updated: '${now}'
---

# Project Memory

## Architecture Decisions

## Patterns & Conventions

## Lessons Learned
`;
    }
    fs.writeFileSync(mdPath, content);
    return mdPath;
}
// ============================================================================
// Hierarchical Memory
// ============================================================================
export function getHierarchicalMemory(id) {
    const result = { project: null, prd: null, epic: null };
    let epicId = null;
    if (id.startsWith('T')) {
        const taskInfo = findTaskEpic(id);
        if (taskInfo)
            epicId = taskInfo.epicId;
    }
    else if (id.startsWith('E')) {
        epicId = normalizeId(id);
    }
    if (epicId) {
        const epicMem = new EpicMemoryManager(epicId);
        if (epicMem.memoryExists()) {
            result.epic = {
                id: epicId,
                path: epicMem.getMemoryPath(),
                content: fs.readFileSync(epicMem.getMemoryPath(), 'utf8')
            };
        }
    }
    if (epicId) {
        const prdId = findEpicPrd(epicId);
        if (prdId && prdMemoryExists(prdId)) {
            result.prd = {
                id: prdId,
                path: prdMemoryFilePath(prdId),
                content: fs.readFileSync(prdMemoryFilePath(prdId), 'utf8')
            };
        }
    }
    if (projectMemoryExists()) {
        result.project = {
            id: 'PROJECT',
            path: projectMemoryFilePath(),
            content: fs.readFileSync(projectMemoryFilePath(), 'utf8')
        };
    }
    return result;
}
// ============================================================================
// Log Merging
// ============================================================================
export function mergeTaskLog(taskId, actualPath = null) {
    const taskLogPath = actualPath || logFilePath(taskId);
    if (!fs.existsSync(taskLogPath)) {
        return { merged: false, epicId: null, deleted: false };
    }
    const content = fs.readFileSync(taskLogPath, 'utf8').trim();
    if (!content) {
        fs.unlinkSync(taskLogPath);
        return { merged: false, epicId: null, deleted: true };
    }
    const taskNumMatch = taskId.match(/^T0*(\d+)$/i);
    const taskNum = taskNumMatch ? parseInt(taskNumMatch[1], 10) : null;
    let taskInfo = findTaskEpic(taskId);
    if (!taskInfo && taskNum !== null) {
        taskInfo = findTaskEpic(`T${taskNum}`);
    }
    if (!taskInfo) {
        return { merged: false, epicId: null, deleted: false };
    }
    const prefixedLines = content.split('\n').map(line => {
        return line.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) /, `$1 [${taskId}] `);
    }).join('\n');
    const epicLogPath = logFilePath(taskInfo.epicId);
    fs.appendFileSync(epicLogPath, prefixedLines + '\n');
    fs.unlinkSync(taskLogPath);
    return { merged: true, epicId: taskInfo.epicId, deleted: false };
}
export function checkPendingMemory(epicId = null) {
    const taskLogs = findLogFiles().filter(f => f.type === 'task');
    let tasksMerged = 0;
    for (const { id: taskId, path: taskPath } of taskLogs) {
        if (epicId) {
            const taskInfo = findTaskEpic(taskId);
            if (!taskInfo || taskInfo.epicId !== epicId)
                continue;
        }
        const result = mergeTaskLog(taskId, taskPath);
        if (result.merged)
            tasksMerged++;
    }
    let epicLogs = findLogFiles().filter(f => f.type === 'epic');
    if (epicId) {
        epicLogs = epicLogs.filter(f => f.id === normalizeId(epicId));
    }
    const pendingEpics = epicLogs
        .filter(({ id }) => readLogFile(id))
        .map(({ id }) => id);
    return {
        pending: pendingEpics.length > 0,
        epics: pendingEpics,
        tasksMerged
    };
}
export function countTaskTips(taskId) {
    const taskLog = readLogFile(taskId);
    if (!taskLog)
        return 0;
    const matches = taskLog.match(/\[TIP\]/g);
    return matches ? matches.length : 0;
}
export function getLogStats(id) {
    const content = readLogFile(id);
    if (!content) {
        return {
            exists: false,
            lines: 0,
            levels: { TIP: 0, INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 }
        };
    }
    return {
        exists: true,
        lines: content.split('\n').filter(l => l.trim()).length,
        levels: parseLogLevels(content)
    };
}
