/**
 * Audit commands for rudder CLI
 *
 * Verify status consistency across tasks/epics/PRDs and fix inconsistencies.
 * Uses existing index functions from lib/index.ts for entity discovery.
 */
import { loadFile, saveFile, jsonOut } from '../managers/core-manager.js';
import { normalizeId } from '../lib/normalize.js';
import { isStatusDone, isStatusCancelled, isStatusInProgress, isStatusNotStarted, isStatusAutoDone, statusSymbol } from '../lib/lexicon.js';
import { addDynamicHelp } from '../lib/help.js';
import { buildTaskIndex, buildEpicIndex, buildPrdIndex } from '../managers/artefacts-manager.js';
// New status: Auto-Done = all children done, awaiting manual validation
const STATUS_AUTO_DONE = 'Auto-Done';
/**
 * Extract epic ID from parent field (e.g., "PRD-015 / E0093" -> "E0093")
 */
function extractEpicId(parent) {
    if (!parent)
        return null;
    const match = parent.match(/E(\d+)/i);
    return match ? normalizeId(`E${match[1]}`) : null;
}
/**
 * Extract PRD ID from parent field or prdDir
 */
function extractPrdId(prdDir) {
    const match = prdDir.match(/PRD-(\d+)/i);
    return match ? `PRD-${match[1].padStart(3, '0')}` : 'Unknown';
}
/**
 * Check if a status indicates work is done (Done or Cancelled)
 */
function isTerminalStatus(status) {
    return isStatusDone(status) || isStatusCancelled(status);
}
/**
 * Check if a status indicates work is ongoing (In Progress, Blocked, etc.)
 */
function isActiveStatus(status) {
    return isStatusInProgress(status) || status === 'Blocked';
}
/**
 * Build project structure using existing index functions
 */
function buildProjectStructure() {
    const taskIndex = buildTaskIndex();
    const epicIndex = buildEpicIndex();
    const prdIndex = buildPrdIndex();
    // Group epics by PRD
    const prdEpicsMap = new Map();
    for (const [, epic] of epicIndex) {
        const prdId = epic.prdId;
        if (!prdEpicsMap.has(prdId)) {
            prdEpicsMap.set(prdId, []);
        }
        prdEpicsMap.get(prdId).push({
            id: epic.id,
            status: epic.data?.status || 'Unknown',
            prdId,
            file: epic.file,
            tasks: []
        });
    }
    // Assign tasks to epics
    for (const [, task] of taskIndex) {
        const epicId = extractEpicId(task.data?.parent);
        if (!epicId)
            continue;
        const prdId = task.prdId;
        const epics = prdEpicsMap.get(prdId);
        if (!epics)
            continue;
        const parentEpic = epics.find(e => e.id === epicId);
        if (parentEpic) {
            parentEpic.tasks.push({
                id: task.id,
                status: task.data?.status || 'Unknown',
                epicId
            });
        }
    }
    // Build PRD list
    const prds = [];
    for (const [, prd] of prdIndex) {
        const prdId = prd.data?.id || extractPrdId(prd.dir);
        prds.push({
            id: prdId,
            status: prd.data?.status || 'Unknown',
            file: prd.file,
            epics: prdEpicsMap.get(prdId) || []
        });
    }
    return prds;
}
/**
 * Audit status consistency and return issues
 */
export function auditStatusConsistency() {
    const issues = [];
    const prds = buildProjectStructure();
    for (const prd of prds) {
        // Check each epic
        for (const epic of prd.epics) {
            if (epic.tasks.length === 0)
                continue; // Skip epics with no tasks
            const allTasksTerminal = epic.tasks.every(t => isTerminalStatus(t.status));
            const anyTaskActive = epic.tasks.some(t => isActiveStatus(t.status));
            // Issue: All tasks done but epic not Done/Auto-Done
            if (allTasksTerminal && !isTerminalStatus(epic.status) && !isStatusAutoDone(epic.status)) {
                issues.push({
                    type: 'epic-should-be-ready',
                    entity: 'epic',
                    id: epic.id,
                    prd: prd.id,
                    currentStatus: epic.status,
                    expectedStatus: STATUS_AUTO_DONE,
                    reason: `All ${epic.tasks.length} tasks are Done/Cancelled`,
                    file: epic.file
                });
            }
            // Issue: Tasks in progress but epic is Not Started
            if (anyTaskActive && isStatusNotStarted(epic.status)) {
                issues.push({
                    type: 'epic-should-be-in-progress',
                    entity: 'epic',
                    id: epic.id,
                    prd: prd.id,
                    currentStatus: epic.status,
                    expectedStatus: 'In Progress',
                    reason: `Has active tasks but epic is "${epic.status}"`,
                    file: epic.file
                });
            }
            // Issue: Epic is Done but has non-terminal tasks (pessimistic)
            if (isStatusDone(epic.status) && !allTasksTerminal) {
                const openTasks = epic.tasks.filter(t => !isTerminalStatus(t.status));
                issues.push({
                    type: 'epic-reopened',
                    entity: 'epic',
                    id: epic.id,
                    prd: prd.id,
                    currentStatus: epic.status,
                    expectedStatus: 'In Progress',
                    reason: `${openTasks.length} tasks still open: ${openTasks.map(t => t.id).join(', ')}`,
                    file: epic.file
                });
            }
        }
        // Check PRD status based on epics
        if (prd.epics.length === 0)
            continue;
        const allEpicsTerminal = prd.epics.every(e => isTerminalStatus(e.status));
        const anyEpicActive = prd.epics.some(e => isActiveStatus(e.status) || isStatusAutoDone(e.status));
        // Issue: All epics done but PRD not Done/Auto-Done
        if (allEpicsTerminal && !isTerminalStatus(prd.status) && !isStatusAutoDone(prd.status)) {
            issues.push({
                type: 'prd-should-be-ready',
                entity: 'prd',
                id: prd.id,
                prd: prd.id,
                currentStatus: prd.status,
                expectedStatus: STATUS_AUTO_DONE,
                reason: `All ${prd.epics.length} epics are Done/Cancelled`,
                file: prd.file
            });
        }
        // Issue: Epics in progress but PRD not started
        if (anyEpicActive && (isStatusNotStarted(prd.status) || prd.status === 'Draft' || prd.status === 'Approved')) {
            issues.push({
                type: 'prd-should-be-in-progress',
                entity: 'prd',
                id: prd.id,
                prd: prd.id,
                currentStatus: prd.status,
                expectedStatus: 'In Progress',
                reason: `Has active epics but PRD is "${prd.status}"`,
                file: prd.file
            });
        }
        // Issue: PRD is Done but has non-terminal epics (pessimistic)
        if (isStatusDone(prd.status) && !allEpicsTerminal) {
            const openEpics = prd.epics.filter(e => !isTerminalStatus(e.status));
            issues.push({
                type: 'prd-reopened',
                entity: 'prd',
                id: prd.id,
                prd: prd.id,
                currentStatus: prd.status,
                expectedStatus: 'In Progress',
                reason: `${openEpics.length} epics still open: ${openEpics.map(e => e.id).join(', ')}`,
                file: prd.file
            });
        }
    }
    return issues;
}
/**
 * Apply fixes based on mode
 */
function applyFixes(issues, mode) {
    let fixedCount = 0;
    for (const issue of issues) {
        let shouldFix = false;
        const newStatus = issue.expectedStatus;
        if (mode === 'optimistic') {
            // Mark as Auto-Done when all children are done, or In Progress when active
            shouldFix = issue.type === 'epic-should-be-ready' ||
                issue.type === 'prd-should-be-ready' ||
                issue.type === 'epic-should-be-in-progress' ||
                issue.type === 'prd-should-be-in-progress';
        }
        else if (mode === 'pessimistic') {
            // Reopen when children are still open
            shouldFix = issue.type === 'epic-reopened' ||
                issue.type === 'prd-reopened';
        }
        if (shouldFix) {
            const file = loadFile(issue.file);
            if (file?.data) {
                file.data.status = newStatus;
                saveFile(issue.file, file.data, file.body);
                fixedCount++;
                console.log(`  ✓ ${issue.id}: ${issue.currentStatus} → ${newStatus}`);
            }
        }
    }
    return fixedCount;
}
/**
 * Register audit commands
 */
export function registerAuditCommands(program) {
    const audit = program.command('audit').description('Audit project consistency');
    addDynamicHelp(audit, { entityType: 'audit' });
    // audit:status - Main audit command
    audit.command('status')
        .description('Verify status consistency across tasks/epics/PRDs')
        .option('--prd <id>', 'Filter to specific PRD')
        .option('--fix-optimistic', 'Auto-fix: mark epics/PRDs as Auto-Done when all children done')
        .option('--fix-pessimistic', 'Auto-fix: reopen epics/PRDs if children are still open')
        .option('--json', 'JSON output')
        .action((options) => {
        let issues = auditStatusConsistency();
        // Filter by PRD if specified
        if (options.prd) {
            const prdId = options.prd.toUpperCase();
            issues = issues.filter(i => i.prd.toUpperCase().includes(prdId));
        }
        // Group issues by type for display
        const optimisticIssues = issues.filter(i => i.type === 'epic-should-be-ready' ||
            i.type === 'prd-should-be-ready' ||
            i.type === 'epic-should-be-in-progress' ||
            i.type === 'prd-should-be-in-progress');
        const pessimisticIssues = issues.filter(i => i.type === 'epic-reopened' ||
            i.type === 'prd-reopened');
        if (options.json) {
            jsonOut({ issues, optimisticIssues, pessimisticIssues });
            return;
        }
        if (issues.length === 0) {
            console.log('✓ No status inconsistencies found.');
            return;
        }
        // Display issues
        console.log(`Found ${issues.length} status inconsistencies:\n`);
        if (optimisticIssues.length > 0) {
            console.log('── Should be advanced (--fix-optimistic) ──');
            for (const issue of optimisticIssues) {
                const arrow = `${issue.currentStatus} → ${issue.expectedStatus}`;
                console.log(`  ${issue.entity.toUpperCase()} ${issue.id} [${issue.prd}]: ${arrow}`);
                console.log(`    Reason: ${issue.reason}`);
            }
            console.log('');
        }
        if (pessimisticIssues.length > 0) {
            console.log('── Should be reopened (--fix-pessimistic) ──');
            for (const issue of pessimisticIssues) {
                const arrow = `${issue.currentStatus} → ${issue.expectedStatus}`;
                console.log(`  ${issue.entity.toUpperCase()} ${issue.id} [${issue.prd}]: ${arrow}`);
                console.log(`    Reason: ${issue.reason}`);
            }
            console.log('');
        }
        // Apply fixes if requested
        if (options.fixOptimistic) {
            console.log('── Applying optimistic fixes ──');
            const fixed = applyFixes(optimisticIssues, 'optimistic');
            console.log(`\nFixed ${fixed} issues.`);
        }
        else if (options.fixPessimistic) {
            console.log('── Applying pessimistic fixes ──');
            const fixed = applyFixes(pessimisticIssues, 'pessimistic');
            console.log(`\nFixed ${fixed} issues.`);
        }
        else {
            console.log('Hints:');
            if (optimisticIssues.length > 0) {
                console.log('  rudder audit:status --fix-optimistic  # Mark completed work as Auto-Done');
            }
            if (pessimisticIssues.length > 0) {
                console.log('  rudder audit:status --fix-pessimistic # Reopen prematurely closed items');
            }
        }
    });
    // audit:summary - Quick overview
    audit.command('summary')
        .description('Quick status summary of all PRDs')
        .option('--json', 'JSON output')
        .action((options) => {
        const prds = buildProjectStructure();
        const summary = prds.map(prd => {
            const taskStats = { total: 0, done: 0, inProgress: 0, notStarted: 0 };
            const epicStats = { total: prd.epics.length, done: 0, inProgress: 0, notStarted: 0, autoDone: 0 };
            for (const epic of prd.epics) {
                if (isStatusDone(epic.status))
                    epicStats.done++;
                else if (isStatusAutoDone(epic.status))
                    epicStats.autoDone++;
                else if (isStatusInProgress(epic.status))
                    epicStats.inProgress++;
                else if (isStatusNotStarted(epic.status))
                    epicStats.notStarted++;
                for (const task of epic.tasks) {
                    taskStats.total++;
                    if (isStatusDone(task.status))
                        taskStats.done++;
                    else if (isStatusInProgress(task.status))
                        taskStats.inProgress++;
                    else if (isStatusNotStarted(task.status))
                        taskStats.notStarted++;
                }
            }
            return {
                id: prd.id,
                status: prd.status,
                epics: epicStats,
                tasks: taskStats
            };
        });
        if (options.json) {
            jsonOut(summary);
            return;
        }
        for (const prd of summary) {
            const epicDoneCount = prd.epics.done + prd.epics.autoDone;
            const epicProgress = prd.epics.total > 0
                ? `${epicDoneCount}/${prd.epics.total} epics done${prd.epics.autoDone > 0 ? ` (${prd.epics.autoDone} auto)` : ''}`
                : 'no epics';
            const taskProgress = prd.tasks.total > 0
                ? `${prd.tasks.done}/${prd.tasks.total} tasks done`
                : 'no tasks';
            console.log(`${statusSymbol(prd.status)} ${prd.id} [${prd.status}]: ${epicProgress}, ${taskProgress}`);
        }
    });
}
