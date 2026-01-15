/**
 * Agent Lifecycle Manager
 *
 * High-level orchestration of agent operations.
 * Composes low-level libs (worktree, git, state) into business operations.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadFile, saveFile, findProjectRoot } from './core-manager.js';
import { loadState, saveState } from './state-manager.js';
import { getGit } from '../lib/git.js';
import { getAgentConfig } from './core-manager.js';
import { removeWorktree } from './worktree-manager.js';
import { getTask, getTaskEpic } from './artefacts-manager.js';
import { normalizeId } from '../lib/normalize.js';
import { parseUpdateOptions } from '../lib/update.js';
import { getAgentDir, checkAgentCompletion } from '../lib/agent-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface ReapOptions {
  wait?: boolean;
  timeout?: number;
  cleanupWorktree?: boolean;
  verbose?: boolean;
}

export interface ReapResult {
  success: boolean;
  taskId: string;
  resultStatus: 'completed' | 'blocked';
  taskStatus: 'Done' | 'Blocked';
  merged: boolean;
  cleanedUp: boolean;
  error?: string;
  escalate?: {
    reason: string;
    nextSteps: string[];
  };
}

export interface WaitResult {
  success: boolean;
  taskId: string;
  timedOut?: boolean;
  error?: string;
}

export interface KillResult {
  success: boolean;
  taskId: string;
  pid?: number;
  error?: string;
}

export interface MergeResult {
  success: boolean;
  strategy: string;
  conflicts?: string[];
  error?: string;
}

export interface ConflictInfo {
  hasConflicts: boolean;
  files: string[];
}

// ============================================================================
// Wait / Monitor
// ============================================================================

/**
 * Check if agent process is still running
 */
export function isAgentRunning(taskId: string): boolean {
  const state = loadState();
  const agentInfo = state.agents?.[taskId];
  if (!agentInfo?.pid) return false;

  try {
    process.kill(agentInfo.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for agent to complete
 */
export async function waitForAgent(taskId: string, timeoutSec: number): Promise<WaitResult> {
  taskId = normalizeId(taskId);
  const timeoutMs = timeoutSec * 1000;
  const startTime = Date.now();

  while (true) {
    const completion = checkAgentCompletion(taskId);
    if (completion.complete) {
      return { success: true, taskId };
    }

    if (Date.now() - startTime > timeoutMs) {
      return { success: false, taskId, timedOut: true };
    }

    await new Promise(r => setTimeout(r, 5000));
  }
}

// ============================================================================
// Git / Merge
// ============================================================================

/**
 * Check for merge conflicts before merging
 */
export async function checkMergeConflicts(taskId: string): Promise<ConflictInfo> {
  taskId = normalizeId(taskId);
  const state = loadState();
  const agentInfo = state.agents?.[taskId];

  if (!agentInfo?.worktree) {
    return { hasConflicts: false, files: [] };
  }

  const projectRoot = findProjectRoot();
  const branch = agentInfo.worktree.branch;
  const mainGit = getGit(projectRoot);

  try {
    const mergeBase = await mainGit.raw(['merge-base', 'HEAD', branch]);
    const mergeTree = await mainGit.raw(['merge-tree', mergeBase.trim(), 'HEAD', branch]);

    if (mergeTree.includes('<<<<<<<') || mergeTree.includes('>>>>>>>')) {
      const conflictFiles: string[] = [];
      for (const line of mergeTree.split('\n')) {
        if (line.startsWith('changed in both')) {
          const match = line.match(/changed in both\s+(.+)/);
          if (match) conflictFiles.push(match[1]);
        }
      }
      return { hasConflicts: true, files: conflictFiles };
    }
  } catch {
    // Can't check - assume no conflicts
  }

  return { hasConflicts: false, files: [] };
}

/**
 * Auto-commit uncommitted changes in worktree
 */
export async function autoCommitChanges(taskId: string): Promise<{ committed: boolean; files: number }> {
  taskId = normalizeId(taskId);
  const state = loadState();
  const agentInfo = state.agents?.[taskId];

  if (!agentInfo?.worktree?.path) {
    return { committed: false, files: 0 };
  }

  const worktreePath = agentInfo.worktree.path;
  if (!fs.existsSync(worktreePath)) {
    return { committed: false, files: 0 };
  }

  const reapGit = getGit(worktreePath);
  const reapStatus = await reapGit.status();

  if (reapStatus.isClean()) {
    return { committed: false, files: 0 };
  }

  const allFiles = [
    ...reapStatus.modified,
    ...reapStatus.created,
    ...reapStatus.deleted,
    ...reapStatus.not_added
  ];

  try {
    await reapGit.add('-A');
    await reapGit.commit(`chore(${taskId}): auto-commit agent changes`);
    return { committed: true, files: allFiles.length };
  } catch {
    return { committed: false, files: 0 };
  }
}

/**
 * Merge agent work into main branch
 */
export async function mergeAgentWork(
  taskId: string,
  strategy: 'merge' | 'squash' | 'rebase' = 'merge'
): Promise<MergeResult> {
  taskId = normalizeId(taskId);
  const state = loadState();
  const agentInfo = state.agents?.[taskId];

  if (!agentInfo?.worktree) {
    return { success: false, strategy, error: 'No worktree for agent' };
  }

  const projectRoot = findProjectRoot();
  const branch = agentInfo.worktree.branch;
  const mainGit = getGit(projectRoot);

  // Check conflicts first
  const conflicts = await checkMergeConflicts(taskId);
  if (conflicts.hasConflicts) {
    return { success: false, strategy, conflicts: conflicts.files, error: 'Merge conflicts detected' };
  }

  try {
    if (strategy === 'squash') {
      await mainGit.merge([branch, '--squash']);
      await mainGit.commit(`feat(${taskId}): ${branch}`);
    } else if (strategy === 'rebase') {
      await mainGit.rebase([branch]);
    } else {
      await mainGit.merge([branch, '--no-edit']);
    }
    return { success: true, strategy };
  } catch (e: any) {
    return { success: false, strategy, error: e.message };
  }
}

// ============================================================================
// Core Lifecycle
// ============================================================================

/**
 * Reap agent: wait for completion, merge work, update status
 *
 * This is the main orchestration function that:
 * 1. Waits for agent completion (optional)
 * 2. Auto-commits uncommitted changes
 * 3. Checks for merge conflicts
 * 4. Merges worktree to main
 * 5. Updates task status (Done/Blocked)
 * 6. Updates agent state (reaped)
 */
export async function reapAgent(taskId: string, options: ReapOptions = {}): Promise<ReapResult> {
  taskId = normalizeId(taskId);
  const { wait = true, timeout = 300, cleanupWorktree = false } = options;

  const state = loadState();
  const agentInfo = state.agents?.[taskId];
  const projectRoot = findProjectRoot();
  const config = getAgentConfig();

  // Validation
  if (!agentInfo) {
    return {
      success: false,
      taskId,
      resultStatus: 'blocked',
      taskStatus: 'Blocked',
      merged: false,
      cleanedUp: false,
      escalate: {
        reason: `No agent found for task ${taskId}`,
        nextSteps: [`agent:spawn ${taskId}    # Start agent first`]
      }
    };
  }

  // Wait for completion if running
  if (isAgentRunning(taskId)) {
    if (!wait) {
      return {
        success: false,
        taskId,
        resultStatus: 'blocked',
        taskStatus: 'Blocked',
        merged: false,
        cleanedUp: false,
        escalate: {
          reason: `Agent ${taskId} is still running (PID ${agentInfo.pid})`,
          nextSteps: [
            `agent:wait ${taskId}     # Wait for completion`,
            `agent:kill ${taskId}     # Force terminate`
          ]
        }
      };
    }

    const waitResult = await waitForAgent(taskId, timeout);
    if (!waitResult.success) {
      return {
        success: false,
        taskId,
        resultStatus: 'blocked',
        taskStatus: 'Blocked',
        merged: false,
        cleanedUp: false,
        escalate: {
          reason: `Timeout waiting for agent ${taskId}`,
          nextSteps: [
            `agent:wait ${taskId} --timeout 3600    # Wait longer`,
            `agent:kill ${taskId}                   # Force terminate`
          ]
        }
      };
    }
  }

  // Check completion
  const completion = checkAgentCompletion(taskId);
  if (!completion.complete) {
    return {
      success: false,
      taskId,
      resultStatus: 'blocked',
      taskStatus: 'Blocked',
      merged: false,
      cleanedUp: false,
      escalate: {
        reason: `Agent ${taskId} did not complete`,
        nextSteps: [
          `agent:status ${taskId}    # Check status`,
          `agent:reject ${taskId}    # Discard incomplete work`
        ]
      }
    };
  }

  // Read result status
  let resultStatus: 'completed' | 'blocked' = 'completed';
  const agentDir = getAgentDir(taskId);
  const resultFile = path.join(agentDir, 'result.yaml');
  if (fs.existsSync(resultFile)) {
    try {
      const result = yaml.load(fs.readFileSync(resultFile, 'utf8')) as any;
      resultStatus = result.status || 'completed';
    } catch { /* ignore */ }
  }

  let merged = false;
  let cleanedUp = false;

  // Handle worktree merge
  if (agentInfo.worktree) {
    const worktreePath = agentInfo.worktree.path;

    if (!fs.existsSync(worktreePath)) {
      return {
        success: false,
        taskId,
        resultStatus,
        taskStatus: 'Blocked',
        merged: false,
        cleanedUp: false,
        escalate: {
          reason: `Worktree not found: ${worktreePath}`,
          nextSteps: [`agent:clear ${taskId}    # Clear stale state`]
        }
      };
    }

    // Auto-commit uncommitted changes
    await autoCommitChanges(taskId);

    // Check for conflicts
    const conflicts = await checkMergeConflicts(taskId);
    if (conflicts.hasConflicts) {
      return {
        success: false,
        taskId,
        resultStatus,
        taskStatus: 'Blocked',
        merged: false,
        cleanedUp: false,
        escalate: {
          reason: 'Merge conflicts detected',
          nextSteps: [
            `/dev:merge ${taskId}                           # Guided conflict resolution`,
            ``,
            `Manual resolution:`,
            `  git checkout -b merge/${taskId}-to-main main`,
            `  git merge ${agentInfo.worktree.branch} --no-commit`,
            `  # ... resolve conflicts ...`,
            `  git commit -m "merge(${taskId}): resolved conflicts"`,
            `  git checkout main && git merge merge/${taskId}-to-main --ff-only`,
            `  agent:clear ${taskId}`,
            ...(conflicts.files.length > 0 ? [``, `Conflicting files:`, ...conflicts.files.map(f => `  ${f}`)] : [])
          ]
        }
      };
    }

    // Merge
    const strategy = config.merge_strategy || 'merge';
    const mergeResult = await mergeAgentWork(taskId, strategy as any);
    if (!mergeResult.success) {
      return {
        success: false,
        taskId,
        resultStatus,
        taskStatus: 'Blocked',
        merged: false,
        cleanedUp: false,
        escalate: {
          reason: `Merge failed: ${mergeResult.error}`,
          nextSteps: [`/dev:merge ${taskId}    # Manual resolution`]
        }
      };
    }

    merged = true;

    // Cleanup worktree if requested
    if (cleanupWorktree) {
      const removeResult = removeWorktree(taskId, { force: true });
      cleanedUp = removeResult.success;
    }
  }

  // Update task status
  const taskStatus = resultStatus === 'completed' ? 'Done' : 'Blocked';
  const taskFile = getTask(taskId)?.file;
  if (taskFile) {
    const file = loadFile(taskFile);
    const { updated, data } = parseUpdateOptions({ status: taskStatus }, file.data, 'task');
    if (updated) {
      saveFile(taskFile, data, file.body);
    }
  }

  // Update agent state
  state.agents[taskId] = {
    ...agentInfo,
    status: 'reaped',
    result_status: resultStatus,
    reaped_at: new Date().toISOString()
  };
  saveState(state);

  return {
    success: true,
    taskId,
    resultStatus,
    taskStatus,
    merged,
    cleanedUp
  };
}

/**
 * Kill agent process
 */
export async function killAgent(taskId: string): Promise<KillResult> {
  taskId = normalizeId(taskId);
  const state = loadState();
  const agentInfo = state.agents?.[taskId];

  if (!agentInfo) {
    return { success: false, taskId, error: `No agent found for task ${taskId}` };
  }

  if (!agentInfo.pid) {
    return { success: false, taskId, error: `Agent ${taskId} has no running process` };
  }

  const pid = agentInfo.pid;

  try {
    process.kill(pid, 'SIGTERM');

    // Wait and force kill if needed
    await new Promise(r => setTimeout(r, 5000));
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already terminated
    }
  } catch (e: any) {
    if (e.code !== 'ESRCH') {
      return { success: false, taskId, pid, error: e.message };
    }
    // ESRCH = process already gone, that's fine
  }

  // Update state
  state.agents[taskId] = {
    ...agentInfo,
    status: 'killed',
    killed_at: new Date().toISOString()
  };
  delete state.agents[taskId].pid;
  saveState(state);

  return { success: true, taskId, pid };
}

/**
 * Reject agent work and cleanup
 */
export async function rejectAgent(taskId: string, reason?: string): Promise<{ success: boolean; taskId: string }> {
  taskId = normalizeId(taskId);
  const state = loadState();
  const agentInfo = state.agents?.[taskId];

  if (!agentInfo) {
    return { success: false, taskId };
  }

  // Remove worktree if exists
  if (agentInfo.worktree) {
    removeWorktree(taskId, { force: true });
  }

  // Update state
  state.agents[taskId] = {
    ...agentInfo,
    status: 'rejected',
    reject_reason: reason,
    rejected_at: new Date().toISOString()
  };
  saveState(state);

  return { success: true, taskId };
}

/**
 * Clear agent from state
 */
export function clearAgent(taskId: string): boolean {
  taskId = normalizeId(taskId);
  const state = loadState();

  if (!state.agents?.[taskId]) {
    return false;
  }

  delete state.agents[taskId];
  saveState(state);
  return true;
}
