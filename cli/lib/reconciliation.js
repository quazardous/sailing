/**
 * Branch Reconciliation Service
 *
 * Detects state drift between state.json and git reality.
 * Provides reconciliation strategies for branch hierarchies.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import { findProjectRoot } from './core.js';
import { loadState } from './state.js';
import {
  getMainBranch,
  getBranchName,
  getPrdBranchName,
  getEpicBranchName,
  branchExists,
  getBranchDivergence,
  syncBranch,
  listAgentWorktrees
} from './worktree.js';
import { getGitConfig } from './config.js';

/**
 * Branch States
 */
export const BranchState = {
  SYNCED: 'synced',       // Up to date with parent
  AHEAD: 'ahead',         // Has commits not in parent
  BEHIND: 'behind',       // Parent has commits not here
  DIVERGED: 'diverged',   // Both ahead and behind
  CONFLICT: 'conflict',   // Merge/rebase in progress with conflicts
  MISSING: 'missing',     // Branch doesn't exist
  ORPHANED: 'orphaned'    // Branch exists but not tracked in state
};

/**
 * Get branch state relative to its parent
 * @param {string} branch - Branch name
 * @param {string} parent - Parent branch name
 * @param {string} cwd - Working directory
 * @returns {{ state: string, ahead: number, behind: number }}
 */
export function getBranchState(branch, parent, cwd) {
  const projectRoot = cwd || findProjectRoot();

  if (!branchExists(branch)) {
    return { state: BranchState.MISSING, ahead: 0, behind: 0 };
  }

  if (!branchExists(parent)) {
    return { state: BranchState.ORPHANED, ahead: 0, behind: 0, error: `Parent ${parent} missing` };
  }

  const div = getBranchDivergence(branch, parent);

  if (div.ahead === 0 && div.behind === 0) {
    return { state: BranchState.SYNCED, ahead: 0, behind: 0 };
  } else if (div.ahead > 0 && div.behind === 0) {
    return { state: BranchState.AHEAD, ahead: div.ahead, behind: 0 };
  } else if (div.ahead === 0 && div.behind > 0) {
    return { state: BranchState.BEHIND, ahead: 0, behind: div.behind };
  } else {
    return { state: BranchState.DIVERGED, ahead: div.ahead, behind: div.behind };
  }
}

/**
 * List all sailing-related branches (prd/*, epic/*, task/*)
 * @returns {string[]} Branch names
 */
export function listSailingBranches() {
  const projectRoot = findProjectRoot();

  try {
    const output = execSync('git branch --list "prd/*" "epic/*" "task/*"', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (!output) return [];
    return output.split('\n')
      .map(b => b.trim().replace(/^[\*\+]\s*/, ''))  // Strip both * (current) and + (worktree) prefixes
      .filter(b => b);
  } catch {
    return [];
  }
}

/**
 * Get tracked branches from state.json
 * @returns {{ tasks: string[], epics: Set<string>, prds: Set<string> }}
 */
export function getTrackedBranches() {
  const state = loadState();
  const agents = state.agents || {};

  const tasks = [];
  const epics = new Set();
  const prds = new Set();

  for (const [taskId, info] of Object.entries(agents)) {
    if (info.worktree) {
      tasks.push(getBranchName(taskId));
    }
    if (info.epic_id) {
      epics.add(getEpicBranchName(info.epic_id));
    }
    if (info.prd_id) {
      prds.add(getPrdBranchName(info.prd_id));
    }
  }

  return { tasks, epics: [...epics], prds: [...prds] };
}

/**
 * Find orphaned branches (exist in git but not tracked in state)
 * @returns {{ orphaned: string[], tracked: string[] }}
 */
export function findOrphanedBranches() {
  const allBranches = listSailingBranches();
  const tracked = getTrackedBranches();
  const trackedSet = new Set([...tracked.tasks, ...tracked.epics, ...tracked.prds]);

  const orphaned = allBranches.filter(b => !trackedSet.has(b));
  return { orphaned, tracked: [...trackedSet] };
}

/**
 * Diagnose full branch hierarchy state
 * @param {object} context - { prdId, epicId, branching }
 * @returns {object} Full diagnosis
 */
export function diagnose(context = {}) {
  const projectRoot = findProjectRoot();
  const mainBranch = getMainBranch();
  const { prdId, epicId, branching = 'flat' } = context;

  const diagnosis = {
    main: { branch: mainBranch, state: BranchState.SYNCED },
    branches: {},
    hierarchy: [],
    issues: [],
    recommendations: []
  };

  // Check main branch state (vs origin)
  try {
    const remoteDiv = getBranchDivergence(mainBranch, `origin/${mainBranch}`);
    if (remoteDiv.behind > 0) {
      diagnosis.main.behind = remoteDiv.behind;
      diagnosis.issues.push(`${mainBranch} is ${remoteDiv.behind} commits behind origin`);
      diagnosis.recommendations.push(`git pull origin ${mainBranch}`);
    }
  } catch { /* no remote tracking */ }

  // Build hierarchy based on branching strategy
  if (branching === 'flat') {
    diagnosis.hierarchy = [mainBranch];
    return diagnosis;
  }

  // PRD branch
  if (prdId && (branching === 'prd' || branching === 'epic')) {
    const prdBranch = getPrdBranchName(prdId);
    const prdState = getBranchState(prdBranch, mainBranch);
    diagnosis.branches[prdBranch] = prdState;
    diagnosis.hierarchy.push({ branch: prdBranch, parent: mainBranch, ...prdState });

    if (prdState.state === BranchState.BEHIND) {
      diagnosis.issues.push(`${prdBranch} is ${prdState.behind} commits behind ${mainBranch}`);
      diagnosis.recommendations.push(`Sync ${prdBranch} from ${mainBranch}`);
    } else if (prdState.state === BranchState.DIVERGED) {
      diagnosis.issues.push(`${prdBranch} has diverged from ${mainBranch} (${prdState.ahead} ahead, ${prdState.behind} behind)`);
      diagnosis.recommendations.push(`Rebase or merge ${prdBranch} with ${mainBranch}`);
    }
  }

  // Epic branch
  if (epicId && branching === 'epic') {
    const epicBranch = getEpicBranchName(epicId);
    const parentBranch = prdId ? getPrdBranchName(prdId) : mainBranch;
    const epicState = getBranchState(epicBranch, parentBranch);
    diagnosis.branches[epicBranch] = epicState;
    diagnosis.hierarchy.push({ branch: epicBranch, parent: parentBranch, ...epicState });

    if (epicState.state === BranchState.BEHIND) {
      diagnosis.issues.push(`${epicBranch} is ${epicState.behind} commits behind ${parentBranch}`);
      diagnosis.recommendations.push(`Sync ${epicBranch} from ${parentBranch}`);
    } else if (epicState.state === BranchState.DIVERGED) {
      diagnosis.issues.push(`${epicBranch} has diverged from ${parentBranch}`);
      diagnosis.recommendations.push(`Rebase or merge ${epicBranch} with ${parentBranch}`);
    }
  }

  // Check for orphaned branches
  const { orphaned } = findOrphanedBranches();
  if (orphaned.length > 0) {
    diagnosis.issues.push(`${orphaned.length} orphaned branch(es) found`);
    diagnosis.orphaned = orphaned;
    diagnosis.recommendations.push('Run reconcile --prune to clean up orphaned branches');
  }

  return diagnosis;
}

/**
 * Diagnose all active worktrees and their branches
 * @returns {object} Worktree diagnosis
 */
export function diagnoseWorktrees() {
  const state = loadState();
  const agents = state.agents || {};
  const mainBranch = getMainBranch();
  const worktrees = listAgentWorktrees();

  const diagnosis = {
    worktrees: [],
    issues: [],
    recommendations: []
  };

  for (const wt of worktrees) {
    const taskId = wt.taskId;
    const agentInfo = agents[taskId];
    const branch = getBranchName(taskId);

    const wtDiag = {
      taskId,
      path: wt.path,
      branch,
      tracked: !!agentInfo,
      agentStatus: agentInfo?.status || 'unknown'
    };

    // Get branch state
    const parentBranch = agentInfo?.worktree?.base_branch || mainBranch;
    const branchState = getBranchState(branch, parentBranch);
    wtDiag.branchState = branchState;

    // Check for issues
    if (!agentInfo) {
      diagnosis.issues.push(`Worktree ${taskId} not tracked in state`);
      wtDiag.issue = 'orphaned';
    } else if (agentInfo.status === 'running' && !agentInfo.pid) {
      diagnosis.issues.push(`${taskId} marked as running but no PID`);
      wtDiag.issue = 'stale';
    }

    diagnosis.worktrees.push(wtDiag);
  }

  // Check for tracked agents without worktrees
  for (const [taskId, info] of Object.entries(agents)) {
    if (info.worktree && !worktrees.find(w => w.taskId === taskId)) {
      diagnosis.issues.push(`${taskId} has worktree in state but not on disk`);
      diagnosis.recommendations.push(`Clean up state for ${taskId}`);
    }
  }

  return diagnosis;
}

/**
 * Reconcile a branch with its parent
 * @param {string} branch - Branch to sync
 * @param {string} parent - Parent branch
 * @param {object} options - { strategy: 'merge'|'rebase', dryRun: boolean }
 * @returns {{ success: boolean, action?: string, error?: string }}
 */
export function reconcileBranch(branch, parent, options = {}) {
  const strategy = options.strategy || 'merge';
  const dryRun = options.dryRun || false;

  const branchState = getBranchState(branch, parent);

  if (branchState.state === BranchState.MISSING) {
    return { success: false, error: `Branch ${branch} does not exist` };
  }

  if (branchState.state === BranchState.SYNCED) {
    return { success: true, action: 'none', message: 'Already synced' };
  }

  if (branchState.state === BranchState.AHEAD) {
    return { success: true, action: 'none', message: `${branch} is ahead, no sync needed` };
  }

  if (dryRun) {
    return {
      success: true,
      action: 'would_sync',
      message: `Would sync ${branch} from ${parent} (${branchState.behind} commits behind)`
    };
  }

  // Perform sync
  const result = syncBranch(branch, parent, strategy);
  if (result.success) {
    return {
      success: true,
      action: 'synced',
      message: `Synced ${branch} from ${parent}`,
      commits: branchState.behind
    };
  } else {
    return {
      success: false,
      error: result.error,
      action: 'conflict'
    };
  }
}

/**
 * Cascade reconciliation up the hierarchy
 * Used when finishing an epic or PRD
 * @param {string} level - 'task' | 'epic' | 'prd'
 * @param {string} id - Entity ID
 * @param {object} context - { prdId, epicId, branching }
 * @param {object} options - { strategy, dryRun }
 * @returns {{ success: boolean, synced: string[], errors: string[] }}
 */
export function cascadeUp(level, id, context, options = {}) {
  const mainBranch = getMainBranch();
  const { prdId, epicId, branching = 'flat' } = context;
  const synced = [];
  const errors = [];

  if (branching === 'flat') {
    return { success: true, synced: [], errors: [], message: 'Flat mode, no cascade needed' };
  }

  // Build sync pairs based on level
  const syncPairs = [];

  if (level === 'task' && branching === 'epic' && epicId) {
    // Task done: sync task → epic
    const taskBranch = getBranchName(id);
    const epicBranch = getEpicBranchName(epicId);
    syncPairs.push({ branch: epicBranch, parent: taskBranch, merge: true });
  }

  if (level === 'epic') {
    // Epic done: merge epic → prd (or main if no prd)
    const epicBranch = getEpicBranchName(id);
    const parentBranch = prdId ? getPrdBranchName(prdId) : mainBranch;
    syncPairs.push({ branch: parentBranch, parent: epicBranch, merge: true });
  }

  if (level === 'prd') {
    // PRD done: merge prd → main
    const prdBranch = getPrdBranchName(id);
    syncPairs.push({ branch: mainBranch, parent: prdBranch, merge: true });
  }

  for (const { branch, parent, merge } of syncPairs) {
    if (!branchExists(branch) || !branchExists(parent)) {
      continue;
    }

    if (options.dryRun) {
      synced.push(`Would merge ${parent} → ${branch}`);
      continue;
    }

    const result = reconcileBranch(branch, parent, options);
    if (result.success && result.action === 'synced') {
      synced.push(`${parent} → ${branch}`);
    } else if (!result.success) {
      errors.push(`${branch}: ${result.error}`);
    }
  }

  return {
    success: errors.length === 0,
    synced,
    errors
  };
}

/**
 * Prune orphaned branches
 * @param {object} options - { dryRun: boolean, force: boolean }
 * @returns {{ pruned: string[], kept: string[], errors: string[] }}
 */
export function pruneOrphans(options = {}) {
  const { orphaned } = findOrphanedBranches();
  const projectRoot = findProjectRoot();
  const pruned = [];
  const kept = [];
  const errors = [];

  for (const branch of orphaned) {
    if (options.dryRun) {
      pruned.push(branch);
      continue;
    }

    try {
      const flag = options.force ? '-D' : '-d';
      execSync(`git branch ${flag} "${branch}"`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      pruned.push(branch);
    } catch (e) {
      if (e.message.includes('not fully merged')) {
        kept.push(branch);
        errors.push(`${branch}: not fully merged (use --force)`);
      } else {
        errors.push(`${branch}: ${e.message}`);
      }
    }
  }

  return { pruned, kept, errors };
}

/**
 * Generate human-readable report
 * @param {object} context - { prdId, epicId, branching }
 * @returns {string} Formatted report
 */
export function report(context = {}) {
  const diag = diagnose(context);
  const wtDiag = diagnoseWorktrees();
  const lines = [];

  lines.push('# Branch Reconciliation Report\n');

  // Main branch
  lines.push(`## Main: ${diag.main.branch}`);
  if (diag.main.behind) {
    lines.push(`  ⚠ ${diag.main.behind} commits behind origin`);
  } else {
    lines.push('  ✓ Up to date');
  }
  lines.push('');

  // Hierarchy (only show if there are actual branch objects, not just main)
  const branchHierarchy = diag.hierarchy.filter(h => typeof h === 'object' && h.branch);
  if (branchHierarchy.length > 0) {
    lines.push('## Branch Hierarchy');
    for (const h of branchHierarchy) {
      const symbol = h.state === BranchState.SYNCED ? '✓' :
                     h.state === BranchState.AHEAD ? '↑' :
                     h.state === BranchState.BEHIND ? '↓' :
                     h.state === BranchState.DIVERGED ? '⇅' : '?';
      lines.push(`  ${symbol} ${h.branch} → ${h.parent}`);
      if (h.ahead) lines.push(`      ${h.ahead} ahead`);
      if (h.behind) lines.push(`      ${h.behind} behind`);
    }
    lines.push('');
  }

  // Worktrees
  if (wtDiag.worktrees.length > 0) {
    lines.push('## Active Worktrees');
    for (const wt of wtDiag.worktrees) {
      const status = wt.issue ? `⚠ ${wt.issue}` : `● ${wt.agentStatus}`;
      lines.push(`  ${wt.taskId}: ${status}`);
    }
    lines.push('');
  }

  // Issues
  if (diag.issues.length > 0 || wtDiag.issues.length > 0) {
    lines.push('## Issues');
    for (const issue of [...diag.issues, ...wtDiag.issues]) {
      lines.push(`  ⚠ ${issue}`);
    }
    lines.push('');
  }

  // Orphaned
  if (diag.orphaned?.length > 0) {
    lines.push('## Orphaned Branches');
    for (const branch of diag.orphaned) {
      lines.push(`  - ${branch}`);
    }
    lines.push('');
  }

  // Recommendations
  if (diag.recommendations.length > 0) {
    lines.push('## Recommendations');
    for (const rec of diag.recommendations) {
      lines.push(`  → ${rec}`);
    }
  }

  return lines.join('\n');
}
