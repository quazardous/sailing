/**
 * Status command - Project overview
 */
import path from 'path';
import { findPrdDirs, loadFile, jsonOut } from '../../managers/core-manager.js';
import { buildDependencyGraph } from '../../managers/graph-manager.js';
import { getMainVersion, getMainComponentName } from '../../managers/version-manager.js';
import { isStatusDone, isStatusInProgress, isStatusNotStarted, statusSymbol } from '../../lib/lexicon.js';
/**
 * Register status command
 */
export function registerStatusCommand(program) {
    program.command('status')
        .description('Project overview (tasks by status, PRDs)')
        .option('--json', 'JSON output')
        .action((options) => {
        const { tasks } = buildDependencyGraph();
        const byStatus = { done: 0, inProgress: 0, notStarted: 0, blocked: 0, cancelled: 0 };
        let ready = 0;
        for (const [, task] of tasks) {
            if (isStatusDone(task.status))
                byStatus.done++;
            else if (isStatusInProgress(task.status))
                byStatus.inProgress++;
            else if (isStatusNotStarted(task.status)) {
                byStatus.notStarted++;
                const allBlockersDone = task.blockedBy.every(b => {
                    const blocker = tasks.get(b);
                    return !blocker || isStatusDone(blocker.status);
                });
                if (allBlockersDone)
                    ready++;
            }
            else if (task.status?.toLowerCase().includes('block'))
                byStatus.blocked++;
            else if (task.status?.toLowerCase().includes('cancel'))
                byStatus.cancelled++;
        }
        const prds = findPrdDirs().map(d => {
            const prdFile = path.join(d, 'prd.md');
            const file = loadFile(prdFile);
            return {
                id: file?.data?.id || path.basename(d).match(/PRD-\d+/)?.[0],
                title: file?.data?.title || '',
                status: file?.data?.status || 'Unknown'
            };
        });
        const mainVersion = getMainVersion();
        const output = {
            version: mainVersion,
            tasks: {
                total: tasks.size,
                ...byStatus,
                ready
            },
            prds: prds.length,
            prdList: prds
        };
        if (options.json) {
            jsonOut(output);
        }
        else {
            console.log(`${getMainComponentName()} v${mainVersion}\n`);
            console.log(`Tasks: ${tasks.size} total`);
            console.log(`  ✓ Done: ${byStatus.done}`);
            console.log(`  ● In Progress: ${byStatus.inProgress}`);
            console.log(`  ◌ Not Started: ${byStatus.notStarted} (${ready} ready)`);
            if (byStatus.blocked > 0)
                console.log(`  ✗ Blocked: ${byStatus.blocked}`);
            if (byStatus.cancelled > 0)
                console.log(`  ○ Cancelled: ${byStatus.cancelled}`);
            console.log(`\nPRDs: ${prds.length}`);
            prds.forEach(p => {
                console.log(`  ${statusSymbol(p.status)} ${p.id}: ${p.title}`);
            });
        }
    });
}
