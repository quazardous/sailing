/**
 * Worktree status commands (status, preflight)
 */
import { execSync } from 'child_process';
import { findProjectRoot, jsonOut } from '../../managers/core-manager.js';
import { getAllAgentsFromDb } from '../../managers/db-manager.js';
import { getAgentConfig } from '../../managers/core-manager.js';
import { getWorktreePath } from '../../managers/worktree-manager.js';
import { buildConflictMatrix, suggestMergeOrder } from '../../managers/conflict-manager.js';
import { diagnoseWorktreeState } from '../../lib/state-machine/index.js';
import { detectProvider } from '../../managers/pr-manager.js';
import { getMainBranchStatus, getPrStatus } from './helpers.js';
/**
 * Register worktree:status and worktree:preflight commands
 */
export function registerStatusCommands(worktree) {
    // worktree:status
    worktree.command('status')
        .description('Show status of all agent worktrees and PRs')
        .option('--json', 'JSON output')
        .action(async (options) => {
        const projectRoot = findProjectRoot();
        const agents = getAllAgentsFromDb();
        const config = getAgentConfig();
        const provider = config.pr_provider === 'auto' ? await detectProvider(projectRoot) : config.pr_provider;
        const mainStatus = await getMainBranchStatus(projectRoot);
        const worktrees = [];
        for (const [taskId, info] of Object.entries(agents)) {
            if (!info.worktree)
                continue;
            const worktreePath = getWorktreePath(taskId);
            const diagnosis = diagnoseWorktreeState(worktreePath, projectRoot, mainStatus.branch);
            const entry = {
                taskId,
                status: info.status,
                worktree: {
                    path: worktreePath,
                    exists: diagnosis.details.exists,
                    state: diagnosis.state,
                    branch: diagnosis.details.branch,
                    ahead: diagnosis.details.ahead,
                    behind: diagnosis.details.behind,
                    clean: diagnosis.details.clean,
                    conflicts: diagnosis.details.conflictFiles
                },
                pr: null
            };
            if (provider && info.pr_url) {
                entry.pr = { url: info.pr_url };
                const prStatus = (await getPrStatus(taskId, projectRoot, provider));
                if (prStatus) {
                    if (entry.pr && prStatus.state !== undefined) {
                        entry.pr.state = prStatus.state;
                    }
                    if (entry.pr && prStatus.mergeable !== undefined) {
                        entry.pr.mergeable = prStatus.mergeable;
                    }
                }
            }
            worktrees.push(entry);
        }
        const conflictMatrix = await buildConflictMatrix();
        const result = {
            main_branch: mainStatus,
            worktrees,
            conflicts: conflictMatrix.conflicts,
            provider
        };
        if (options.json) {
            jsonOut(result);
        }
        else {
            console.log('Worktree Git Status');
            console.log('(use `agent:status` to monitor agent lifecycle)\n');
            console.log('='.repeat(60));
            console.log(`\nMain branch: ${mainStatus.branch}`);
            if (!mainStatus.clean) {
                console.log(`  ⚠ ${mainStatus.uncommitted} uncommitted changes`);
            }
            if (mainStatus.behind > 0) {
                console.log(`  ⚠ ${mainStatus.behind} commits behind origin`);
            }
            if (mainStatus.ahead > 0) {
                console.log(`  ↑ ${mainStatus.ahead} commits ahead of origin`);
            }
            if (mainStatus.clean && mainStatus.upToDate) {
                console.log('  ✓ Clean and up-to-date');
            }
            console.log('\nGit Worktrees:');
            if (worktrees.length === 0) {
                console.log('  (empty)');
            }
            else {
                const gray = '\x1b[90m';
                const green = '\x1b[32m';
                const yellow = '\x1b[33m';
                const red = '\x1b[31m';
                const cyan = '\x1b[36m';
                const reset = '\x1b[0m';
                const dim = '\x1b[2m';
                const statusIconMap = {
                    'running': { icon: '[running]', color: green },
                    'spawned': { icon: '[spawned]', color: yellow },
                    'dispatched': { icon: '[dispatched]', color: yellow },
                    'completed': { icon: '[completed]', color: green },
                    'reaped': { icon: '[reaped]', color: green },
                    'failed': { icon: '[failed]', color: red },
                    'merged': { icon: '[merged]', color: green },
                    'conflict': { icon: '[conflict]', color: red }
                };
                for (let i = 0; i < worktrees.length; i++) {
                    const wt = worktrees[i];
                    const isLast = i === worktrees.length - 1;
                    const treeChar = isLast ? '└── ' : '├── ';
                    const statusInfo = statusIconMap[wt.status] || { icon: `[${wt.status || 'unknown'}]`, color: gray };
                    let line = `${gray}${treeChar}${reset}`;
                    line += `${statusInfo.color}${statusInfo.icon}${reset} `;
                    line += `${wt.taskId}`;
                    if (wt.worktree.branch) {
                        line += `  ${cyan}${wt.worktree.branch}${reset}`;
                    }
                    if (wt.worktree.ahead > 0)
                        line += `  ${green}↑${wt.worktree.ahead}${reset}`;
                    if (wt.worktree.behind > 0)
                        line += `  ${red}↓${wt.worktree.behind}${reset}`;
                    if (!wt.worktree.clean)
                        line += `  ${yellow}dirty${reset}`;
                    if (wt.pr)
                        line += `  ${dim}PR:${wt.pr.state || 'open'}${reset}`;
                    if (wt.worktree.exists && wt.worktree.path) {
                        try {
                            const lastCommit = execSync('LC_ALL=C git log -1 --format=%cr 2>/dev/null', { cwd: wt.worktree.path, encoding: 'utf-8' }).trim();
                            if (lastCommit) {
                                line += `  ${dim}(${lastCommit})${reset}`;
                            }
                        }
                        catch { /* ignore */ }
                    }
                    if (wt.worktree.conflicts?.length > 0) {
                        line += `  ${red}⚠ conflicts: ${wt.worktree.conflicts.join(', ')}${reset}`;
                    }
                    console.log(line);
                }
            }
            if (conflictMatrix.conflicts.length > 0) {
                console.log('\n⚠ Potential Conflicts:');
                for (const conflict of conflictMatrix.conflicts) {
                    console.log(`  ${conflict.agents[0]} ↔ ${conflict.agents[1]}: ${conflict.files.join(', ')}`);
                }
            }
        }
    });
    // worktree:preflight
    worktree.command('preflight')
        .description('Check if agent spawn is possible, report blockers')
        .option('--json', 'JSON output')
        .action(async (options) => {
        const projectRoot = findProjectRoot();
        const agents = getAllAgentsFromDb();
        const config = getAgentConfig();
        const provider = config.pr_provider === 'auto' ? await detectProvider(projectRoot) : config.pr_provider;
        const blockers = [];
        const warnings = [];
        const pendingMerges = [];
        const runningAgents = [];
        const mainStatus = await getMainBranchStatus(projectRoot);
        if (!mainStatus.clean) {
            blockers.push(`Main branch has ${mainStatus.uncommitted} uncommitted changes`);
        }
        if (mainStatus.behind > 0) {
            warnings.push(`Main branch is ${mainStatus.behind} commits behind origin (consider: git pull)`);
        }
        try {
            execSync('git rev-parse HEAD', { cwd: projectRoot, stdio: 'pipe' });
        }
        catch {
            blockers.push('No commits in repository (git worktree requires at least one commit)');
        }
        for (const [taskId, info] of Object.entries(agents)) {
            if (info.status === 'running') {
                runningAgents.push(taskId);
            }
            if (info.status === 'completed' && info.worktree) {
                pendingMerges.push({
                    taskId,
                    pr_url: info.pr_url || null,
                    commits: 0
                });
            }
        }
        const conflictMatrix = await buildConflictMatrix();
        if (conflictMatrix.hasConflicts) {
            warnings.push(`${conflictMatrix.conflicts.length} potential conflict(s) between running agents`);
        }
        const canSpawn = blockers.length === 0;
        let recommendedAction = null;
        if (!canSpawn) {
            if (blockers.some(b => b.includes('uncommitted'))) {
                recommendedAction = 'Escalate: uncommitted changes';
            }
            else if (blockers.some(b => b.includes('No commits'))) {
                recommendedAction = 'Escalate: repository needs initial commit';
            }
        }
        else if (pendingMerges.length > 0) {
            const mergeOrder = suggestMergeOrder(conflictMatrix);
            recommendedAction = `Consider merging: ${mergeOrder[0] || pendingMerges[0].taskId}`;
        }
        const mergeOrderResult = suggestMergeOrder(conflictMatrix);
        const result = {
            can_spawn: canSpawn,
            blockers,
            warnings,
            pending_merges: pendingMerges,
            running_agents: runningAgents,
            merge_order: mergeOrderResult,
            recommended_action: recommendedAction,
            provider
        };
        if (options.json) {
            jsonOut(result);
        }
        else {
            console.log('Spawn Preflight Check\n');
            console.log('='.repeat(50));
            if (canSpawn) {
                console.log('\n✓ Ready to spawn\n');
            }
            else {
                console.log('\n✗ Cannot spawn\n');
                console.log('Blockers:');
                for (const b of blockers) {
                    console.log(`  ✗ ${b}`);
                }
            }
            if (warnings.length > 0) {
                console.log('\nWarnings:');
                for (const w of warnings) {
                    console.log(`  ⚠ ${w}`);
                }
            }
            if (pendingMerges.length > 0) {
                console.log(`\nPending merges: ${pendingMerges.map(p => p.taskId).join(', ')}`);
            }
            if (runningAgents.length > 0) {
                console.log(`Running agents: ${runningAgents.join(', ')}`);
            }
            if (recommendedAction) {
                console.log(`\nRecommended: ${recommendedAction}`);
            }
        }
    });
}
