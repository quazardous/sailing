/**
 * Garbage Collection commands for rudder CLI
 * Cleans orphaned havens, worktrees, and stale agent data
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { jsonOut, computeProjectHash, getAgentsDir, getWorktreesDir } from '../managers/core-manager.js';
import { getAllAgentsFromDb, deleteAgentFromDb, getAgentsArray } from '../managers/db-manager.js';
import { listAgentWorktrees, pruneWorktrees } from '../managers/worktree-manager.js';
import { getTask } from '../managers/artefacts-manager.js';
import { normalizeId } from '../lib/normalize.js';
import { checkPosts, formatPostOutput } from '../lib/guards.js';
/**
 * Get base havens directory (~/.sailing/havens)
 */
function getHavensBaseDir() {
    return path.join(os.homedir(), '.sailing', 'havens');
}
/**
 * Get list of all havens
 * @returns {Array<{ hash: string, path: string }>}
 */
function listHavens() {
    const havensDir = getHavensBaseDir();
    if (!fs.existsSync(havensDir)) {
        return [];
    }
    const havens = [];
    // Each directory in havens/ is a project hash
    for (const hash of fs.readdirSync(havensDir)) {
        const havenPath = path.join(havensDir, hash);
        if (fs.statSync(havenPath).isDirectory()) {
            havens.push({
                hash,
                path: havenPath,
                worktreesPath: path.join(havenPath, 'worktrees'),
                agentsPath: path.join(havenPath, 'agents'),
                runsPath: path.join(havenPath, 'runs'),
                assignmentsPath: path.join(havenPath, 'assignments')
            });
        }
    }
    return havens;
}
/**
 * Get stale agent entries (completed/failed/rejected more than N days ago)
 * @param {number} days - Age threshold in days
 * @returns {string[]} List of task IDs
 */
function getStaleAgents(days = 7) {
    const agents = getAgentsArray();
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return agents
        .filter((agent) => {
        // Check if terminal status
        const terminalStatus = ['collected', 'merged', 'reaped', 'completed', 'rejected', 'killed', 'error'];
        if (!terminalStatus.includes(agent.status))
            return false;
        // Check age
        const timestamp = agent.merged_at || agent.rejected_at || agent.completed_at || agent.killed_at;
        if (!timestamp)
            return false;
        return new Date(timestamp).getTime() < cutoff;
    })
        .map(agent => agent.taskId);
}
/**
 * Get stale db records (terminal status, no directories, or very old)
 */
function getStaleDbRecords(days = 30) {
    const agents = getAgentsArray();
    const agentsDir = getAgentsDir();
    const worktreesDir = getWorktreesDir();
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const terminalStatus = ['collected', 'merged', 'reaped', 'completed', 'rejected', 'killed', 'error'];
    return agents.filter((agent) => {
        // Skip records with invalid taskNum
        if (typeof agent.taskNum !== 'number' || isNaN(agent.taskNum))
            return false;
        // Must be in terminal status
        if (!terminalStatus.includes(agent.status))
            return false;
        // Check if directories still exist
        const agentDirExists = fs.existsSync(path.join(agentsDir, agent.taskId));
        const worktreeDirExists = fs.existsSync(path.join(worktreesDir, agent.taskId));
        // If no directories exist, it's stale
        if (!agentDirExists && !worktreeDirExists)
            return true;
        // Check age - if very old (> days), consider stale even with directories
        const timestamp = agent.merged_at || agent.rejected_at || agent.completed_at || agent.killed_at || agent.reaped_at;
        if (timestamp && new Date(timestamp).getTime() < cutoff)
            return true;
        return false;
    });
}
/**
 * GC agents action handler - exported for use as alias in agent:gc
 * Cleans both agent directories, worktree directories, and stale db records
 */
export async function gcAgentsAction(options) {
    const agentsDir = getAgentsDir();
    const worktreesDir = getWorktreesDir();
    const dbAgents = getAllAgentsFromDb();
    const dbAgentIds = new Set(Object.keys(dbAgents));
    // --no-worktree sets worktree to false, default is true
    const includeWorktrees = options.worktree !== false;
    // --no-db sets db to false, default is true
    const includeDbRecords = options.db !== false;
    const staleDays = options.days ?? 30;
    // Helper to get most recent date from agent metadata
    function getLastDate(agent) {
        const dates = [
            agent.merged_at,
            agent.completed_at,
            agent.killed_at,
            agent.rejected_at,
            agent.cleaned_at,
            agent.ended_at,
            agent.spawned_at,
            agent.started_at
        ].filter(Boolean).map(d => new Date(d).getTime());
        if (dates.length === 0)
            return undefined;
        const maxDate = new Date(Math.max(...dates));
        return maxDate.toISOString().split('T')[0]; // YYYY-MM-DD
    }
    // Collect all task IDs from directories (DIR → STATE direction)
    const taskIdsFromDirs = new Set();
    // Scan agent directories
    if (fs.existsSync(agentsDir)) {
        fs.readdirSync(agentsDir)
            .filter(d => d.match(/^T\d+$/i) && fs.statSync(path.join(agentsDir, d)).isDirectory())
            .forEach(d => taskIdsFromDirs.add(d));
    }
    // Scan worktree directories (if included)
    if (includeWorktrees && fs.existsSync(worktreesDir)) {
        fs.readdirSync(worktreesDir)
            .filter(d => d.match(/^T\d+$/i) && fs.statSync(path.join(worktreesDir, d)).isDirectory())
            .forEach(d => taskIdsFromDirs.add(d));
    }
    if (taskIdsFromDirs.size === 0) {
        if (options.json) {
            jsonOut({ orphaned: [], safe: [], unsafe: [] });
        }
        else {
            console.log('No agent or worktree directories found');
        }
        return;
    }
    const orphaned = [];
    const unsafeMode = options.unsafe === true;
    for (const dirName of taskIdsFromDirs) {
        const normalized = normalizeId(dirName) || dirName;
        const agent = dbAgents[normalized];
        const hasAgentDir = fs.existsSync(path.join(agentsDir, dirName));
        const hasWorktreeDir = includeWorktrees && fs.existsSync(path.join(worktreesDir, dirName));
        if (!agent) {
            // No agent in state - check if task file exists
            const taskFile = getTask(normalized);
            if (!taskFile) {
                orphaned.push({ taskId: dirName, normalized, hasAgentDir, hasWorktreeDir, safe: true });
            }
            else if (unsafeMode) {
                // --unsafe: delete even if task file exists
                orphaned.push({ taskId: dirName, normalized, hasAgentDir, hasWorktreeDir, safe: true, reason: 'unsafe mode' });
            }
            else {
                orphaned.push({ taskId: dirName, normalized, hasAgentDir, hasWorktreeDir, safe: false, reason: 'task file exists' });
            }
        }
        else if (includeWorktrees) {
            // Agent exists - check if terminal status (can clean worktree)
            const terminalStatus = ['collected', 'merged', 'reaped', 'completed', 'rejected', 'killed', 'error'];
            const isTerminal = terminalStatus.includes(agent.status);
            if (isTerminal && hasWorktreeDir) {
                // Agent is terminal, worktree can be cleaned
                const lastDate = getLastDate(agent);
                orphaned.push({ taskId: dirName, normalized, hasAgentDir: false, hasWorktreeDir, safe: true, reason: `agent ${agent.status}`, lastDate });
            }
            // else: agent active or no worktree dir to clean
        }
    }
    const safeOrphans = orphaned.filter(o => o.safe);
    const unsafeOrphans = orphaned.filter(o => !o.safe);
    // Get stale DB records (if included)
    const staleDbRecords = includeDbRecords ? getStaleDbRecords(staleDays) : [];
    if (options.json) {
        jsonOut({
            total_task_ids: taskIdsFromDirs.size,
            in_state: dbAgentIds.size,
            orphaned: orphaned.length,
            safe: safeOrphans.map(o => ({ taskId: o.taskId, agentDir: o.hasAgentDir, worktreeDir: o.hasWorktreeDir, reason: o.reason, lastDate: o.lastDate })),
            unsafe: unsafeOrphans.map(o => ({ taskId: o.taskId, reason: o.reason, lastDate: o.lastDate })),
            stale_db_records: staleDbRecords.map(r => ({
                taskId: r.taskId,
                status: r.status,
                date: r.merged_at || r.rejected_at || r.completed_at || r.killed_at || r.reaped_at
            }))
        });
        return;
    }
    console.log(`Task IDs found in directories: ${taskIdsFromDirs.size}`);
    console.log(`Agents in db: ${dbAgentIds.size}\n`);
    if (orphaned.length === 0 && staleDbRecords.length === 0) {
        console.log('No orphaned directories or stale db records');
        return;
    }
    if (safeOrphans.length > 0) {
        console.log(`✓ Safe to delete (${safeOrphans.length}):`);
        safeOrphans.forEach(o => {
            const dirs = [o.hasAgentDir ? 'agent' : '', o.hasWorktreeDir ? 'worktree' : ''].filter(Boolean).join('+');
            const hint = o.reason ? ` (${o.reason})` : '';
            const date = o.lastDate ? ` ${o.lastDate}` : '';
            console.log(`  ${o.taskId} [${dirs}]${hint}${date}`);
        });
    }
    // Post-prompts for unsafe orphans (via guards)
    const unsafeOrphanStrings = unsafeOrphans.map(o => {
        const dirs = [o.hasAgentDir ? 'agent' : '', o.hasWorktreeDir ? 'worktree' : ''].filter(Boolean).join('+');
        const date = o.lastDate ? ` ${o.lastDate}` : '';
        return `${o.taskId} [${dirs}] (${o.reason})${date}`;
    });
    const posts = await checkPosts('gc:cleanup', { unsafeOrphans: unsafeOrphanStrings }, process.cwd());
    const postOutput = formatPostOutput(posts);
    if (postOutput) {
        console.log('\n' + postOutput);
    }
    // Show stale DB records info
    if (includeDbRecords && staleDbRecords.length > 0) {
        console.log(`\n📋 Stale DB records (${staleDbRecords.length}):`);
        staleDbRecords.forEach(r => {
            const timestamp = r.merged_at || r.rejected_at || r.completed_at || r.killed_at || r.reaped_at;
            const date = timestamp ? new Date(timestamp).toISOString().split('T')[0] : '';
            console.log(`  ${r.taskId} [${r.status}] ${date}`);
        });
    }
    if (options.dryRun !== false) {
        console.log('\n[Dry run] Use --no-dry-run to delete safe orphans and db records');
        return;
    }
    // Prune git worktrees first (if worktrees included)
    if (includeWorktrees) {
        pruneWorktrees();
    }
    // Delete safe orphans
    let deletedAgents = 0;
    let deletedWorktrees = 0;
    let deletedDbRecords = 0;
    for (const orphan of safeOrphans) {
        if (orphan.hasAgentDir) {
            const dirPath = path.join(agentsDir, orphan.taskId);
            try {
                fs.rmSync(dirPath, { recursive: true });
                console.log(`Deleted agent dir: ${orphan.taskId}`);
                deletedAgents++;
            }
            catch (e) {
                console.error(`Failed to delete agent dir ${orphan.taskId}: ${e.message}`);
            }
        }
        if (orphan.hasWorktreeDir) {
            const dirPath = path.join(worktreesDir, orphan.taskId);
            try {
                fs.rmSync(dirPath, { recursive: true });
                console.log(`Deleted worktree dir: ${orphan.taskId}`);
                deletedWorktrees++;
            }
            catch (e) {
                console.error(`Failed to delete worktree dir ${orphan.taskId}: ${e.message}`);
            }
        }
    }
    // Delete stale DB records
    if (includeDbRecords) {
        for (const record of staleDbRecords) {
            try {
                await deleteAgentFromDb(record.taskNum);
                console.log(`Deleted db record: ${record.taskId}`);
                deletedDbRecords++;
            }
            catch (e) {
                console.error(`Failed to delete db record ${record.taskId}: ${e.message}`);
            }
        }
    }
    const summary = [];
    if (deletedAgents > 0)
        summary.push(`${deletedAgents} agent dir(s)`);
    if (deletedWorktrees > 0)
        summary.push(`${deletedWorktrees} worktree dir(s)`);
    if (deletedDbRecords > 0)
        summary.push(`${deletedDbRecords} db record(s)`);
    if (summary.length > 0) {
        console.log(`\nDeleted ${summary.join(', ')}`);
    }
    else {
        console.log('\nNothing to delete');
    }
    if (unsafeOrphans.length > 0) {
        console.log(`Skipped ${unsafeOrphans.length} unsafe task IDs`);
    }
}
/**
 * Register GC commands
 */
export function registerGcCommands(program) {
    const gc = program.command('gc');
    gc.description('Garbage collection: clean orphaned resources');
    // gc:haven
    gc.command('haven')
        .alias('havens')
        .description('Clean orphaned haven directories')
        .option('--dry-run', 'Show what would be cleaned without doing it')
        .option('--force', 'Skip confirmation')
        .option('--json', 'JSON output')
        .action((options) => {
        const havens = listHavens();
        if (havens.length === 0) {
            if (options.json) {
                jsonOut({ cleaned: 0, message: 'No havens found' });
            }
            else {
                console.log('No havens found');
            }
            return;
        }
        const currentHash = computeProjectHash();
        const orphaned = havens.filter(h => h.hash !== currentHash);
        if (options.json) {
            jsonOut({
                total_havens: havens.length,
                current_hash: currentHash,
                orphaned: orphaned.map(h => h.hash)
            });
            return;
        }
        console.log(`Found ${havens.length} haven(s)\n`);
        console.log(`Current project hash: ${currentHash}\n`);
        if (orphaned.length === 0) {
            console.log('No orphaned havens');
            return;
        }
        console.log(`Orphaned havens (${orphaned.length}):`);
        for (const haven of orphaned) {
            console.log(`  ${haven.hash}: ${haven.path}`);
        }
        if (options.dryRun) {
            console.log('\n[Dry run] Would remove above havens');
            return;
        }
        if (!options.force) {
            console.log('\nTo clean orphaned havens, use --force');
            return;
        }
        // Clean orphaned havens (remove entire haven directory)
        let cleaned = 0;
        for (const haven of orphaned) {
            try {
                if (fs.existsSync(haven.path)) {
                    fs.rmSync(haven.path, { recursive: true });
                    console.log(`Removed: ${haven.path}`);
                    cleaned++;
                }
            }
            catch (e) {
                console.error(`Failed to remove ${haven.hash}: ${e.message}`);
            }
        }
        console.log(`\nCleaned ${cleaned} haven(s)`);
    });
    // gc:worktrees
    gc.command('worktrees')
        .description('Prune git worktrees and optionally clean orphaned directories')
        .option('--dirs', 'Also clean orphaned worktree directories (not in state)')
        .option('--force', 'Actually delete orphaned directories (requires --dirs)')
        .option('--json', 'JSON output')
        .action((options) => {
        // Always prune git worktrees first
        pruneWorktrees();
        // List remaining agent worktrees
        const worktrees = listAgentWorktrees();
        if (!options.dirs) {
            // Simple mode: just prune git worktrees
            if (options.json) {
                jsonOut({ pruned: true, worktrees, count: worktrees.length });
                return;
            }
            console.log('Pruned orphaned git worktrees\n');
            if (worktrees.length === 0) {
                console.log('No agent worktrees remaining');
            }
            else {
                console.log(`Active agent worktrees (${worktrees.length}):`);
                worktrees.forEach(w => {
                    console.log(`  ${w.taskId}: ${w.path}`);
                });
            }
            return;
        }
        // --dirs mode: also clean orphaned directories
        const worktreesDir = getWorktreesDir();
        const dbAgents = getAllAgentsFromDb();
        if (!fs.existsSync(worktreesDir)) {
            if (options.json) {
                jsonOut({ pruned: true, orphaned: [], safe: [], unsafe: [] });
            }
            else {
                console.log('Pruned git worktrees. No worktrees directory.');
            }
            return;
        }
        // Read directories and check against state (DIR → STATE direction)
        const worktreeDirs = fs.readdirSync(worktreesDir).filter(d => d.match(/^T\d+$/i) && fs.statSync(path.join(worktreesDir, d)).isDirectory());
        const orphaned = [];
        for (const dirName of worktreeDirs) {
            const normalized = normalizeId(dirName) || dirName;
            const agent = dbAgents[normalized];
            if (!agent) {
                const taskFile = getTask(normalized);
                if (!taskFile) {
                    orphaned.push({ dir: dirName, normalized, safe: true });
                }
                else {
                    orphaned.push({ dir: dirName, normalized, safe: false, reason: 'task file exists, no agent' });
                }
            }
            else if (agent.worktree) {
                const terminalStatus = ['collected', 'merged', 'reaped', 'completed', 'rejected', 'killed', 'error'];
                const isTerminal = terminalStatus.includes(agent.status);
                if (isTerminal) {
                    orphaned.push({ dir: dirName, normalized, safe: true, reason: `agent ${agent.status}` });
                }
            }
        }
        const safeOrphans = orphaned.filter(o => o.safe);
        const unsafeOrphans = orphaned.filter(o => !o.safe);
        if (options.json) {
            jsonOut({
                pruned: true,
                total_dirs: worktreeDirs.length,
                agents_with_worktree: Object.values(dbAgents).filter(a => a.worktree).length,
                orphaned: orphaned.length,
                safe: safeOrphans.map(o => ({ dir: o.dir, reason: o.reason })),
                unsafe: unsafeOrphans.map(o => ({ dir: o.dir, reason: o.reason }))
            });
            return;
        }
        console.log('Pruned orphaned git worktrees\n');
        console.log(`Worktree directories: ${worktreeDirs.length}`);
        console.log(`Agents with worktree info: ${Object.values(dbAgents).filter(a => a.worktree).length}\n`);
        if (orphaned.length === 0) {
            console.log('No orphaned worktree directories');
            return;
        }
        if (safeOrphans.length > 0) {
            console.log(`✓ Safe to delete (${safeOrphans.length}):`);
            safeOrphans.forEach(o => {
                const hint = o.reason ? ` (${o.reason})` : '';
                console.log(`  ${o.dir}${hint}`);
            });
        }
        if (unsafeOrphans.length > 0) {
            console.log(`\n⚠ Unsafe (${unsafeOrphans.length}):`);
            unsafeOrphans.forEach(o => console.log(`  ${o.dir} (${o.reason})`));
        }
        if (!options.force) {
            console.log('\n[Dry run] Use --force to delete safe orphans');
            return;
        }
        // Delete safe orphan directories
        let deleted = 0;
        for (const orphan of safeOrphans) {
            const dirPath = path.join(worktreesDir, orphan.dir);
            try {
                fs.rmSync(dirPath, { recursive: true });
                console.log(`Deleted: ${orphan.dir}`);
                deleted++;
            }
            catch (e) {
                console.error(`Failed to delete ${orphan.dir}: ${e.message}`);
            }
        }
        console.log(`\nDeleted ${deleted} orphaned worktree directories`);
        if (unsafeOrphans.length > 0) {
            console.log(`Skipped ${unsafeOrphans.length} unsafe directories`);
        }
    });
    // gc:agents
    gc.command('agents')
        .description('Clean orphaned agent/worktree directories and stale db records')
        .option('--no-dry-run', 'Actually delete orphaned directories and db records')
        .option('--no-worktree', 'Skip worktree directory cleanup')
        .option('--no-db', 'Skip stale db record cleanup')
        .option('--days <n>', 'Age threshold for stale db records (default: 30)', parseInt)
        .option('--unsafe', 'Delete even if task file exists (for terminal agents)')
        .option('--json', 'JSON output')
        .action(gcAgentsAction);
    // gc:all (convenience command)
    gc.command('all')
        .description('Run all garbage collection tasks')
        .option('--dry-run', 'Show what would be cleaned without doing it')
        .option('--force', 'Skip confirmation for destructive operations')
        .option('--json', 'JSON output')
        .action(async (options) => {
        if (!options.json) {
            console.log('Running garbage collection...\n');
        }
        const results = {};
        // 1. Prune worktrees
        if (!options.json)
            console.log('=== Worktrees ===');
        pruneWorktrees();
        results.worktrees = 'pruned';
        if (!options.json)
            console.log('Pruned orphaned worktrees\n');
        // 2. Clean stale agents
        if (!options.json)
            console.log('=== Stale Agents ===');
        const staleIds = getStaleAgents(7);
        if (!options.dryRun && staleIds.length > 0) {
            for (const id of staleIds) {
                await deleteAgentFromDb(id);
            }
        }
        results.stale_agents = staleIds.length;
        if (!options.json) {
            console.log(`Cleaned ${staleIds.length} stale agent entries\n`);
        }
        // 3. Report orphaned havens (don't auto-delete without --force)
        if (!options.json)
            console.log('=== Orphaned Havens ===');
        const havens = listHavens();
        const currentHash = computeProjectHash();
        const orphaned = havens.filter(h => h.hash !== currentHash);
        results.orphaned_havens = orphaned.length;
        if (orphaned.length > 0 && options.force && !options.dryRun) {
            for (const haven of orphaned) {
                try {
                    if (fs.existsSync(haven.path)) {
                        fs.rmSync(haven.path, { recursive: true });
                    }
                }
                catch {
                    // Ignore errors
                }
            }
            if (!options.json)
                console.log(`Cleaned ${orphaned.length} orphaned havens`);
        }
        else if (orphaned.length > 0) {
            if (!options.json) {
                console.log(`Found ${orphaned.length} orphaned haven(s)`);
                console.log('Use gc:haven --force to clean');
            }
        }
        else {
            if (!options.json)
                console.log('No orphaned havens');
        }
        if (options.json) {
            jsonOut(results);
        }
        else {
            console.log('\nFor directory cleanup, run:');
            console.log('  gc:agents   # Orphaned agent + worktree directories');
        }
    });
}
