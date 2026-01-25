/**
 * Agent manage commands: sync, clear, kill, conflicts
 */
import fs from 'fs';
import path from 'path';
import { jsonOut, resolvePlaceholders, getAgentConfig } from '../../managers/core-manager.js';
import { getGit } from '../../lib/git.js';
import { getAllAgentsFromDb, getAgentFromDb, saveAgentToDb, deleteAgentFromDb } from '../../managers/db-manager.js';
import { withModifies } from '../../lib/help.js';
import { buildConflictMatrix, suggestMergeOrder } from '../../managers/conflict-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { gcAgentsAction } from '../gc.js';
export function registerManageCommands(agent) {
    // agent:sync
    withModifies(agent.command('sync'), ['db'])
        .description('Sync db with actual worktrees/agents (recover from ghosts)')
        .action(async (options) => {
        const config = getAgentConfig();
        const havenPath = resolvePlaceholders('${haven}');
        const worktreesDir = path.join(havenPath, 'worktrees');
        const agentsDir = path.join(havenPath, 'agents');
        const agents = getAllAgentsFromDb();
        const changes = { added: [], updated: [], orphaned: [] };
        if (fs.existsSync(worktreesDir)) {
            const worktrees = fs.readdirSync(worktreesDir).filter(d => d.startsWith('T') && fs.statSync(path.join(worktreesDir, d)).isDirectory());
            for (const taskId of worktrees) {
                const worktreePath = path.join(worktreesDir, taskId);
                const agentDir = path.join(agentsDir, taskId);
                const missionFile = path.join(agentDir, 'mission.yaml');
                const logFile = path.join(agentDir, 'run.log');
                if (!agents[taskId]) {
                    const entry = {
                        status: 'orphaned',
                        recovered_at: new Date().toISOString(),
                        worktree: {
                            path: worktreePath,
                            branch: `task/${taskId}`
                        }
                    };
                    if (fs.existsSync(missionFile)) {
                        entry.mission_file = missionFile;
                    }
                    if (fs.existsSync(logFile)) {
                        entry.log_file = logFile;
                        try {
                            const logContent = fs.readFileSync(logFile, 'utf8');
                            if (logContent.includes('exit code: 0') || logContent.includes('Exit code: 0')) {
                                entry.status = 'completed';
                            }
                        }
                        catch { /* ignore */ }
                    }
                    const syncGit = getGit(worktreePath);
                    const syncStatus = await syncGit.status();
                    if (!syncStatus.isClean()) {
                        entry.dirty_worktree = true;
                        const syncAllFiles = [...syncStatus.modified, ...syncStatus.created, ...syncStatus.deleted, ...syncStatus.not_added];
                        entry.uncommitted_files = syncAllFiles.length;
                    }
                    if (!options.dryRun) {
                        await saveAgentToDb(taskId, entry);
                    }
                    changes.added.push({ taskId, status: entry.status });
                }
                else if (agents[taskId].status === 'spawned') {
                    const pid = agents[taskId].pid;
                    let isRunning = false;
                    if (pid) {
                        try {
                            process.kill(pid, 0);
                            isRunning = true;
                        }
                        catch { /* not running */ }
                    }
                    if (!isRunning) {
                        if (!options.dryRun) {
                            await saveAgentToDb(taskId, {
                                ...agents[taskId],
                                status: 'orphaned',
                                orphaned_at: new Date().toISOString(),
                                pid: undefined
                            });
                        }
                        changes.updated.push({ taskId, from: 'spawned', to: 'orphaned' });
                    }
                }
            }
        }
        for (const taskId of Object.keys(agents)) {
            const worktreePath = path.join(worktreesDir, taskId);
            if (!fs.existsSync(worktreePath) && agents[taskId].worktree) {
                changes.orphaned.push({ taskId, status: agents[taskId].status });
            }
        }
        if (options.json) {
            jsonOut({ changes, dry_run: options.dryRun });
        }
        else {
            const prefix = options.dryRun ? '[DRY-RUN] ' : '';
            if (changes.added.length > 0) {
                console.log(`${prefix}Added ${changes.added.length} orphaned agent(s):`);
                changes.added.forEach(c => console.log(`  + ${c.taskId}: ${c.status}`));
            }
            if (changes.updated.length > 0) {
                console.log(`${prefix}Updated ${changes.updated.length} agent(s):`);
                changes.updated.forEach(c => console.log(`  ~ ${c.taskId}: ${c.from} → ${c.to}`));
            }
            if (changes.orphaned.length > 0) {
                console.log(`${prefix}Orphaned entries (worktree missing):`);
                changes.orphaned.forEach(c => console.log(`  ? ${c.taskId}: ${c.status}`));
            }
            if (changes.added.length === 0 && changes.updated.length === 0 && changes.orphaned.length === 0) {
                console.log('DB is in sync with reality');
            }
        }
    });
    // agent:clear
    withModifies(agent.command('clear [task-id]'), ['db'])
        .description('Clear agent tracking (all or specific task)')
        .option('--force', 'Clear without confirmation')
        .action(async (taskId, options) => {
        const agents = getAllAgentsFromDb();
        const agentCount = Object.keys(agents).length;
        if (agentCount === 0) {
            console.log('No agents to clear');
            return;
        }
        if (taskId) {
            taskId = normalizeId(taskId, undefined, 'task');
            if (!agents[taskId]) {
                console.error(`No agent found for task: ${taskId}`);
                process.exit(1);
            }
            await deleteAgentFromDb(taskId);
            console.log(`Cleared agent: ${taskId}`);
        }
        else {
            // Clear all agents one by one
            for (const id of Object.keys(agents)) {
                await deleteAgentFromDb(id);
            }
            console.log(`Cleared ${agentCount} agent(s)`);
        }
    });
    // agent:kill
    withModifies(agent.command('kill <task-id>'), ['db'])
        .action(async (taskId, options) => {
        taskId = normalizeId(taskId, undefined, 'task');
        const agentInfo = getAgentFromDb(taskId);
        if (!agentInfo) {
            console.error(`No agent found for task: ${taskId}`);
            process.exit(1);
        }
        if (!agentInfo.pid) {
            console.error(`Agent ${taskId} has no running process`);
            console.error(`Status: ${agentInfo.status}`);
            process.exit(1);
        }
        const pid = agentInfo.pid;
        try {
            process.kill(pid, 'SIGTERM');
            console.log(`Sent SIGTERM to PID ${pid}`);
            setTimeout(() => {
                try {
                    process.kill(pid, 0);
                    process.kill(pid, 'SIGKILL');
                    console.log(`Sent SIGKILL to PID ${pid}`);
                }
                catch {
                    // Process already terminated
                }
            }, 5000);
        }
        catch (e) {
            if (e.code === 'ESRCH') {
                console.log(`Process ${pid} already terminated`);
            }
            else {
                console.error(`Error killing process: ${e.message}`);
            }
        }
        await saveAgentToDb(taskId, {
            ...agentInfo,
            pid: undefined,
            status: 'killed',
            killed_at: new Date().toISOString()
        });
        if (options.json) {
            jsonOut({
                task_id: taskId,
                pid,
                status: 'killed'
            });
        }
        else {
            console.log(`\nKilled: ${taskId}`);
            console.log('Worktree preserved for inspection');
            if (agentInfo.worktree) {
                console.log(`  Path: ${agentInfo.worktree.path}`);
            }
        }
    });
    // agent:conflicts
    agent.command('conflicts')
        .description('Show potential file conflicts between parallel agents')
        .option('--json', 'JSON output')
        .action(async (options) => {
        const conflictData = await buildConflictMatrix();
        if (options.json) {
            jsonOut(conflictData);
            return;
        }
        if (conflictData.agents.length === 0) {
            console.log('No active agents with worktrees');
            return;
        }
        if (conflictData.agents.length === 1) {
            console.log(`Only one active agent: ${conflictData.agents[0]}`);
            console.log('No conflicts possible with a single agent');
            return;
        }
        console.log(`Active agents: ${conflictData.agents.length}\n`);
        console.log('Modified files by agent:');
        for (const [taskId, files] of Object.entries(conflictData.filesByAgent)) {
            const fileList = files;
            console.log(`\n  ${taskId}:`);
            if (fileList.length === 0) {
                console.log('    (no changes)');
            }
            else {
                fileList.slice(0, 5).forEach(f => console.log(`    ${f}`));
                if (fileList.length > 5) {
                    console.log(`    ... and ${fileList.length - 5} more`);
                }
            }
        }
        console.log();
        if (!conflictData.hasConflicts) {
            console.log('✓ No conflicts detected');
            console.log('  All agents can be merged in any order');
        }
        else {
            console.log(`⚠ Conflicts detected: ${conflictData.conflicts.length}\n`);
            for (const conflict of conflictData.conflicts) {
                console.log(`  ${conflict.agents[0]} ↔ ${conflict.agents[1]} (${conflict.count} files)`);
                conflict.files.slice(0, 3).forEach(f => console.log(`    - ${f}`));
                if (conflict.files.length > 3) {
                    console.log(`    ... and ${conflict.files.length - 3} more`);
                }
            }
            const order = suggestMergeOrder(conflictData);
            console.log('\nSuggested merge order (merge one at a time):');
            order.forEach((id, i) => console.log(`  ${i + 1}. rudder agent:merge ${id}`));
        }
    });
    // agent:gc - alias for gc:agents
    agent.command('gc')
        .description('Alias for gc:agents - Clean orphaned directories and stale db records')
        .option('--no-dry-run', 'Actually delete orphaned directories and db records')
        .option('--no-worktree', 'Skip worktree directory cleanup')
        .option('--no-db', 'Skip stale db record cleanup')
        .option('--days <n>', 'Age threshold for stale db records (default: 30)', parseInt)
        .option('--unsafe', 'Delete even if task file exists (for terminal agents)')
        .option('--json', 'JSON output')
        .action(gcAgentsAction);
}
