/**
 * Garbage Collection commands for rudder CLI
 * Cleans orphaned havens, worktrees, and stale agent data
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { findProjectRoot, jsonOut } from '../lib/core.js';
import { computeProjectHash } from '../lib/paths.js';
import { loadState, saveState } from '../lib/state.js';
import { listAgentWorktrees, pruneWorktrees } from '../lib/worktree.js';
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
 * Check if a project hash is valid (project still exists)
 * @param {string} hash - Project hash
 * @returns {{ valid: boolean, projectPath?: string }}
 */
function validateProjectHash(hash) {
    // The hash is first 12 chars of MD5 of project path
    // We can't reverse it, but we can check our current project
    const currentHash = computeProjectHash();
    if (hash === currentHash) {
        return { valid: true, projectPath: findProjectRoot() };
    }
    // For other hashes, we can't validate without a registry
    // Mark as potentially orphaned
    return { valid: false };
}
/**
 * Get stale agent entries (completed/failed/rejected more than N days ago)
 * @param {number} days - Age threshold in days
 * @returns {string[]} List of task IDs
 */
function getStaleAgents(days = 7) {
    const state = loadState();
    const agents = state.agents || {};
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return Object.entries(agents)
        .filter(([_, info]) => {
        const agentInfo = info;
        // Check if terminal status
        const terminalStatus = ['collected', 'merged', 'rejected', 'killed', 'error'];
        if (!terminalStatus.includes(agentInfo.status))
            return false;
        // Check age
        const timestamp = agentInfo.merged_at || agentInfo.rejected_at || agentInfo.completed_at || agentInfo.killed_at;
        if (!timestamp)
            return false;
        return new Date(timestamp).getTime() < cutoff;
    })
        .map(([id]) => id);
}
/**
 * Register GC commands
 */
export function registerGcCommands(program) {
    const gc = program.command('gc')
        .description('Garbage collection: clean orphaned resources');
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
    // gc:agents
    gc.command('agents')
        .description('Clean stale agent entries from state')
        .option('--days <n>', 'Age threshold in days (default: 7)', parseInt, 7)
        .option('--dry-run', 'Show what would be cleaned without doing it')
        .option('--json', 'JSON output')
        .action((options) => {
        const staleIds = getStaleAgents(options.days);
        if (options.json) {
            jsonOut({ stale_agents: staleIds, count: staleIds.length });
            return;
        }
        if (staleIds.length === 0) {
            console.log(`No stale agents (older than ${options.days} days)`);
            return;
        }
        console.log(`Stale agents (${staleIds.length}):`);
        staleIds.forEach(id => console.log(`  ${id}`));
        if (options.dryRun) {
            console.log('\n[Dry run] Would remove above entries from state');
            return;
        }
        const state = loadState();
        for (const id of staleIds) {
            delete state.agents[id];
        }
        saveState(state);
        console.log(`\nRemoved ${staleIds.length} stale agent entries`);
    });
    // gc:worktrees
    gc.command('worktrees')
        .description('Prune orphaned git worktrees')
        .option('--json', 'JSON output')
        .action((options) => {
        // First, run git worktree prune
        pruneWorktrees();
        // List remaining agent worktrees
        const worktrees = listAgentWorktrees();
        if (options.json) {
            jsonOut({ worktrees, count: worktrees.length });
            return;
        }
        console.log('Pruned orphaned worktrees\n');
        if (worktrees.length === 0) {
            console.log('No agent worktrees remaining');
        }
        else {
            console.log(`Active agent worktrees (${worktrees.length}):`);
            worktrees.forEach(w => {
                console.log(`  ${w.taskId}: ${w.path}`);
            });
        }
    });
    // gc:all (convenience command)
    gc.command('all')
        .description('Run all garbage collection tasks')
        .option('--dry-run', 'Show what would be cleaned without doing it')
        .option('--force', 'Skip confirmation for destructive operations')
        .option('--json', 'JSON output')
        .action((options) => {
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
            const state = loadState();
            for (const id of staleIds) {
                delete state.agents[id];
            }
            saveState(state);
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
    });
}
