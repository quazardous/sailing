/**
 * Spawn preflight/postflight commands
 * Assists skill with branch-aware agent spawning
 */
import fs from 'fs';
import { execSync } from 'child_process';
import type { Command } from 'commander';
import { findProjectRoot, loadFile, jsonOut } from '../managers/core-manager.js';
import { getAgentFromDb } from '../managers/db-manager.js';
import { getAgentConfig, getGitConfig } from '../managers/core-manager.js';
import { addDynamicHelp } from '../lib/help.js';
import { getBranchName,
  getParentBranch, getBranchHierarchy, getMainBranch
} from '../managers/worktree-manager.js';
import { extractPrdId, extractEpicId } from '../lib/normalize.js';
import { getTask, getPrdBranching } from '../managers/artefacts-manager.js';
import {
  diagnose as diagnoseReconciliation,
  BranchState
} from '../managers/reconciliation-manager.js';
import { getGit } from '../lib/git.js';
import { buildConflictMatrix } from '../managers/conflict-manager.js';

interface CheckBranchStateOptions {
  forMerge?: boolean;
}

/**
 * Check if git repo is ready for spawn
 */
async function checkGitState(projectRoot) {
  const issues = [];
  const actions = [];
  const git = getGit(projectRoot);

  // Check if git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    issues.push('Not a git repository');
    return { ready: false, issues, actions, fatal: true };
  }

  // Check if has commits
  const log = await git.log().catch(() => ({ total: 0 }));
  if (log.total === 0) {
    issues.push('Repository has no commits');
    actions.push({ type: 'escalate', msg: 'Escalate: repository needs initial commit' });
    return { ready: false, issues, actions, fatal: true };
  }

  // Check for uncommitted changes
  const status = await git.status();
  if (!status.isClean()) {
    const allFiles = [...status.modified, ...status.created, ...status.deleted, ...status.not_added];
    issues.push(`${allFiles.length} uncommitted changes`);
    actions.push({
      type: 'escalate',
      msg: 'Escalate: uncommitted changes must be resolved'
    });
  }

  return { ready: issues.length === 0, issues, actions, fatal: false };
}

/**
 * Check branch hierarchy state
 * @param {object} context - PRD/Epic context
 * @param {string} projectRoot - Project root path
 * @param {object} options - Options
 * @param {boolean} options.forMerge - If true, conflicts are warnings not blockers
 */
function checkBranchState(context: any, projectRoot: string, options: CheckBranchStateOptions = {}) {
  const { prdId, branching } = context as { prdId: string | null; epicId: string | null; branching: string };
  const { forMerge = false } = options;
  const issues = [];
  const warnings = [];
  const actions = [];
  const mainBranch = getMainBranch();

  if (branching === 'flat') {
    return { ready: true, issues: [], warnings: [], actions: [], hierarchy: [mainBranch] };
  }

  const diag = diagnoseReconciliation(context);
  const hierarchy = getBranchHierarchy(context);

  // Check each level for sync needs
  for (const h of diag.hierarchy) {
    if (typeof h !== 'object') continue;

    if (h.state === BranchState.BEHIND) {
      const msg = `${h.branch} is ${h.behind} commits behind ${h.parent}`;
      const action = {
        type: 'sync',
        cmd: `rudder worktree:reconcile --sync --prd ${prdId || ''}`.trim(),
        msg: `Sync ${h.branch} from ${h.parent}`
      };

      if (forMerge) {
        // For merge agents, branch issues are just warnings
        warnings.push(msg);
      } else {
        issues.push(msg);
        actions.push(action);
      }
    } else if (h.state === BranchState.DIVERGED) {
      const msg = `${h.branch} has diverged from ${h.parent} (${h.ahead} ahead, ${h.behind} behind)`;
      const action = {
        type: 'sync',
        cmd: `rudder worktree:reconcile --sync --prd ${prdId || ''}`.trim(),
        msg: `Reconcile ${h.branch} with ${h.parent} (may need manual resolution)`
      };

      if (forMerge) {
        // For merge agents, diverged branches are expected - they need to resolve this
        warnings.push(msg);
      } else {
        issues.push(msg);
        actions.push(action);
      }
    } else if (h.state === BranchState.CONFLICT) {
      const msg = `${h.branch} has unresolved conflicts with ${h.parent}`;

      if (forMerge) {
        // Merge agents specifically need access to conflicted branches
        warnings.push(`${msg} (merge agent will resolve)`);
      } else {
        issues.push(msg);
        actions.push({
          type: 'skill',
          cmd: `/dev:merge --branch ${h.branch}`,
          msg: `Use merge skill to resolve conflicts`
        });
      }
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    warnings,
    actions,
    hierarchy,
    diagnosis: diag,
    forMerge
  };
}

/**
 * Check task dependencies
 */
function checkDependencies(taskId) {
  try {
    const output = execSync(`${findProjectRoot()}/bin/rudder deps:show ${taskId} --json`, {
      cwd: findProjectRoot(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const deps = JSON.parse(output) as { blocked_by?: Array<{ id: string; status: string }> };

    if (deps.blocked_by && deps.blocked_by.length > 0) {
      const blocking = deps.blocked_by.filter(d => d.status !== 'Done') as Array<{ id: string; status: string }>;
      if (blocking.length > 0) {
        return {
          ready: false,
          issues: [`Blocked by: ${blocking.map(b => b.id).join(', ')}`],
          blocking: blocking as Array<{ id: string; status: string }>
        };
      }
    }
    return { ready: true, issues: [], blocking: [] };
  } catch {
    // deps:show failed, assume ok
    return { ready: true, issues: [], blocking: [] };
  }
}

/**
 * Check for potential conflicts with running agents
 */
async function checkConflicts(taskId) {
  const matrix = await buildConflictMatrix();

  if (!matrix.hasConflicts) {
    return { ready: true, issues: [], conflicts: [] };
  }

  // Check if any conflict involves this task's files
  const potentialConflicts: Array<{ with: string, files: string[] }> = [];

  for (const conflict of matrix.conflicts) {
    if (conflict.agents.includes(taskId)) {
      potentialConflicts.push({
        with: conflict.agents.filter(a => a !== taskId)[0] as string,
        files: conflict.files as string[]
      });
    }
  }

  if (potentialConflicts.length > 0) {
    return {
      ready: true, // Warning only, not blocking
      issues: [`Potential conflicts with: ${potentialConflicts.map(c => c.with).join(', ')}`],
      conflicts: potentialConflicts,
      warning: true
    };
  }

  return { ready: true, issues: [], conflicts: [] };
}

/**
 * Register spawn commands
 */
interface CommandInterface {
  command(name: string): CommandInterface;
  description(desc: string): CommandInterface;
  argument(name: string, desc: string): CommandInterface;
  option(flags: string, desc: string): CommandInterface;
  action(fn: (...args: any[]) => void | Promise<void>): CommandInterface;
}

export function registerSpawnCommands(program: any) {
  const spawn = program.command('spawn')
    .description('Spawn preflight and postflight checks') as Command;

  addDynamicHelp(spawn as any, { entityType: 'spawn' });

  // spawn:preflight (DEPRECATED - agent:spawn is now optimistic)
  spawn.command('preflight')
    .description('[DEPRECATED] Pre-spawn check → agent:spawn now handles this automatically')
    .argument('<task-id>', 'Task ID to check')
    .option('--json', 'JSON output')
    .option('--for-merge', 'Allow spawn for merge/conflict resolution (conflicts become warnings)')
    .action(async (taskId: string, options: any) => {
      if (!options.json) {
        console.error('⚠️  DEPRECATED: spawn:preflight is deprecated.');
        console.error('   agent:spawn now handles pre-flight checks automatically.\n');
      }

      taskId = (taskId.toUpperCase());
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const projectRoot = findProjectRoot();
      const agentConfig = getAgentConfig();

      // Find task and extract context
      const taskFile = getTask(taskId)?.file;
      if (!taskFile) {
        if (options.json) {
          jsonOut({ ready: false, fatal: true, issues: [`Task not found: ${taskId}`] });
        } else {
          console.error(`Task not found: ${taskId}`);
        }
        process.exit(1);
      }

      const task = loadFile(taskFile);
      const prdId = extractPrdId(task.data.parent);
      const epicId = extractEpicId(task.data.parent);
      const branching = prdId ? getPrdBranching(prdId) : 'flat';

      const context = { prdId, epicId, branching };
      const forMerge = (options.forMerge || false) as boolean;

      // Run all checks
      const gitCheck = await checkGitState(projectRoot);
      const branchCheck = checkBranchState(context, projectRoot, { forMerge: forMerge });
      const depsCheck = checkDependencies(taskId);
      const conflictCheck = await checkConflicts(taskId);

      // Aggregate results
      const allIssues = [
        ...(gitCheck.issues as string[]),
        ...(branchCheck.issues as string[]),
        ...(depsCheck.issues),
        ...(conflictCheck.issues as string[])
      ];

      const allActions = [
        ...(gitCheck.actions as Array<{ type: string; cmd?: string; msg: string }>),
        ...(branchCheck.actions as Array<{ type: string; cmd?: string; msg: string }>)
      ];

      // Aggregate warnings (branch warnings for merge agents, conflict warnings)
      const allWarnings = [
        ...((branchCheck.warnings || []) as string[]),
        ...((conflictCheck.warning ? conflictCheck.issues : []) as string[])
      ];

      const ready = gitCheck.ready && branchCheck.ready && depsCheck.ready && !gitCheck.fatal;
      const hasWarnings = allWarnings.length > 0;

      const result = {
        ready,
        taskId: taskId,
        forMerge: forMerge,
        context: {
          prdId,
          epicId,
          branching,
          parentBranch: getParentBranch(taskId, context),
          useWorktree: agentConfig.use_worktrees
        },
        issues: allIssues,
        actions: allActions,
        warnings: allWarnings,
        conflicts: conflictCheck.conflicts as Array<{ with: string; files: string[] }>,
        blocking: depsCheck.blocking as Array<{ id: string; status: string }>
      };

      if (options.json) {
        jsonOut(result);
        return;
      }

      // Human-readable output
      console.log(`Spawn Preflight: ${taskId}${forMerge ? ' (merge mode)' : ''}\n`);
      console.log('─'.repeat(50));

      if (ready && !hasWarnings) {
        console.log('\n✓ Ready to spawn\n');
      } else if (ready && hasWarnings) {
        console.log('\n⚠ Ready with warnings\n');
      } else {
        console.log('\n✗ Cannot spawn\n');
      }

      console.log(`Context:`);
      console.log(`  PRD: ${prdId || 'none'}`);
      console.log(`  Epic: ${epicId || 'none'}`);
      console.log(`  Branching: ${branching}`);
      console.log(`  Parent branch: ${result.context.parentBranch}`);
      console.log(`  Worktree: ${agentConfig.use_worktrees ? 'enabled' : 'disabled'}`);
      if (forMerge) {
        console.log(`  Mode: merge/conflict resolution (branch conflicts allowed)`);
      }

      if (allIssues.length > 0) {
        console.log(`\nIssues:`);
        allIssues.forEach(i => console.log(`  ✗ ${i}`));
      }

      if (allWarnings.length > 0) {
        console.log(`\nWarnings:`);
        allWarnings.forEach(w => console.log(`  ⚠ ${w}`));
      }

      if (allActions.length > 0) {
        console.log(`\nActions needed:`);
        allActions.forEach(a => {
          console.log(`  → ${a.msg}`);
          console.log(`    ${a.cmd}`);
        });
      }

      if (!ready) {
        process.exit(1);
      }
    });

  // spawn:postflight (DEPRECATED - use agent:reap)
  spawn.command('postflight')
    .description('[DEPRECATED] Post-spawn check → use agent:reap instead')
    .argument('<task-id>', 'Task ID to check')
    .option('--json', 'JSON output')
    .action(async (taskId: string, options: any) => {
      if (!options.json) {
        console.error('⚠️  DEPRECATED: spawn:postflight is deprecated. Use agent:reap instead.');
        console.error('   agent:reap handles wait, merge, cleanup, and status update.\n');
      }

      taskId = (taskId.toUpperCase());
      if (!taskId.startsWith('T')) taskId = 'T' + taskId;

      const projectRoot = findProjectRoot();
      const agentInfo = getAgentFromDb(taskId);

      if (!agentInfo) {
        if (options.json) {
          jsonOut({ error: `No agent found for task: ${taskId}` });
        } else {
          console.error(`No agent found for task: ${taskId}`);
        }
        process.exit(1);
      }

      // Get task context
      const taskFile = getTask(taskId)?.file;
      const task = taskFile ? loadFile(taskFile) : null;
      const prdId = task ? extractPrdId(task.data.parent) : null;
      const epicId = task ? extractEpicId(task.data.parent) : null;
      const branching = prdId ? getPrdBranching(prdId) : 'flat';

      // Check worktree state
      const branch = getBranchName(taskId);
      const parentBranch = getParentBranch(taskId, { prdId, epicId, branching });

      let hasChanges = false;
      let commitCount = 0;
      let conflictDetected = false;

      if (agentInfo.worktree) {
        const worktreePath = agentInfo.worktree.path;

        if (fs.existsSync(worktreePath)) {
          const postGit = getGit(projectRoot);

          // Count commits
          try {
            const baseBranch = agentInfo.worktree.base_branch || parentBranch;
            const postLog = await postGit.log({ from: baseBranch, to: branch });
            commitCount = postLog.total;
            hasChanges = commitCount > 0;
          } catch {
            hasChanges = false;
          }

          // Check for potential merge conflicts
          try {
            const mergeBase = await postGit.raw(['merge-base', parentBranch, branch]);
            const mergeTree = await postGit.raw(['merge-tree', mergeBase.trim(), parentBranch, branch]);
            if (mergeTree.includes('<<<<<<')) {
              conflictDetected = true;
            }
          } catch {
            // merge-tree failed, assume no conflict
          }
        }
      }

      // Determine recommended action
      let nextAction = null;
      const actions = [];

      if (agentInfo.status === 'completed' || agentInfo.status === 'running') {
        if (hasChanges) {
          if (conflictDetected) {
            nextAction = 'merge_with_conflicts';
            actions.push({
              type: 'skill',
              cmd: `/dev:merge ${taskId}`,
              msg: 'Conflicts detected - use merge skill for resolution'
            });
          } else {
            nextAction = 'merge_ready';
            actions.push({
              type: 'merge',
              cmd: `rudder worktree:merge ${taskId}`,
              msg: 'Ready for fast merge'
            });
          }
        } else {
          nextAction = 'no_changes';
          actions.push({
            type: 'cleanup',
            cmd: `rudder agent:reject ${taskId} --reason "no changes"`,
            msg: 'No changes to merge'
          });
        }
      } else if (agentInfo.status === 'failed' || agentInfo.status === 'error') {
        nextAction = 'failed';
        actions.push({
          type: 'review',
          cmd: `rudder agent:status ${taskId}`,
          msg: 'Review failure and decide: retry or reject'
        });
      }

      // Check for cascade (epic/prd completion)
      let cascade = null;
      if (nextAction === 'merge_ready' || nextAction === 'merge_with_conflicts') {
        try {
          // Check if this is the last task in epic
          const epicTasksOutput = execSync(
            `${projectRoot}/bin/rudder task:list --epic ${epicId} --json`,
            { cwd: projectRoot, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          );
          const epicTasks = JSON.parse(epicTasksOutput) as Array<{ id: string; status: string }>;
          const doneTasks = epicTasks.filter(t => t.status === 'Done') as Array<{ id: string; status: string }>;
          const inProgressTasks = epicTasks.filter(t => t.status === 'In Progress' && t.id !== taskId) as Array<{ id: string; status: string }>;

          if (inProgressTasks.length === 0 && doneTasks.length === epicTasks.length - 1) {
            cascade = { level: 'epic', id: epicId, prdId };
            actions.push({
              type: 'promote',
              cmd: `rudder worktree:promote epic ${epicId} --prd ${prdId}`,
              msg: 'Epic will be complete after this merge - promote to PRD branch'
            });
          }
        } catch {
          // Could not check cascade, ignore
        }
      }

      const result = {
        taskId: taskId,
        agentStatus: agentInfo.status,
        hasChanges,
        commitCount,
        conflictDetected,
        nextAction: nextAction as string | null,
        actions: actions as Array<{ type: string; cmd: string; msg: string }>,
        cascade: cascade as { level: string; id: string; prdId: string | null } | null,
        context: {
          prdId,
          epicId,
          branching,
          branch,
          parentBranch
        }
      };

      if (options.json) {
        jsonOut(result);
        return;
      }

      // Human-readable output
      console.log(`Spawn Postflight: ${taskId}\n`);
      console.log('─'.repeat(50));

      console.log(`\nAgent Status: ${agentInfo.status}`);
      console.log(`Changes: ${hasChanges ? `${commitCount} commit(s)` : 'none'}`);
      console.log(`Conflicts: ${conflictDetected ? 'detected' : 'none'}`);

      console.log(`\nContext:`);
      console.log(`  Branch: ${branch}`);
      console.log(`  Parent: ${parentBranch}`);
      console.log(`  Branching: ${branching}`);

      if (actions.length > 0) {
        console.log(`\nRecommended Actions:`);
        actions.forEach((a, i) => {
          console.log(`  ${i + 1}. ${a.msg}`);
          console.log(`     ${a.cmd}`);
        });
      }

      if (cascade) {
        console.log(`\n⚡ Cascade: ${cascade.level} ${cascade.id} will complete after merge`);
      }
    });
}
