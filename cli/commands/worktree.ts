/**
 * Worktree commands for rudder CLI
 * Manages git worktrees for parallel agent execution
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { findProjectRoot, jsonOut } from '../lib/core.js';
import { loadState, saveState } from '../lib/state.js';
import { getAgentConfig, getGitConfig } from '../lib/config.js';
import { addDynamicHelp } from '../lib/help.js';
import {
  listAgentWorktrees,
  getWorktreePath,
  getBranchName,
  removeWorktree,
  getParentBranch,
  branchExists,
  getMainBranch as getConfiguredMainBranch
} from '../lib/worktree.js';
import {
  buildConflictMatrix,
  suggestMergeOrder,
  getModifiedFiles
} from '../lib/conflicts.js';
import {
  diagnoseWorktreeState,
  diagnoseAgentState,
  getRecommendedActions
} from '../lib/state-machine/index.js';
import {
  getMainBranch as getGitMainBranch,
  getStatus as getGitStatus,
  getDivergence,
  fetch as gitFetch
} from '../lib/git.js';
import {
  detectProvider,
  checkCli as checkPrCli,
  getStatus as getPrStatusFromLib,
  create as createPrFromLib
} from '../lib/pr.js';


import {
  diagnose as diagnoseReconciliation,
  diagnoseWorktrees as diagnoseWorktreesReconciliation,
  reconcileBranch,
  pruneOrphans,
  report as reconciliationReport,
  BranchState,
  BranchHierarchyNode
} from '../lib/reconciliation.js';

interface AgentInfo {
  status: string;
  worktree?: {
    path: string;
    branch: string;
    base_branch?: string;
    branching?: string;
  };
  pr_url?: string;
  task_title?: string;
  epic_id?: string;
  prd_id?: string;
}


/**
 * Get main branch status
 */
function getMainBranchStatus(projectRoot) {
  const mainBranch = getGitMainBranch();
  const gitStatus = getGitStatus(projectRoot);
  const result = {
    branch: mainBranch,
    clean: gitStatus.clean,
    uncommitted: gitStatus.files.length,
    ahead: 0,
    behind: 0,
    upToDate: true
  };

  // Fetch to check remote status
  const fetchResult = gitFetch({ cwd: projectRoot });
  if (!fetchResult.success) {
    return result;
  }

  // Check ahead/behind
  const divergence = getDivergence('HEAD', `origin/${mainBranch}`, projectRoot);
  result.ahead = divergence.ahead;
  result.behind = divergence.behind;
  result.upToDate = divergence.behind === 0;

  return result;
}

/**
 * Get PR status for a branch (wrapper for pr.js)
 */
function getPrStatus(taskId, projectRoot, provider) {
  const branch = getBranchName(taskId);
  return getPrStatusFromLib(branch, projectRoot, provider);
}

/**
 * Create PR for a task (wrapper for pr.js)
 */
function createPr(taskId, options, projectRoot) {
  const state = loadState();
  const agentInfo = state.agents?.[taskId];

  // Get task info for PR title/body
  let title = `${taskId}: Agent work`;
  if (agentInfo?.task_title) {
    title = `${taskId}: ${agentInfo.task_title}`;
  }

  return createPrFromLib(taskId, {
    cwd: projectRoot,
    title,
    draft: options.draft,
    epicId: agentInfo?.epic_id,
    prdId: agentInfo?.prd_id
  });
}

/**
 * Register worktree commands
 */
export function registerWorktreeCommands(program: any) {
  const worktree = program.command('worktree')
    .description('Manage git worktrees for parallel agent execution');

  addDynamicHelp(worktree);

  // worktree:status - Global status of all worktrees
  worktree.command('status')
    .description('Show status of all agent worktrees and PRs')
    .option('--json', 'JSON output')
    .action((options) => {
      const projectRoot = findProjectRoot();
      const state = loadState();
      const agents = state.agents || {};
      const config = getAgentConfig();
      const provider = config.pr_provider === 'auto' ? detectProvider(projectRoot) : config.pr_provider;

      // Get main branch status
      const mainStatus = getMainBranchStatus(projectRoot);

      // Get all agent worktrees
      const worktrees = [];
      for (const [taskId, info] of Object.entries(agents as Record<string, AgentInfo>)) {
        if (!info.worktree) continue;

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

        // Check PR status if provider available
        if (provider && info.pr_url) {
          entry.pr = { url: info.pr_url };
          const prStatus = getPrStatus(taskId, projectRoot, provider);
          if (prStatus) {
            entry.pr.state = prStatus.state;
            entry.pr.mergeable = prStatus.mergeable;
          }
        }

        worktrees.push(entry);
      }

      // Build conflict matrix
      const conflictMatrix = buildConflictMatrix();

      const result = {
        main_branch: mainStatus,
        worktrees,
        conflicts: conflictMatrix.conflicts,
        provider
      };

      if (options.json) {
        jsonOut(result);
      } else {
        console.log('Worktree Status\n');
        console.log('='.repeat(60));

        // Main branch
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

        // Worktrees
        console.log('\nAgent Worktrees:');
        if (worktrees.length === 0) {
          console.log('  No active worktrees');
        } else {
          for (const wt of worktrees) {
            const statusIcon = {
              'running': '●',
              'completed': '✓',
              'failed': '✗',
              'merged': '✓✓',
              'conflict': '⚠'
            }[wt.status] || '○';

            let line = `  ${statusIcon} ${wt.taskId}  ${wt.status}`;
            if (wt.worktree.ahead > 0) {
              line += `  (${wt.worktree.ahead} commits)`;
            }
            if (wt.pr) {
              line += `  PR: ${wt.pr.state || 'open'}`;
            }
            console.log(line);

            if (wt.worktree.conflicts?.length > 0) {
              console.log(`    ⚠ Conflicts: ${wt.worktree.conflicts.join(', ')}`);
            }
          }
        }

        // Conflicts between agents
        if (conflictMatrix.conflicts.length > 0) {
          console.log('\n⚠ Potential Conflicts:');
          for (const conflict of conflictMatrix.conflicts) {
            console.log(`  ${conflict.agents[0]} ↔ ${conflict.agents[1]}: ${conflict.files.join(', ')}`);
          }
        }
      }
    });

  // worktree:preflight - Check if spawn is possible
  worktree.command('preflight')
    .description('Check if agent spawn is possible, report blockers')
    .option('--json', 'JSON output')
    .action((options) => {
      const projectRoot = findProjectRoot();
      const state = loadState();
      const agents = state.agents || {};
      const config = getAgentConfig();
      const provider = config.pr_provider === 'auto' ? detectProvider(projectRoot) : config.pr_provider;

      const blockers = [];
      const warnings = [];
      const pendingMerges = [];
      const runningAgents = [];

      // Check main branch
      const mainStatus = getMainBranchStatus(projectRoot);
      if (!mainStatus.clean) {
        blockers.push(`Main branch has ${mainStatus.uncommitted} uncommitted changes`);
      }
      if (mainStatus.behind > 0) {
        warnings.push(`Main branch is ${mainStatus.behind} commits behind origin (consider: git pull)`);
      }

      // Check git repo
      try {
        execSync('git rev-parse HEAD', { cwd: projectRoot, stdio: 'pipe' });
      } catch {
        blockers.push('No commits in repository (git worktree requires at least one commit)');
      }

      // Check existing agents
      for (const [taskId, info] of Object.entries(agents as Record<string, AgentInfo>)) {
        if (info.status === 'running') {
          runningAgents.push(taskId);
        }
        if (info.status === 'completed' && info.worktree) {
          pendingMerges.push({
            taskId,
            pr_url: info.pr_url || null,
            commits: 0 // Could be filled by checking git
          });
        }
      }

      // Check for conflicts
      const conflictMatrix = buildConflictMatrix();
      if (conflictMatrix.hasConflicts) {
        warnings.push(`${conflictMatrix.conflicts.length} potential conflict(s) between running agents`);
      }

      // Determine if can spawn
      const canSpawn = blockers.length === 0;

      // Recommended action
      let recommendedAction = null;
      if (!canSpawn) {
        if (blockers.some(b => b.includes('uncommitted'))) {
          recommendedAction = 'Escalate: uncommitted changes';
        } else if (blockers.some(b => b.includes('No commits'))) {
          recommendedAction = 'Escalate: repository needs initial commit';
        }
      } else if (pendingMerges.length > 0) {
        const mergeOrder = suggestMergeOrder(conflictMatrix);
        recommendedAction = `Consider merging: ${mergeOrder[0] || pendingMerges[0].taskId}`;
      }

      const result = {
        can_spawn: canSpawn,
        blockers,
        warnings,
        pending_merges: pendingMerges,
        running_agents: runningAgents,
        merge_order: suggestMergeOrder(conflictMatrix),
        recommended_action: recommendedAction,
        provider
      };

      if (options.json) {
        jsonOut(result);
      } else {
        console.log('Spawn Preflight Check\n');
        console.log('='.repeat(50));

        if (canSpawn) {
          console.log('\n✓ Ready to spawn\n');
        } else {
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

  // worktree:pr - Create PR for a task
  worktree.command('pr <task-id>')
    .description('Push branch and create PR/MR for agent work')
    .option('--draft', 'Create as draft PR')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const projectRoot = findProjectRoot();
      const state = loadState();
      const agentInfo = state.agents?.[taskId];

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      if (!agentInfo.worktree) {
        console.error(`Task ${taskId} has no worktree`);
        process.exit(1);
      }

      // Check PR already exists
      if (agentInfo.pr_url) {
        console.log(`PR already exists: ${agentInfo.pr_url}`);
        return;
      }

      // Detect provider
      const config = getAgentConfig();
      const provider = config.pr_provider === 'auto' ? detectProvider(projectRoot) : config.pr_provider;

      if (!provider) {
        console.error('Cannot detect PR provider. Set agent.pr_provider in config.');
        process.exit(1);
      }

      // Check CLI available
      const cli = checkPrCli(provider);
      if (!cli.available) {
        console.error(`${cli.cmd} CLI not found. Install it to create PRs.`);
        process.exit(1);
      }

      // Check worktree has commits
      const worktreePath = getWorktreePath(taskId);
      const mainBranch = getGitMainBranch();

      try {
        const count = execSync(`git rev-list --count HEAD ^${mainBranch}`, {
          cwd: worktreePath,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        if (parseInt(count, 10) === 0) {
          console.error('No commits to create PR from');
          process.exit(1);
        }
      } catch (e) {
        console.error(`Cannot check commits: ${e.message}`);
        process.exit(1);
      }

      // Create PR
      try {
        const pr = createPr(taskId, options, projectRoot);

        // Update state with PR URL
        state.agents[taskId].pr_url = pr.url;
        state.agents[taskId].pr_created_at = new Date().toISOString();
        saveState(state);

        if (options.json) {
          jsonOut({ taskId, ...pr });
        } else {
          console.log(`PR created: ${pr.url}`);
        }
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
    });

  // worktree:cleanup - Remove worktree after merge
  worktree.command('cleanup <task-id>')
    .description('Remove worktree and branch after PR is merged')
    .option('--force', 'Force cleanup even if PR not merged')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const projectRoot = findProjectRoot();
      const state = loadState();
      const agentInfo = state.agents?.[taskId];

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      // Check PR status if exists
      if (agentInfo.pr_url && !options.force) {
        const config = getAgentConfig();
        const provider = config.pr_provider === 'auto' ? detectProvider(projectRoot) : config.pr_provider;

        if (provider) {
          const prStatus = getPrStatus(taskId, projectRoot, provider);
          if (prStatus && prStatus.state !== 'MERGED' && prStatus.state !== 'merged') {
            console.error(`PR is not merged (state: ${prStatus.state}). Use --force to cleanup anyway.`);
            process.exit(1);
          }
        }
      }

      const branch = getBranchName(taskId);
      const worktreePath = getWorktreePath(taskId);
      const results = { taskId, removed: [] };

      // Remove worktree
      if (fs.existsSync(worktreePath)) {
        try {
          removeWorktree(taskId);
          results.removed.push('worktree');
        } catch (e) {
          console.error(`Failed to remove worktree: ${e.message}`);
        }
      }

      // Delete local branch
      try {
        execSync(`git branch -D ${branch}`, {
          cwd: projectRoot,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        results.removed.push('local_branch');
      } catch {
        // Branch may not exist
      }

      // Delete remote branch
      try {
        execSync(`git push origin --delete ${branch}`, {
          cwd: projectRoot,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        results.removed.push('remote_branch');
      } catch {
        // Remote branch may not exist
      }

      // Update state
      state.agents[taskId].status = 'merged';
      state.agents[taskId].cleaned_at = new Date().toISOString();
      saveState(state);

      if (options.json) {
        jsonOut(results);
      } else {
        console.log(`Cleaned up ${taskId}: ${results.removed.join(', ')}`);
      }
    });

  // worktree:sync - Sync PR status and cleanup merged
  worktree.command('sync')
    .description('Check PR status, cleanup merged worktrees, update state')
    .option('--dry-run', 'Show what would be done without doing it')
    .option('--json', 'JSON output')
    .action((options) => {
      const projectRoot = findProjectRoot();
      const state = loadState();
      const agents = state.agents || {};
      const config = getAgentConfig();
      const provider = config.pr_provider === 'auto' ? detectProvider(projectRoot) : config.pr_provider;

      const actions = [];

      for (const [taskId, info] of Object.entries(agents as Record<string, AgentInfo>)) {
        // Skip already cleaned up
        if (info.status === 'merged' || info.status === 'rejected') continue;

        // Check if has PR
        if (info.pr_url && provider) {
          const prStatus = getPrStatus(taskId, projectRoot, provider);
          if (prStatus && (prStatus.state === 'MERGED' || prStatus.state === 'merged')) {
            actions.push({
              action: 'cleanup',
              taskId,
              reason: 'PR merged'
            });
          }
        }

        // Check orphaned worktrees (worktree exists but no agent or agent done)
        if (info.worktree) {
          const worktreePath = getWorktreePath(taskId);
          if (!fs.existsSync(worktreePath)) {
            actions.push({
              action: 'update_state',
              taskId,
              reason: 'Worktree missing'
            });
          }
        }
      }

      if (options.json) {
        jsonOut({ actions, dry_run: options.dryRun });
      } else if (actions.length === 0) {
        console.log('✓ All worktrees in sync');
      } else {
        console.log('Sync Actions:\n');
        for (const action of actions) {
          const prefix = options.dryRun ? '[DRY-RUN] ' : '';
          console.log(`${prefix}${action.action}: ${action.taskId} (${action.reason})`);

          if (!options.dryRun && action.action === 'cleanup') {
            // Execute cleanup
            try {
              execSync(`${process.argv[0]} ${process.argv[1]} worktree cleanup ${action.taskId} --force`, {
                cwd: projectRoot,
                stdio: 'inherit'
              });
            } catch {
              console.error(`  Failed to cleanup ${action.taskId}`);
            }
          }
        }
      }
    });

  // worktree:merge - Local merge of task branch to parent
  worktree.command('merge <task-id>')
    .description('Merge task branch to parent branch (local git workflow)')
    .option('--strategy <type>', 'Merge strategy: merge|squash|rebase (default from config)')
    .option('--no-cleanup', 'Keep worktree after merge')
    .option('--dry-run', 'Show what would be done without doing it')
    .option('--json', 'JSON output')
    .action((taskId, options) => {
      taskId = taskId.toUpperCase();
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const projectRoot = findProjectRoot();
      const state = loadState();
      const agentInfo = state.agents?.[taskId];

      if (!agentInfo) {
        console.error(`No agent found for task: ${taskId}`);
        process.exit(1);
      }

      if (!agentInfo.worktree) {
        console.error(`Task ${taskId} has no worktree`);
        process.exit(1);
      }

      const worktreePath = getWorktreePath(taskId);
      if (!fs.existsSync(worktreePath)) {
        console.error(`Worktree not found: ${worktreePath}`);
        process.exit(1);
      }

      // Get branching context from stored info
      const branching = agentInfo.worktree.branching || 'flat';
      const prdId = agentInfo.prd_id;
      const epicId = agentInfo.epic_id;
      const branchContext = { prdId, epicId, branching };

      // Get task branch and parent branch
      const taskBranch = getBranchName(taskId);
      const parentBranch = getParentBranch(taskId, branchContext);

      // Get merge strategy from options or config
      const gitConfig = getGitConfig();
      let strategy = options.strategy;
      if (!strategy) {
        // Select strategy based on level
        if (branching === 'flat') {
          strategy = gitConfig.merge_to_main || 'squash';
        } else if (branching === 'prd') {
          strategy = gitConfig.merge_to_prd || 'squash';
        } else if (branching === 'epic') {
          strategy = gitConfig.merge_to_epic || 'merge';
        } else {
          strategy = 'merge';
        }
      }

      const validStrategies = ['merge', 'squash', 'rebase'];
      if (!validStrategies.includes(strategy)) {
        console.error(`Invalid merge strategy: ${strategy}`);
        console.error(`Valid strategies: ${validStrategies.join(', ')}`);
        process.exit(1);
      }

      // Check parent branch exists
      if (!branchExists(parentBranch)) {
        console.error(`Parent branch not found: ${parentBranch}`);
        console.error('Create it first or check branching strategy in PRD.');
        process.exit(1);
      }

      // Check worktree is clean (all changes committed)
      try {
        const status = execSync('git status --porcelain', {
          cwd: worktreePath,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        if (status) {
          console.error('Worktree has uncommitted changes:');
          status.split('\n').slice(0, 5).forEach(l => console.error(`  ${l}`));
          console.error('\nCommit changes first or use agent:reject to discard.');
          process.exit(1);
        }
      } catch (e) {
        console.error(`Cannot check worktree status: ${e.message}`);
        process.exit(1);
      }

      // Check for commits to merge
      let commitCount = 0;
      try {
        commitCount = parseInt(execSync(`git rev-list --count ${parentBranch}..${taskBranch}`, {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim(), 10) || 0;
      } catch {
        commitCount = 0;
      }

      if (commitCount === 0) {
        console.log(`No commits to merge from ${taskBranch} to ${parentBranch}`);
        return;
      }

      if (options.dryRun) {
        console.log('Merge (dry run):\n');
        console.log(`  Task branch: ${taskBranch}`);
        console.log(`  Parent branch: ${parentBranch}`);
        console.log(`  Strategy: ${strategy}`);
        console.log(`  Commits: ${commitCount}`);
        console.log(`  Cleanup: ${options.cleanup !== false ? 'yes' : 'no'}`);
        return;
      }

      // Checkout parent branch
      try {
        execSync(`git checkout ${parentBranch}`, {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (e) {
        console.error(`Failed to checkout ${parentBranch}: ${e.message}`);
        process.exit(1);
      }

      // Execute merge based on strategy
      let mergeSuccess = false;
      try {
        if (strategy === 'merge') {
          execSync(`git merge ${taskBranch} --no-edit -m "Merge ${taskId} into ${parentBranch}"`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
          });
          mergeSuccess = true;
        } else if (strategy === 'squash') {
          execSync(`git merge --squash ${taskBranch}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          });
          // Squash requires manual commit
          execSync(`git commit -m "${taskId}: squashed merge from ${taskBranch}"`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
          });
          mergeSuccess = true;
        } else if (strategy === 'rebase') {
          // For rebase, we rebase taskBranch onto parentBranch
          execSync(`git rebase ${taskBranch}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
          });
          mergeSuccess = true;
        }
      } catch (e) {
        console.error(`Merge failed: ${e.message}`);
        console.error('\nResolve conflicts manually or use /dev:merge skill.');
        // Try to abort
        try {
          if (strategy === 'rebase') {
            execSync('git rebase --abort', { cwd: projectRoot, stdio: 'pipe' });
          } else {
            execSync('git merge --abort', { cwd: projectRoot, stdio: 'pipe' });
          }
        } catch { /* ignore */ }
        process.exit(1);
      }

      // Cleanup worktree if merge succeeded and --no-cleanup not set
      let cleaned = false;
      if (mergeSuccess && options.cleanup !== false) {
        const removeResult = removeWorktree(taskId, { force: true });
        cleaned = removeResult.success;
      }

      // Update state
      state.agents[taskId].status = 'merged';
      state.agents[taskId].merge_strategy = strategy;
      state.agents[taskId].merged_to = parentBranch;
      state.agents[taskId].merged_at = new Date().toISOString();
      if (cleaned) {
        state.agents[taskId].cleaned_at = new Date().toISOString();
      }
      saveState(state);

      const result = {
        taskId,
        status: 'merged',
        from: taskBranch,
        to: parentBranch,
        strategy,
        commits: commitCount,
        cleaned
      };

      if (options.json) {
        jsonOut(result);
      } else {
        console.log(`\n✓ Merged: ${taskBranch} → ${parentBranch}`);
        console.log(`  Strategy: ${strategy}`);
        console.log(`  Commits: ${commitCount}`);
        if (cleaned) {
          console.log(`  Worktree cleaned up`);
        }

        // Show next step hint
        if (branching !== 'flat') {
          if (branching === 'epic') {
            console.log(`\nNext: When epic is complete, merge epic/${epicId} to prd/${prdId}`);
          } else if (branching === 'prd') {
            console.log(`\nNext: When PRD is complete, merge prd/${prdId} to main`);
          }
        }
      }
    });

  // worktree:promote - Merge epic/prd branch upward
  worktree.command('promote <level> <id>')
    .description('Merge epic→prd or prd→main (e.g., promote epic E001 --prd PRD-001, promote prd PRD-001)')
    .option('--prd <prd-id>', 'PRD ID (required for epic level)')
    .option('--strategy <type>', 'Merge strategy: merge|squash|rebase (default from config)')
    .option('--dry-run', 'Show what would be done without doing it')
    .option('--json', 'JSON output')
    .action((level, id, options) => {
      level = level.toLowerCase();
      id = id.toUpperCase();

      if (!['epic', 'prd'].includes(level)) {
        console.error(`Invalid level: ${level}. Use 'epic' or 'prd'.`);
        process.exit(1);
      }

      const projectRoot = findProjectRoot();
      const gitConfig = getGitConfig();
      const mainBranch = getConfiguredMainBranch();

      let sourceBranch, targetBranch, strategy;

      if (level === 'epic') {
        // epic → prd
        const epicId = id.startsWith('E') ? id : `E${id}`;
        sourceBranch = `epic/${epicId}`;

        // Get PRD from option
        let prdId = options.prd;
        if (!prdId) {
          console.error('Epic promote requires --prd option.');
          console.error('Usage: worktree promote epic E001 --prd PRD-001');
          process.exit(1);
        }
        prdId = prdId.toUpperCase();
        if (!prdId.startsWith('PRD-')) {
          prdId = `PRD-${prdId}`;
        }
        targetBranch = `prd/${prdId}`;
        strategy = options.strategy || gitConfig.merge_to_prd || 'squash';
      } else {
        // prd → main
        const prdId = id.startsWith('PRD-') ? id : `PRD-${id}`;
        sourceBranch = `prd/${prdId}`;
        targetBranch = mainBranch;
        strategy = options.strategy || gitConfig.merge_to_main || 'squash';
      }

      // Check branches exist
      if (!branchExists(sourceBranch)) {
        console.error(`Source branch not found: ${sourceBranch}`);
        process.exit(1);
      }
      if (!branchExists(targetBranch)) {
        console.error(`Target branch not found: ${targetBranch}`);
        process.exit(1);
      }

      // Count commits to merge
      let commitCount = 0;
      try {
        commitCount = parseInt(execSync(`git rev-list --count ${targetBranch}..${sourceBranch}`, {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim(), 10) || 0;
      } catch {
        commitCount = 0;
      }

      if (commitCount === 0) {
        console.log(`No commits to merge from ${sourceBranch} to ${targetBranch}`);
        return;
      }

      if (options.dryRun) {
        console.log('Promote (dry run):\n');
        console.log(`  Source: ${sourceBranch}`);
        console.log(`  Target: ${targetBranch}`);
        console.log(`  Strategy: ${strategy}`);
        console.log(`  Commits: ${commitCount}`);
        return;
      }

      // Checkout target branch
      try {
        execSync(`git checkout ${targetBranch}`, {
          cwd: projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (e) {
        console.error(`Failed to checkout ${targetBranch}: ${e.message}`);
        process.exit(1);
      }

      // Execute merge
      let mergeSuccess = false;
      try {
        if (strategy === 'merge') {
          execSync(`git merge ${sourceBranch} --no-edit -m "Merge ${sourceBranch} into ${targetBranch}"`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
          });
          mergeSuccess = true;
        } else if (strategy === 'squash') {
          execSync(`git merge --squash ${sourceBranch}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
          });
          const commitMsg = level === 'epic'
            ? `${id}: squashed merge of epic`
            : `${id}: squashed merge of PRD`;
          execSync(`git commit -m "${commitMsg}"`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
          });
          mergeSuccess = true;
        } else if (strategy === 'rebase') {
          execSync(`git rebase ${sourceBranch}`, {
            cwd: projectRoot,
            encoding: 'utf8',
            stdio: options.json ? ['pipe', 'pipe', 'pipe'] : 'inherit'
          });
          mergeSuccess = true;
        }
      } catch (e) {
        console.error(`Merge failed: ${e.message}`);
        console.error('\nResolve conflicts manually or use /dev:merge skill.');
        try {
          if (strategy === 'rebase') {
            execSync('git rebase --abort', { cwd: projectRoot, stdio: 'pipe' });
          } else {
            execSync('git merge --abort', { cwd: projectRoot, stdio: 'pipe' });
          }
        } catch { /* ignore */ }
        process.exit(1);
      }

      const result = {
        level,
        id,
        from: sourceBranch,
        to: targetBranch,
        strategy,
        commits: commitCount,
        success: mergeSuccess
      };

      if (options.json) {
        jsonOut(result);
      } else {
        console.log(`\n✓ Promoted: ${sourceBranch} → ${targetBranch}`);
        console.log(`  Strategy: ${strategy}`);
        console.log(`  Commits: ${commitCount}`);

        if (level === 'epic') {
          console.log(`\nNext: When all epics complete, promote prd to main`);
        } else {
          console.log(`\n✓ PRD merged to main. Ready for release.`);
        }
      }
    });

  // worktree:reconcile - diagnose and fix branch state
  worktree.command('reconcile')
    .description('Diagnose and reconcile branch state (sync, prune orphans)')
    .option('--prd <id>', 'PRD ID for context')
    .option('--epic <id>', 'Epic ID for context')
    .option('--sync', 'Sync branches that are behind')
    .option('--prune', 'Prune orphaned branches')
    .option('--force', 'Force prune even if not fully merged')
    .option('--dry-run', 'Show what would be done without doing it')
    .option('--json', 'JSON output')
    .action((options) => {
      const projectRoot = findProjectRoot();
      const gitConfig = getGitConfig();

      // Build context
      const context = {
        prdId: options.prd,
        epicId: options.epic,
        branching: 'flat' // Default to flat, or should be looked up from PRD if provided
      };
      if (options.prd) {
        // We can't easily import getPrdBranching here without circular deps or import mess
        // But we should try if possible. For now, defaulting to 'flat' as safe fallback
        // Or better: let diagnoseReconciliation handle it if we pass prdId?
        // diagnoseReconciliation takes context.
      }

      // Diagnose
      const diag = diagnoseReconciliation(context);
      const wtDiag = diagnoseWorktreesReconciliation();

      // If no action requested, just report
      if (!options.sync && !options.prune) {
        if (options.json) {
          jsonOut({
            diagnosis: diag,
            worktrees: wtDiag,
            hasIssues: diag.issues.length > 0 || wtDiag.issues.length > 0
          });
        } else {
          console.log(reconciliationReport(context));
        }
        return;
      }

      const results = {
        synced: [],
        pruned: [],
        errors: []
      };

      // Sync branches
      if (options.sync) {
        for (const h of diag.hierarchy) {
          if (typeof h !== 'object' || !('branch' in h)) continue;
          const branchInfo = h as BranchHierarchyNode;
          if (branchInfo.state === BranchState.BEHIND || branchInfo.state === BranchState.DIVERGED) {
            const agentConfig = getAgentConfig();
            const result = reconcileBranch(branchInfo.branch, branchInfo.parent, {
              strategy: agentConfig?.merge_strategy || 'merge',
              dryRun: options.dryRun
            });

            if (result.success && result.action === 'synced') {
              results.synced.push(`${h.branch} ← ${h.parent}`);
            } else if (result.action === 'would_sync') {
              results.synced.push(`[dry-run] ${h.branch} ← ${h.parent}`);
            } else if (!result.success) {
              results.errors.push(`${h.branch}: ${result.error}`);
            }
          }
        }
      }

      // Prune orphans
      if (options.prune) {
        const pruneResult = pruneOrphans({
          dryRun: options.dryRun,
          force: options.force
        });

        results.pruned = pruneResult.pruned.map(b =>
          options.dryRun ? `[dry-run] ${b}` : b
        );
        results.errors.push(...pruneResult.errors);
      }

      // Output
      if (options.json) {
        jsonOut({
          success: results.errors.length === 0,
          synced: results.synced,
          pruned: results.pruned,
          errors: results.errors
        });
      } else {
        if (results.synced.length > 0) {
          console.log('Synced branches:');
          results.synced.forEach(s => console.log(`  ✓ ${s}`));
        }

        if (results.pruned.length > 0) {
          console.log('Pruned branches:');
          results.pruned.forEach(p => console.log(`  ✓ ${p}`));
        }

        if (results.errors.length > 0) {
          console.log('Errors:');
          results.errors.forEach(e => console.log(`  ✗ ${e}`));
        }

        if (results.synced.length === 0 && results.pruned.length === 0 && results.errors.length === 0) {
          console.log('✓ Everything is in sync, no orphans found.');
        }
      }
    });
}
