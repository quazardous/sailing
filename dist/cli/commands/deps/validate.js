/**
 * Deps validate command
 */
import fs from 'fs';
import path from 'path';
import { loadFile, saveFile, jsonOut } from '../../managers/core-manager.js';
import { normalizeId, buildIdResolver } from '../../lib/normalize.js';
import { getAllEpics, matchesPrd } from '../../managers/artefacts-manager.js';
import { STATUS, normalizeStatus, isStatusDone, isStatusNotStarted, isStatusInProgress, isStatusCancelled } from '../../lib/lexicon.js';
import { buildDependencyGraph, detectCycles } from '../../managers/graph-manager.js';
import { withModifies } from '../../lib/help.js';
import { buildEpicDependencyMap, detectEpicCycles } from './helpers.js';
/**
 * Register deps:validate command
 */
export function registerValidateCommand(deps) {
    withModifies(deps.command('validate'), ['task'])
        .description('Check deps (cycles, missing refs, status) → use --fix to auto-correct')
        .option('--prd <id>', 'Filter by PRD')
        .option('--fix', 'Auto-fix issues')
        .option('--json', 'JSON output')
        .action((options) => {
        const { tasks, blocks } = buildDependencyGraph();
        const errors = [];
        const warnings = [];
        const fixes = [];
        const resolveTask = buildIdResolver(tasks.keys());
        const prdFilter = options.prd ? normalizeId(options.prd) : null;
        for (const [id, task] of tasks) {
            if (prdFilter && !task.prd?.includes(prdFilter))
                continue;
            // 1. Missing refs
            for (const blockerId of task.blockedBy) {
                if (!tasks.has(blockerId)) {
                    errors.push({
                        type: 'missing_ref',
                        task: id,
                        blocker: blockerId,
                        message: `${id}: blocked_by references non-existent task ${blockerId}`
                    });
                    if (options.fix) {
                        fixes.push({ task: id, file: task.file, action: 'remove_missing', blockerId });
                    }
                }
            }
            // 2. Self-references
            if (task.blockedBy.includes(id)) {
                errors.push({
                    type: 'self_ref',
                    task: id,
                    message: `${id}: blocked_by contains self-reference`
                });
                if (options.fix) {
                    fixes.push({ task: id, file: task.file, action: 'remove_self' });
                }
            }
            // 3. Duplicates
            const seen = new Set();
            const duplicates = [];
            for (const blockerId of task.blockedBy) {
                if (seen.has(blockerId))
                    duplicates.push(blockerId);
                seen.add(blockerId);
            }
            if (duplicates.length > 0) {
                warnings.push({
                    type: 'duplicate',
                    task: id,
                    message: `${id}: blocked_by contains duplicates: ${duplicates.join(', ')}`
                });
                if (options.fix) {
                    fixes.push({ task: id, file: task.file, action: 'remove_duplicates' });
                }
            }
            // 4. Format inconsistencies — resolve to canonical entry ID
            for (const raw of task.blockedByRaw) {
                const canonical = resolveTask(String(raw));
                if (canonical && raw !== canonical) {
                    warnings.push({
                        type: 'format',
                        task: id,
                        message: `${id}: blocked_by "${raw}" should be "${canonical}"`
                    });
                    if (options.fix) {
                        fixes.push({ task: id, file: task.file, action: 'normalize', raw: raw, normalized: canonical });
                    }
                }
            }
            // 5. Cancelled blockers
            for (const blockerId of task.blockedBy) {
                const blocker = tasks.get(blockerId);
                if (blocker && isStatusCancelled(blocker.status)) {
                    warnings.push({
                        type: 'cancelled_blocker',
                        task: id,
                        blocker: blockerId,
                        message: `${id}: blocked by cancelled task ${blockerId}`
                    });
                    if (options.fix) {
                        fixes.push({ task: id, file: task.file, action: 'remove_cancelled', blockerId });
                    }
                }
            }
            // 6. Invalid status
            const canonical = normalizeStatus(task.status, 'task');
            if (!canonical) {
                errors.push({
                    type: 'invalid_status',
                    task: id,
                    message: `${id}: Invalid status "${task.status}". Valid: ${STATUS.task.join(', ')}`
                });
            }
            else if (canonical !== task.status) {
                warnings.push({
                    type: 'status_format',
                    task: id,
                    message: `${id}: Status "${task.status}" should be "${canonical}"`
                });
                if (options.fix) {
                    fixes.push({ task: id, file: task.file, action: 'normalize_status', oldStatus: task.status, newStatus: canonical });
                }
            }
        }
        // 7. Task Cycles
        const cycles = detectCycles(tasks);
        for (const cycle of cycles) {
            errors.push({
                type: 'cycle',
                path: cycle,
                message: `Task cycle detected: ${cycle.join(' → ')}`
            });
        }
        // 7b. Epic dependency validation
        const epics = buildEpicDependencyMap();
        for (const [epicId, epic] of epics) {
            for (const blockerId of epic.blockedBy) {
                if (!epics.has(blockerId)) {
                    errors.push({
                        type: 'epic_missing_ref',
                        epic: epicId,
                        blocker: blockerId,
                        message: `${epicId}: blocked_by references non-existent epic ${blockerId}`
                    });
                    if (options.fix) {
                        fixes.push({ epic: epicId, file: epic.file, action: 'remove_epic_blocker', blockerId });
                    }
                }
            }
            if (epic.blockedBy.includes(epicId)) {
                errors.push({
                    type: 'epic_self_ref',
                    epic: epicId,
                    message: `${epicId}: blocked_by contains self-reference`
                });
                if (options.fix) {
                    fixes.push({ epic: epicId, file: epic.file, action: 'remove_epic_self_ref' });
                }
            }
        }
        // 7c. Epic cycles
        const epicCycles = detectEpicCycles(epics);
        for (const cycle of epicCycles) {
            errors.push({
                type: 'epic_cycle',
                path: cycle,
                message: `Epic cycle detected: ${cycle.join(' → ')}`
            });
        }
        // 8. Orphan tasks
        for (const [id, task] of tasks) {
            if (prdFilter && !task.prd?.includes(prdFilter))
                continue;
            const dependents = blocks.get(id) || [];
            if (dependents.length === 0 && task.blockedBy.length > 0 &&
                !isStatusDone(task.status) && !isStatusCancelled(task.status)) {
                warnings.push({
                    type: 'orphan',
                    task: id,
                    message: `${id}: Leaf task with dependencies (orphan)`
                });
            }
        }
        // 8b. Tasks without epic parent
        for (const [id, task] of tasks) {
            if (prdFilter && !task.prd?.includes(prdFilter))
                continue;
            if (!task.epic && !task.parent?.match(/E\d+/i)) {
                errors.push({
                    type: 'missing_epic',
                    task: id,
                    message: `${id}: Task has no epic parent (parent: ${task.parent || 'none'})`
                });
            }
        }
        // 9. ID mismatch
        for (const [id, task] of tasks) {
            if (prdFilter && !task.prd?.includes(prdFilter))
                continue;
            if (!task.file)
                continue;
            const actualFilename = path.basename(task.file, '.md');
            const filenameId = actualFilename.match(/^(T\d+)/)?.[1];
            if (filenameId && filenameId !== id) {
                errors.push({
                    type: 'id_mismatch',
                    task: id,
                    message: `${id}: Frontmatter ID doesn't match filename ID "${filenameId}"`
                });
                if (options.fix) {
                    const newFilename = actualFilename.replace(/^T\d+/, id);
                    fixes.push({ task: id, file: task.file, action: 'rename_file', oldName: actualFilename, newName: newFilename });
                }
            }
        }
        // 10. Epic/Task consistency
        const allEpics = getAllEpics();
        const resolveEpic = buildIdResolver(allEpics.map(e => e.id));
        const tasksByEpic = new Map();
        for (const [, task] of tasks) {
            if (prdFilter && !task.prd?.includes(prdFilter))
                continue;
            const epicMatch = task.parent?.match(/E(\d+)/i);
            if (epicMatch) {
                const epicId = resolveEpic(`E${epicMatch[1]}`) ?? `E${epicMatch[1]}`;
                if (!tasksByEpic.has(epicId))
                    tasksByEpic.set(epicId, []);
                (tasksByEpic.get(epicId)).push(task);
            }
        }
        for (const epicEntry of allEpics) {
            if (prdFilter && !matchesPrd(epicEntry.prdId, options.prd))
                continue;
            const epicId = epicEntry.id;
            if (!epicId)
                continue;
            const epicStatus = (epicEntry.data?.status) || 'Unknown';
            const epicTasks = (tasksByEpic.get(epicId) || []);
            if (epicTasks.length === 0)
                continue;
            const allDone = epicTasks.every(t => isStatusDone(t.status) || isStatusCancelled(t.status));
            const anyInProgress = epicTasks.some(t => isStatusInProgress(t.status));
            if (isStatusNotStarted(epicStatus) && (anyInProgress || allDone)) {
                warnings.push({
                    type: 'epic_status_mismatch',
                    epic: epicId,
                    message: `${epicId}: Status is "Not Started" but has tasks in progress or done`
                });
                if (options.fix) {
                    const newStatus = allDone ? 'Done' : 'In Progress';
                    fixes.push({ epic: epicId, file: epicEntry.file, action: 'update_epic_status', newStatus });
                }
            }
            if (isStatusInProgress(epicStatus) && allDone) {
                warnings.push({
                    type: 'epic_not_done',
                    epic: epicId,
                    message: `${epicId}: All ${epicTasks.length} tasks done but epic still "In Progress"`
                });
                if (options.fix) {
                    fixes.push({ epic: epicId, file: epicEntry.file, action: 'update_epic_status', newStatus: 'Done' });
                }
            }
            if (isStatusDone(epicStatus) && !allDone) {
                const notDone = (epicTasks).filter(t => !isStatusDone(t.status) && !isStatusCancelled(t.status));
                errors.push({
                    type: 'epic_done_prematurely',
                    epic: epicId,
                    message: `${epicId}: Marked "Done" but ${notDone.length} tasks incomplete`
                });
            }
        }
        // Apply fixes
        let fixedCount = 0;
        if (options.fix && fixes.length > 0) {
            const fileUpdates = new Map();
            for (const f of fixes) {
                if (!fileUpdates.has(f.file)) {
                    fileUpdates.set(f.file, { file: loadFile(f.file), fixes: [] });
                }
                fileUpdates.get(f.file).fixes.push(f);
            }
            for (const [filepath, { file, fixes: fileFixes }] of fileUpdates) {
                if (!file)
                    continue;
                let updated = false;
                for (const fix of fileFixes) {
                    if (!Array.isArray(file.data.blocked_by)) {
                        file.data.blocked_by = [];
                    }
                    switch (fix.action) {
                        case 'normalize': {
                            const idx = file.data.blocked_by.indexOf(fix.raw);
                            if (idx !== -1) {
                                file.data.blocked_by[idx] = fix.normalized;
                                updated = true;
                                fixedCount++;
                            }
                            break;
                        }
                        case 'remove_duplicates': {
                            const unique = [...new Set(file.data.blocked_by)];
                            if (unique.length !== file.data.blocked_by.length) {
                                file.data.blocked_by = unique;
                                updated = true;
                                fixedCount++;
                            }
                            break;
                        }
                        case 'remove_self': {
                            const filtered = file.data.blocked_by.filter(b => (resolveTask(b) ?? b) !== fix.task);
                            if (filtered.length !== file.data.blocked_by.length) {
                                file.data.blocked_by = filtered;
                                updated = true;
                                fixedCount++;
                            }
                            break;
                        }
                        case 'remove_missing':
                        case 'remove_cancelled': {
                            const filtered = file.data.blocked_by.filter(b => (resolveTask(b) ?? b) !== fix.blockerId);
                            if (filtered.length !== file.data.blocked_by.length) {
                                file.data.blocked_by = filtered;
                                updated = true;
                                fixedCount++;
                            }
                            break;
                        }
                        case 'normalize_status': {
                            if (file.data.status !== fix.newStatus) {
                                file.data.status = fix.newStatus;
                                updated = true;
                                fixedCount++;
                            }
                            break;
                        }
                        case 'update_epic_status': {
                            if (file.data.status !== fix.newStatus) {
                                file.data.status = fix.newStatus;
                                updated = true;
                                fixedCount++;
                            }
                            break;
                        }
                    }
                }
                if (updated) {
                    saveFile(filepath, file.data, file.body);
                    if (!options.json)
                        console.log(`Fixed: ${filepath}`);
                }
            }
            // Handle file renames
            for (const f of fixes) {
                if (f.action === 'rename_file') {
                    const dir = path.dirname(f.file);
                    const newPath = path.join(dir, `${f.newName}.md`);
                    if (f.file !== newPath && fs.existsSync(f.file)) {
                        fs.renameSync(f.file, newPath);
                        if (!options.json)
                            console.log(`Renamed: ${f.oldName}.md → ${f.newName}.md`);
                        fixedCount++;
                    }
                }
            }
        }
        if (options.json) {
            jsonOut({ errors, warnings, fixed: fixedCount });
            return;
        }
        console.log('=== Dependency Validation ===\n');
        if (errors.length === 0 && warnings.length === 0) {
            console.log('✓ All dependencies are valid\n');
            console.log(`Checked ${tasks.size} tasks`);
            return;
        }
        if (errors.length > 0) {
            console.log('ERRORS:');
            errors.forEach(e => console.log(`  ✗ ${e.message}`));
            console.log('');
        }
        if (warnings.length > 0) {
            console.log('WARNINGS:');
            warnings.forEach(w => console.log(`  ⚠ ${w.message}`));
            console.log('');
        }
        console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
        if (!options.fix && fixes.length > 0) {
            console.log(`\nUse --fix to auto-correct ${fixes.length} issue(s)`);
        }
        else if (options.fix && fixedCount > 0) {
            console.log(`\nFixed ${fixedCount} issue(s)`);
        }
    });
}
