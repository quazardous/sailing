/**
 * Agent spawn command
 */
import type { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { findProjectRoot, loadFile, jsonOut, resolvePlaceholders, getAgentConfig, ensureDir, getAgentsDir, getPathsInfo, getWorktreesDir } from '../../managers/core-manager.js';
import { getGit } from '../../lib/git.js';
import { create as createPr } from '../../managers/pr-manager.js';
import { AgentRunManager } from '../../lib/agent-run.js';
import { getAgentLifecycle } from '../../managers/agent-manager.js';
import { createMission } from '../../lib/agent-schema.js';
import { getAgentFromDb, saveAgentToDb, deleteAgentFromDb, updateAgentInDb } from '../../managers/db-manager.js';
import { withModifies } from '../../lib/help.js';
import { buildAgentSpawnPrompt } from '../../managers/compose-manager.js';
import {
  createWorktree, getWorktreePath, getBranchName, worktreeExists, removeWorktree,
  ensureBranchHierarchy, syncParentBranch, getParentBranch, getMainBranch
} from '../../managers/worktree-manager.js';
import { WorktreeOps } from '../../lib/worktree.js';
import { spawnClaude, getLogFilePath } from '../../lib/claude.js';
import { checkMcpAgentServer } from '../../lib/srt.js';
import { extractPrdId, extractEpicId, normalizeId } from '../../lib/normalize.js';
import { parseTaskNum } from '../../lib/agent-paths.js';
import { findDevMd, findToolset } from '../../managers/core-manager.js';
import { getTask, getEpic, getMemoryFile, getPrdBranching } from '../../managers/artefacts-manager.js';
import { checkPendingMemory } from '../../managers/memory-manager.js';
import { AgentUtils, getProcessStats, formatDuration } from '../../lib/agent-utils.js';
import type { AgentRecord } from '../../lib/types/agent.js';
import { getDiagnoseOps, printDiagnoseResult } from '../../managers/diagnose-manager.js';

interface SpawnOptions {
  role?: string;
  timeout?: number;
  worktree?: boolean;
  log?: boolean;
  heartbeat?: number | boolean;
  verbose?: boolean;
  resume?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

type EscalateFn = (reason: string, nextSteps: string[]) => never;

type WorktreeInfo = { path: string; branch: string; base_branch: string; branching: string; resumed?: boolean };

function buildEscalate(taskId: string, options: SpawnOptions): EscalateFn {
  return (reason: string, nextSteps: string[]): never => {
    if (options.json) {
      jsonOut({
        task_id: taskId,
        status: 'blocked',
        reason,
        next_steps: nextSteps
      });
    } else {
      console.error(`\nBLOCKED: ${reason}\n`);
      console.error('Next steps:');
      nextSteps.forEach(step => console.error(`  ${step}`));
    }
    process.exit(1);
  };
}

function validateSpawnPreconditions(taskId: string, options: SpawnOptions): {
  taskId: string;
  taskFile: string;
  task: { data: { parent: string }; body: string };
  prdId: string;
  epicId: string;
  agentConfig: ReturnType<typeof getAgentConfig>;
} {
  // Role enforcement: agents cannot spawn other agents
  if (options.role === 'agent') {
    console.error('ERROR: agent:spawn cannot be called with --role agent');
    console.error('Agents cannot spawn other agents. Only skill or coordinator can spawn.');
    process.exit(1);
  }

  // Check subprocess mode is enabled
  const agentConfig = getAgentConfig();
  if (!agentConfig.use_subprocess) {
    console.error('ERROR: agent:spawn is disabled (use_subprocess: false)\n');
    console.error('Use Task tool with `rudder context:load <operation> --role agent` to spawn agents inline.');
    process.exit(1);
  }

  taskId = normalizeId(taskId, undefined, 'task');

  // Find task file
  const taskFile = getTask(taskId)?.file;
  if (!taskFile) {
    console.error(`Task not found: ${taskId}`);
    process.exit(1);
  }

  // Load task data
  const task = loadFile<{ parent: string }>(taskFile);
  if (!task) {
    console.error(`Could not load task file: ${taskFile}`);
    process.exit(1);
  }

  // Extract IDs
  const prdId = extractPrdId(task.data.parent);
  const epicId = extractEpicId(task.data.parent);

  if (!prdId || !epicId) {
    console.error(`Could not extract PRD/Epic IDs from parent: ${task.data.parent}`);
    process.exit(1);
  }

  return { taskId, taskFile, task: task as { data: { parent: string }; body: string }, prdId, epicId, agentConfig };
}

function checkMcpServerRunning(escalate: EscalateFn): void {
  const havenDir = resolvePlaceholders('${haven}');
  const mcpStatus = checkMcpAgentServer(havenDir);
  if (!mcpStatus.running) {
    escalate('MCP agent server not running', [
      `bin/rdrctl start     # Start MCP services`,
      `bin/rdrctl status    # Check server status`
    ]);
  }
}

async function resolveExistingAgent(
  taskId: string,
  existingAgent: AgentRecord,
  options: SpawnOptions,
  projectRoot: string,
  escalate: EscalateFn
): Promise<void> {
  const agentInfo = existingAgent;
  const status = agentInfo.status;

  // Check if process is actually running
  let isRunning = false;
  if (agentInfo.pid) {
    try {
      process.kill(agentInfo.pid, 0);
      isRunning = true;
    } catch { /* not running */ }
  }

  if (isRunning) {
    escalate(`Agent ${taskId} is still running (PID ${agentInfo.pid})`, [
      `agent:wait ${taskId}     # Wait for completion`,
      `agent:kill ${taskId}     # Force terminate`,
      `agent:reap ${taskId}     # Wait + harvest results`
    ]);
  }

  // Check worktree state
  if (agentInfo.worktree) {
    await resolveWorktreeConflict(taskId, agentInfo, agentInfo.worktree, options, projectRoot, escalate);
  } else {
    resolveNoWorktreeConflict(taskId, status, options, escalate);
  }
}

function resolveNoWorktreeConflict(
  taskId: string,
  status: string,
  options: SpawnOptions,
  escalate: EscalateFn
): void {
  // No worktree mode - clear completed/error states
  if (['completed', 'error', 'reaped', 'rejected'].includes(status)) {
    if (!options.json) {
      console.log(`Clearing previous ${taskId} (${status})...`);
    }
    // synchronous delete not available, handled by caller
    void deleteAgentFromDb(taskId);
  } else {
    escalate(`Agent ${taskId} in unexpected state: ${status}`, [
      `agent:clear ${taskId}    # Force clear state`
    ]);
  }
}

async function resolveWorktreeConflict(
  taskId: string,
  agentInfo: AgentRecord,
  worktreeRecord: NonNullable<AgentRecord['worktree']>,
  options: SpawnOptions,
  projectRoot: string,
  escalate: EscalateFn
): Promise<void> {
  const worktreePath = worktreeRecord.path;
  const branch = worktreeRecord.branch;
  const status = agentInfo.status;

  if (!fs.existsSync(worktreePath)) {
    // Worktree doesn't exist, just clear db entry
    if (!options.json) {
      console.log(`Clearing stale entry for ${taskId}...`);
    }
    await deleteAgentFromDb(taskId);
    return;
  }

  // Check for uncommitted changes, commits ahead, and merge status
  const baseBranch = worktreeRecord.base_branch || 'main';
  const worktreeGit = getGit(worktreePath);
  const worktreeStatus = await worktreeGit.status();
  const isDirty = !worktreeStatus.isClean();
  const worktreeLog = await worktreeGit.log({ from: baseBranch, to: 'HEAD' });
  const commitsAhead = worktreeLog.total;

  // Check if branch is already merged into main (handles non-fast-forward merges)
  const ops = new WorktreeOps(projectRoot, getWorktreesDir());
  const isMerged = ops.branchExists(branch) ? ops.isAncestor(branch, baseBranch) : true;

  await resolveWorktreeByState(taskId, status, isDirty, commitsAhead, isMerged, options, escalate);
}

async function autoCleanWorktree(taskId: string, reason: string, options: SpawnOptions): Promise<void> {
  if (!options.json) {
    console.log(`Auto-cleaning previous ${taskId} (${reason})...`);
  }
  removeWorktree(taskId, { force: true });
  await deleteAgentFromDb(taskId);
}

function classifyUnmergedWorktreeState(
  status: string,
  isDirty: boolean,
  commitsAhead: number
): string {
  const isTerminal = status === 'completed' || status === 'reaped';
  if (isTerminal && (isDirty || commitsAhead > 0)) return 'unmerged_work';
  if (isDirty) return 'dirty_incomplete';
  if (commitsAhead > 0 && status !== 'reaped') return 'commits_not_merged';
  if (commitsAhead === 0) return 'clean_no_commits';
  return 'unknown';
}

function classifyWorktreeState(
  status: string,
  isDirty: boolean,
  commitsAhead: number,
  isMerged: boolean
): string {
  if (isMerged) return isDirty ? 'merged_dirty' : 'merged_clean';
  return classifyUnmergedWorktreeState(status, isDirty, commitsAhead);
}

async function resolveWorktreeByState(
  taskId: string,
  status: string,
  isDirty: boolean,
  commitsAhead: number,
  isMerged: boolean,
  options: SpawnOptions,
  escalate: EscalateFn
): Promise<void> {
  const classification = classifyWorktreeState(status, isDirty, commitsAhead, isMerged);

  if (classification === 'merged_clean' || classification === 'clean_no_commits') {
    const reason = classification === 'merged_clean' ? 'already merged' : 'no changes';
    await autoCleanWorktree(taskId, reason, options);
    return;
  }

  const resumeEscalateMap: Record<string, { resumeMsg: string; reason: string; steps: string[] }> = {
    merged_dirty: {
      resumeMsg: `Resuming ${taskId} with uncommitted changes (branch already merged)...`,
      reason: `Agent ${taskId} has uncommitted changes (branch already merged)`,
      steps: [`agent:spawn ${taskId} --resume  # Continue with existing work`,
              `agent:reject ${taskId}          # Discard uncommitted work`]
    },
    unmerged_work: {
      resumeMsg: `Resuming ${taskId} with existing work (${isDirty ? 'uncommitted changes' : commitsAhead + ' commits'})...`,
      reason: `Agent ${taskId} has unmerged work`,
      steps: [`agent:spawn ${taskId} --resume  # Continue with existing work`,
              `agent:reap ${taskId}            # Merge + cleanup + respawn`,
              `agent:reject ${taskId}          # Discard work`]
    },
    dirty_incomplete: {
      resumeMsg: `Resuming ${taskId} with uncommitted changes (status: ${status})...`,
      reason: `Agent ${taskId} has uncommitted changes (status: ${status})`,
      steps: [`agent:spawn ${taskId} --resume  # Continue with existing work`,
              `agent:reap ${taskId}            # Try to harvest`,
              `agent:reject ${taskId}          # Discard work`]
    },
    commits_not_merged: {
      resumeMsg: `Resuming ${taskId} with ${commitsAhead} commit(s)...`,
      reason: `Agent ${taskId} has ${commitsAhead} commit(s) not merged`,
      steps: [`agent:spawn ${taskId} --resume  # Continue with existing work`,
              `agent:reap ${taskId}            # Merge + cleanup`,
              `agent:reject ${taskId}          # Discard work`]
    }
  };

  const entry = resumeEscalateMap[classification];
  if (entry) {
    resolveWithResumeOrEscalate(taskId, options, escalate, entry.resumeMsg, entry.reason, entry.steps);
  }
}

function resolveWithResumeOrEscalate(
  taskId: string,
  options: SpawnOptions,
  escalate: EscalateFn,
  resumeMsg: string,
  escalateReason: string,
  escalateSteps: string[]
): void {
  if (options.resume) {
    if (!options.json) {
      console.log(resumeMsg);
    }
  } else {
    escalate(escalateReason, escalateSteps);
  }
}

async function validateGitState(projectRoot: string, useWorktree: boolean): Promise<void> {
  if (!useWorktree) return;

  const git = getGit(projectRoot);

  // Check git repo exists
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    console.error('BLOCKED: use_worktrees requires a git repository\n');
    console.error('Escalate for resolution.');
    process.exit(1);
  }

  // Check for uncommitted changes
  const gitStatus = await git.status();
  if (!gitStatus.isClean()) {
    printDirtyWorkdirError(gitStatus);
    process.exit(1);
  }

  // Check for commits (git worktree requires at least one commit)
  const repoLog = await git.log().catch(() => ({ total: 0 }));
  if (repoLog.total === 0) {
    console.error('BLOCKED: No commits in repository\n');
    console.error('Git worktree requires at least one commit to create branches.');
    console.error('Escalate for resolution.');
    process.exit(1);
  }
}

function printDirtyWorkdirError(gitStatus: { modified: string[]; created: string[]; deleted: string[]; not_added: string[] }): void {
  console.error('BLOCKED: Working directory has uncommitted changes\n');
  console.error('Worktree isolation requires a clean working directory.');
  console.error('Escalate for resolution.\n');
  console.error('Uncommitted files:');
  const allFiles = [...gitStatus.modified, ...gitStatus.created, ...gitStatus.deleted, ...gitStatus.not_added];
  allFiles.slice(0, 10).forEach(file => console.error(`  ${file}`));
  if (allFiles.length > 10) {
    console.error(`  ... and ${allFiles.length - 10} more`);
  }
}

function checkPendingMemoryGuard(epicId: string): void {
  const pendingMemory = checkPendingMemory(epicId);
  if (pendingMemory.pending) {
    console.error('BLOCKED: Pending memory logs require analysis\n');
    console.error(`Epic(s) with unprocessed logs: ${pendingMemory.epics.join(', ')}`);
    console.error('\nMemory logs must be analyzed before spawning new agents.');
    console.error('Escalate for resolution.\n');
    console.error('Next steps:');
    console.error(`  bin/rudder memory:analyze ${pendingMemory.epics[0]}  # Analyze and consolidate`);
    console.error('  bin/rudder memory:status                           # Check status');
    process.exit(1);
  }
}

function setupBranchHierarchy(
  useWorktree: boolean,
  branching: string,
  branchContext: { prdId: string; epicId: string; branching: string },
  options: SpawnOptions
): void {
  if (!useWorktree || branching === 'flat') return;

  // 1. First ensure branch hierarchy exists (prd/epic branches)
  const hierarchyResult = ensureBranchHierarchy(branchContext);
  if (!options.json && !options.dryRun && hierarchyResult.created.length > 0) {
    console.log('Created branches:');
    hierarchyResult.created.forEach(b => console.log(`  ${b}`));
  }
  if (hierarchyResult.errors.length > 0) {
    console.error('Branch creation errors:');
    hierarchyResult.errors.forEach(e => console.error(`  ${e}`));
    process.exit(1);
  }

  // 2. Sync parent branch with its upstream (one level only)
  const syncResult = syncParentBranch(branchContext);

  if (!options.json && !options.dryRun) {
    if (syncResult.synced) {
      console.log(`Synced: ${syncResult.synced}`);
    }
    if (syncResult.error) {
      console.error(`Sync error: ${syncResult.error}`);
      console.error('\nResolve conflicts manually or use /dev:merge skill.');
      process.exit(1);
    }
  }
}

function resolveWorktreeOption(agentConfig: ReturnType<typeof getAgentConfig>, options: SpawnOptions): boolean {
  if (options.worktree === true) return true;
  if (options.worktree === false) return false;
  return agentConfig.use_worktrees;
}

function logOrphanedWorktreeResume(taskId: string, details: string[]): void {
  console.log(`Resuming in existing worktree for ${taskId}...`);
  details.forEach(d => console.log(`  ${d}`));
}

function buildWorktreeWorkDetails(isDirty: boolean, commitsAhead: number, mainBranch: string): string[] {
  const details: string[] = [];
  if (isDirty) details.push('(has uncommitted changes)');
  if (commitsAhead > 0) details.push(`(has ${commitsAhead} commit(s) ahead of ${mainBranch})`);
  return details;
}

async function inspectOrphanedWorktree(taskId: string): Promise<{
  worktreePath: string; branch: string; mainBranch: string;
  isDirty: boolean; commitsAhead: number; hasWork: boolean;
} | null> {
  if (!worktreeExists(taskId)) return null;

  const worktreePath = getWorktreePath(taskId);
  const branch = getBranchName(taskId);
  const mainBranch = getMainBranch();

  const wtGit = getGit(worktreePath);
  const wtStatus = await wtGit.status();
  const isDirty = !wtStatus.isClean();
  const wtLog = await wtGit.log({ from: mainBranch, to: 'HEAD' });
  const commitsAhead = wtLog.total;
  const hasWork = isDirty || commitsAhead > 0;

  return { worktreePath, branch, mainBranch, isDirty, commitsAhead, hasWork };
}

async function handleOrphanedWorktree(
  taskId: string,
  branching: string,
  options: SpawnOptions,
  escalate: EscalateFn
): Promise<WorktreeInfo | null> {
  const inspection = await inspectOrphanedWorktree(taskId);
  if (!inspection) return null;

  const { worktreePath, branch, mainBranch, isDirty, commitsAhead, hasWork } = inspection;

  if (!hasWork) {
    if (!options.json) {
      console.log(`Auto-cleaning orphaned worktree for ${taskId}...`);
    }
    removeWorktree(taskId, { force: true });
    return null;
  }

  if (options.resume) {
    if (!options.json) {
      logOrphanedWorktreeResume(taskId, buildWorktreeWorkDetails(isDirty, commitsAhead, mainBranch));
    }
    return { path: worktreePath, branch, base_branch: mainBranch, branching, resumed: true };
  }

  const workDesc = isDirty ? `Has uncommitted changes` : `Has ${commitsAhead} commit(s) ahead of ${mainBranch}`;
  escalate(`Orphaned worktree exists for ${taskId}`, [
    `Path: ${worktreePath}`,
    `Branch: ${branch}`,
    workDesc,
    ``,
    `Options:`,
    `  agent:spawn ${taskId} --resume  # Continue with existing work`,
    `  agent:sync                      # Recover into state`,
    `  agent:reject ${taskId}          # Discard work`
  ]);
  return null;
}

function createNewWorktree(
  taskId: string,
  branchContext: { prdId: string; epicId: string; branching: string },
  branching: string,
  options: SpawnOptions
): WorktreeInfo {
  const parentBranch = getParentBranch(taskId, branchContext);
  const result = createWorktree(taskId, { baseBranch: parentBranch });
  if (!result.success) {
    console.error(`Failed to create worktree: ${result.error}`);
    process.exit(1);
  }

  if (!options.json) {
    if (result.reused) {
      console.log(`Worktree created (reusing existing branch): ${result.path}`);
      console.log(`  Branch: ${result.branch} (orphaned, no commits)`);
    } else {
      console.log(`Worktree created: ${result.path}`);
      console.log(`  Branch: ${result.branch} (from ${parentBranch})`);
    }
  }

  return {
    path: result.path,
    branch: result.branch,
    base_branch: result.baseBranch,
    branching
  };
}

async function setupWorktree(
  taskId: string,
  useWorktree: boolean,
  branchContext: { prdId: string; epicId: string; branching: string },
  branching: string,
  options: SpawnOptions,
  escalate: EscalateFn
): Promise<{ worktreeInfo: WorktreeInfo | null; cwd: string }> {
  const projectRoot = findProjectRoot();

  if (!useWorktree) return { worktreeInfo: null, cwd: projectRoot };

  // Handle orphaned worktree (exists on disk but not in state.json)
  const orphanResult = await handleOrphanedWorktree(taskId, branching, options, escalate);
  if (orphanResult) {
    return { worktreeInfo: orphanResult, cwd: orphanResult.path };
  }

  // Create new worktree
  const worktreeInfo = createNewWorktree(taskId, branchContext, branching, options);
  return { worktreeInfo, cwd: worktreeInfo.path };
}

function claimTask(runManager: AgentRunManager, taskId: string, options: SpawnOptions): void {
  const claimResult = runManager.claim(taskId, 'task');
  if (claimResult.success) {
    if (!options.json) {
      const msg = claimResult.alreadyClaimed
        ? `Task ${taskId} resuming (already claimed)`
        : `Task ${taskId} claimed`;
      console.log(msg);
    }
  } else if (claimResult.error) {
    console.error(`Warning: Claim issue: ${claimResult.error}`);
  }
}

function buildBootstrapPrompt(taskId: string, useWorktree: boolean): string {
  const promptResult = buildAgentSpawnPrompt(taskId, { useWorktree });
  if (!promptResult) {
    console.error(`Error: Failed to build prompt for task ${taskId}`);
    process.exit(1);
  }
  return promptResult.prompt;
}

function buildAndWriteMission(params: {
  taskId: string; epicId: string; prdId: string;
  taskBody: string; taskFile: string;
  projectRoot: string; useWorktree: boolean;
  timeout: number; agentDir: string;
}): void {
  const mission = createMission({
    task_id: params.taskId,
    epic_id: params.epicId,
    prd_id: params.prdId,
    instruction: params.taskBody,
    dev_md: findDevMd(params.projectRoot) || '',
    epic_file: getEpic(params.epicId)?.file || null,
    task_file: params.taskFile,
    memory: getMemoryFile(params.epicId)?.file || null,
    toolset: findToolset(params.projectRoot),
    constraints: { no_git_commit: params.useWorktree },
    timeout: params.timeout
  });
  const missionFile = path.join(params.agentDir, 'mission.yaml');
  fs.writeFileSync(missionFile, yaml.dump(mission));
}

async function spawnAndSaveAgent(params: {
  taskId: string; bootstrapPrompt: string; cwd: string; timeout: number;
  agentDir: string; projectRoot: string; options: SpawnOptions;
  agentConfig: ReturnType<typeof getAgentConfig>; worktreeInfo: WorktreeInfo | null;
}): Promise<ReturnType<typeof spawnClaude>> {
  const isQuiet = params.options.verbose !== true;
  const shouldLog = params.options.log !== false && !isQuiet;

  const paths = getPathsInfo();
  const spawnResult = spawnClaude({
    prompt: params.bootstrapPrompt,
    cwd: params.cwd,
    logFile: getLogFilePath(getAgentsDir(), params.taskId),
    timeout: params.timeout,
    agentDir: params.agentDir,
    taskId: params.taskId,
    projectRoot: params.projectRoot,
    quietMode: !shouldLog,
    riskyMode: params.agentConfig.risky_mode,
    sandbox: params.agentConfig.sandbox,
    maxBudgetUsd: params.agentConfig.max_budget_usd,
    watchdogTimeout: params.agentConfig.watchdog_timeout,
    baseSrtConfigPath: paths.srtConfig?.absolute,
    appendLogs: params.worktreeInfo?.resumed
  });

  const taskNum = parseTaskNum(params.taskId);
  if (taskNum === null) {
    console.error(`Invalid task ID: ${params.taskId}`);
    process.exit(1);
  }

  const agentEntry: AgentRecord = {
    taskNum,
    status: 'spawned',
    spawned_at: new Date().toISOString(),
    pid: spawnResult.pid,
    agent_dir: params.agentDir,
    mcp_server: spawnResult.mcpServerPath || undefined,
    mcp_port: spawnResult.mcpPort ?? undefined,
    mcp_pid: spawnResult.mcpPid,
    timeout: params.timeout,
    ...(params.worktreeInfo && { worktree: params.worktreeInfo })
  };
  await saveAgentToDb(params.taskId, agentEntry);

  return spawnResult;
}

async function handleExitDbUpdate(
  taskId: string,
  code: number | null,
  signal: NodeJS.Signals | null,
  dirtyWorktree: boolean,
  uncommittedFiles: number
): Promise<void> {
  const currentAgent = getAgentFromDb(taskId);
  if (!currentAgent) return;

  const updates: Partial<AgentRecord> = {
    status: code === 0 ? 'completed' : 'error',
    exit_code: code,
    exit_signal: signal,
    ended_at: new Date().toISOString(),
    pid: undefined
  };
  if (dirtyWorktree) {
    updates.dirty_worktree = true;
    updates.uncommitted_files = uncommittedFiles;
  }
  await saveAgentToDb(taskId, { ...currentAgent, ...updates });
}

function handleExitAutoRelease(
  taskId: string,
  code: number | null,
  dirtyWorktree: boolean,
  commitsAhead: number,
  runManager: AgentRunManager
): void {
  if (code !== 0) return;
  if (!dirtyWorktree && commitsAhead === 0) return;

  const releaseResult = runManager.release(taskId);
  if (releaseResult.success && !releaseResult.notClaimed) {
    console.log(`✓ Auto-released ${taskId} (agent didn't call assign:release)`);
  } else if (!releaseResult.success) {
    console.error(`⚠ Auto-release failed for ${taskId}: ${releaseResult.error}`);
  }
}

async function handleExitAutoPr(
  taskId: string,
  code: number | null,
  agentConfig: ReturnType<typeof getAgentConfig>,
  projectRoot: string
): Promise<void> {
  if (code !== 0) return;
  if (!agentConfig.auto_pr) return;

  const updatedAgent = getAgentFromDb(taskId);
  if (!updatedAgent?.worktree) return;

  // Get task info from artefacts (not stored in agent record)
  const taskInfo = getTask(taskId);
  const taskTitle = taskInfo?.data?.title;
  const prEpicId = taskInfo?.data?.parent ? extractEpicId(taskInfo.data.parent) : null;
  const prPrdId = taskInfo?.data?.parent ? extractPrdId(taskInfo.data.parent) : null;

  const prResult = await createPr(taskId, {
    cwd: projectRoot,
    title: taskTitle ? `${taskId}: ${taskTitle}` : undefined,
    draft: agentConfig.pr_draft,
    epicId: prEpicId || undefined,
    prdId: prPrdId || undefined
  });
  if ('url' in prResult) {
    await updateAgentInDb(taskId, {
      pr_url: prResult.url,
      pr_created_at: new Date().toISOString()
    });
    console.log(`Auto-PR created for ${taskId}: ${prResult.url}`);
  } else {
    console.error(`Auto-PR failed for ${taskId}: ${prResult.error}`);
  }
}

function handleExitAutoDiagnose(
  taskId: string,
  agentConfig: ReturnType<typeof getAgentConfig>,
  agentUtils: AgentUtils,
  epicId: string
): void {
  if (agentConfig.auto_diagnose === false) return;

  const diagLogFile = path.join(agentUtils.getAgentDir(taskId), 'run.jsonlog');
  if (!fs.existsSync(diagLogFile)) return;

  const result = getDiagnoseOps().analyzeLog(diagLogFile, epicId);
  if (result.errors.length > 0) {
    console.log(`\n--- Diagnostic Report ---`);
    printDiagnoseResult(taskId, result);
    console.log(`\n🛑 STOP - Action required:`);
    console.log(`  • If noise: rudder agent:log-noise-add-filter <id> ${taskId} --contains "pattern"`);
    console.log(`  • If real issue: escalate and fix the sandbox/environment problem`);
  }
}

function handleAgentExit(
  taskId: string,
  cwd: string,
  useWorktree: boolean,
  worktreeInfo: WorktreeInfo | null,
  agentConfig: ReturnType<typeof getAgentConfig>,
  runManager: AgentRunManager,
  agentUtils: AgentUtils,
  epicId: string,
  projectRoot: string
): (code: number | null, signal: NodeJS.Signals | null) => void {
  return (code, signal) => void (async () => {
    const exitGit = getGit(cwd);
    const gitStatusResult = await exitGit.status();
    const dirtyWorktree = !gitStatusResult.isClean();
    const allModified = [...gitStatusResult.modified, ...gitStatusResult.created, ...gitStatusResult.deleted, ...gitStatusResult.not_added];
    const uncommittedFiles = allModified.length;

    if (dirtyWorktree && !useWorktree) {
      console.error(`\n⚠️  WARNING: Agent ${taskId} left uncommitted changes`);
      console.error(`   ${uncommittedFiles} file(s) modified but not committed.`);
      console.error(`   Agent should have committed before releasing task.\n`);
    }

    let commitsAhead = 0;
    if (useWorktree && worktreeInfo?.base_branch) {
      const exitLog = await exitGit.log({ from: worktreeInfo.base_branch, to: 'HEAD' });
      commitsAhead = (exitLog as { total: number }).total;
    }

    await handleExitDbUpdate(taskId, code, signal, dirtyWorktree, uncommittedFiles);
    handleExitAutoRelease(taskId, code, dirtyWorktree, commitsAhead, runManager);
    await handleExitAutoPr(taskId, code, agentConfig, projectRoot);
    handleExitAutoDiagnose(taskId, agentConfig, agentUtils, epicId);
  })();
}

function printSpawnBanner(
  taskId: string,
  spawnResult: ReturnType<typeof spawnClaude>,
  worktreeInfo: WorktreeInfo | null,
  useWorktree: boolean,
  agentConfig: ReturnType<typeof getAgentConfig>,
  timeout: number,
  shouldLog: boolean,
  heartbeatSec: number,
  shouldHeartbeat: boolean
): void {
  const budgetStr = agentConfig.max_budget_usd > 0 ? `$${agentConfig.max_budget_usd}` : 'unlimited';
  const watchdogStr = agentConfig.watchdog_timeout > 0 ? `${agentConfig.watchdog_timeout}s` : 'disabled';

  console.log(`\n┌─ Spawned: ${taskId} ─────────────────────────────────────`);
  console.log(`│ PID: ${spawnResult.pid}`);
  console.log(`│ Mode: ${useWorktree ? 'worktree (isolated branch)' : 'direct'}`);
  if (worktreeInfo) {
    console.log(`│ Branch: ${worktreeInfo.branch}`);
  }
  console.log(`│ Timeout: ${timeout}s | Budget: ${budgetStr} | Watchdog: ${watchdogStr}`);
  console.log(`├─ Logging ────────────────────────────────────────────────`);
  console.log(`│ • stdout: filtered [INIT] [TOOL] [RESULT] [TEXT] [DONE]`);
  console.log(`│ • .log:     ${spawnResult.logFile || 'none'}`);
  console.log(`│ • .jsonlog: ${spawnResult.jsonLogFile || 'none'}`);
  console.log(`│ • Output = activity (watchdog resets, agent not stale)`);
  console.log(`├─ Behavior ───────────────────────────────────────────────`);
  console.log(`│ • Streaming Claude output${shouldLog ? '' : ' (disabled)'}`);
  console.log(`│ • Heartbeat every ${heartbeatSec}s${shouldHeartbeat ? '' : ' (disabled)'}`);
  console.log(`│ • Auto-reap on success (merge + cleanup + status update)`);
  console.log(`├─ Signals ────────────────────────────────────────────────`);
  console.log(`│ • Ctrl+C: detach (agent continues in background)`);
  console.log(`│ • kill -HUP ${process.pid}: force status check`);
  console.log(`└──────────────────────────────────────────────────────────\n`);
}

function printExitStatusQuiet(taskId: string, exitCode: number | null, elapsed: number): void {
  if (exitCode === 0) {
    console.log(`${taskId}: ✓ completed (${formatDuration(elapsed)})`);
  } else {
    console.log(`${taskId}: ✗ failed (exit: ${exitCode}, ${formatDuration(elapsed)})`);
  }
}

function printExitStatusVerbose(taskId: string, exitCode: number | null, elapsed: number): void {
  console.log('─'.repeat(60));
  if (exitCode === 0) {
    console.log(`✓ ${taskId} completed (${formatDuration(elapsed)})`);
  } else {
    console.log(`✗ ${taskId} failed (exit: ${exitCode}, ${formatDuration(elapsed)})`);
  }
}

async function autoReapOnSuccess(taskId: string, isQuiet: boolean): Promise<void> {
  if (!isQuiet) console.log(`\nAuto-reaping ${taskId}...`);
  const reapResult = await getAgentLifecycle(taskId).reap({ verbose: !isQuiet });
  if (reapResult.success) {
    if (!isQuiet) {
      console.log(`✓ Merged ${taskId}${reapResult.cleanedUp ? ' (cleaned up)' : ''}`);
      console.log(`✓ Task ${taskId} → ${reapResult.taskStatus}`);
    }
    if (isQuiet) console.log(`${taskId}: ✓ reaped`);
  } else if (reapResult.escalate) {
    console.error(`Reap failed: ${reapResult.escalate.reason}`);
    console.error(`Manual: bin/rudder agent:reap ${taskId}`);
  }
}

function printFailureNextSteps(taskId: string): void {
  console.log(`\nNext steps:`);
  console.log(`  bin/rudder agent:log ${taskId}     # Check full log`);
  console.log(`  bin/rudder agent:reject ${taskId}  # Discard work`);
}

function emitHeartbeatQuiet(taskId: string, elapsed: number): void {
  console.log(`${taskId}: running... ${formatDuration(elapsed)}`);
}

function emitHeartbeatVerbose(taskId: string, pid: number, elapsed: number): void {
  const stats = getProcessStats(pid);
  const memInfo = stats.mem ? ` (mem: ${stats.mem})` : '';
  console.log(`[${formatDuration(elapsed)}] pong — ${taskId} ${stats.running ? 'running' : 'stopped'}${memInfo}`);
}

function setupSignalHandlers(
  taskId: string,
  pid: number,
  startTime: number,
  isQuiet: boolean,
  showOutput: boolean
): { cleanup: () => void; startHeartbeat: (intervalMs: number) => void } {
  const emitHeartbeat = () => {
    const elapsed = Date.now() - startTime;
    if (isQuiet) {
      emitHeartbeatQuiet(taskId, elapsed);
    } else {
      emitHeartbeatVerbose(taskId, pid, elapsed);
    }
  };

  const sighupHandler = () => { emitHeartbeat(); };
  process.on('SIGHUP', sighupHandler);

  const sigintHandler = () => {
    if (showOutput) {
      console.log(`\n\nDetaching from ${taskId} (agent continues in background)`);
      console.log(`Monitor: bin/rudder agent:log ${taskId} --tail`);
      console.log(`Reap:    bin/rudder agent:reap ${taskId}`);
    }
    cleanup();
    process.exit(0);
  };
  process.on('SIGINT', sigintHandler);

  const sigtermHandler = () => {
    if (showOutput) {
      console.log(`\nReceived SIGTERM, killing agent ${taskId}...`);
    }
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    cleanup();
    process.exit(1);
  };
  process.on('SIGTERM', sigtermHandler);

  let heartbeatTimer: NodeJS.Timeout | null = null;

  function cleanup(): void {
    process.off('SIGHUP', sighupHandler);
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigtermHandler);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }

  function startHeartbeat(intervalMs: number): void {
    heartbeatTimer = setInterval(emitHeartbeat, intervalMs);
  }

  return { cleanup, startHeartbeat };
}

function printSpawnMessage(
  taskId: string,
  options: SpawnOptions,
  isQuiet: boolean,
  heartbeatSec: number,
  spawnResult: ReturnType<typeof spawnClaude>,
  worktreeInfo: WorktreeInfo | null,
  useWorktree: boolean,
  agentConfig: ReturnType<typeof getAgentConfig>,
  timeout: number,
  shouldLog: boolean,
  shouldHeartbeat: boolean
): void {
  if (options.json) return;
  if (isQuiet) {
    console.log(`${taskId}: spawned (heartbeat every ${heartbeatSec}s)`);
  } else {
    printSpawnBanner(taskId, spawnResult, worktreeInfo, useWorktree, agentConfig, timeout, shouldLog, heartbeatSec, shouldHeartbeat);
  }
}

function reportJsonResult(
  taskId: string,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | null,
  elapsed: number,
  worktreeInfo: WorktreeInfo | null
): void {
  jsonOut({
    task_id: taskId,
    status: exitCode === 0 ? 'completed' : 'error',
    exit_code: exitCode,
    exit_signal: exitSignal,
    elapsed_ms: elapsed,
    ...(worktreeInfo && { worktree: worktreeInfo })
  });
}

async function waitAndReap(
  taskId: string,
  options: SpawnOptions,
  spawnResult: ReturnType<typeof spawnClaude>,
  worktreeInfo: WorktreeInfo | null,
  useWorktree: boolean,
  agentConfig: ReturnType<typeof getAgentConfig>,
  timeout: number,
  shouldLog: boolean
): Promise<void> {
  const startTime = Date.now();
  const isQuiet = options.verbose !== true;
  const defaultHeartbeat = isQuiet ? 60 : 30;
  const heartbeatSec = typeof options.heartbeat === 'number' ? options.heartbeat : defaultHeartbeat;
  const shouldHeartbeat = options.heartbeat !== false;

  printSpawnMessage(taskId, options, isQuiet, heartbeatSec, spawnResult, worktreeInfo, useWorktree, agentConfig, timeout, shouldLog, shouldHeartbeat);

  const showOutput = !options.json;
  const signals = setupSignalHandlers(taskId, spawnResult.pid, startTime, isQuiet, showOutput);

  if (shouldHeartbeat && showOutput) {
    signals.startHeartbeat(heartbeatSec * 1000);
  }

  // Wait for process to exit
  const { code: exitCode, signal: exitSignal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    spawnResult.process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve({ code, signal });
    });
  });

  signals.cleanup();

  const elapsed = Date.now() - startTime;

  if (options.json) {
    reportJsonResult(taskId, exitCode, exitSignal, elapsed, worktreeInfo);
    return;
  }

  if (isQuiet) {
    printExitStatusQuiet(taskId, exitCode, elapsed);
  } else {
    printExitStatusVerbose(taskId, exitCode, elapsed);
  }

  if (exitCode === 0) {
    await autoReapOnSuccess(taskId, isQuiet);
  } else if (!isQuiet) {
    printFailureNextSteps(taskId);
  }
}

export function registerSpawnCommand(agent: Command) {
  withModifies(agent.command('spawn <task-id>'), ['task', 'git', 'state'])
    .description('Spawn agent to execute task (creates worktree, spawns Claude)')
    .option('--role <role>', 'Role context (skill, coordinator) - agent role blocked')
    .option('--timeout <seconds>', 'Execution timeout (default: 600)', parseInt)
    .option('--worktree', 'Create isolated worktree (overrides config)')
    .option('--no-worktree', 'Skip worktree creation (overrides config)')
    .option('--no-log', 'Do not stream Claude stdout/stderr')
    .option('--no-heartbeat', 'Do not show periodic heartbeat')
    .option('--heartbeat <seconds>', 'Heartbeat interval (default: 60 quiet, 30 verbose)', parseInt)
    .option('-v, --verbose', 'Detailed output (spawn box, Claude streaming)')
    .option('--resume', 'Reuse existing worktree (continue blocked/partial work)')
    .action(async (taskId: string, options: SpawnOptions) => {
      const preconditions = validateSpawnPreconditions(taskId, options);
      taskId = preconditions.taskId;
      const { taskFile, task, prdId, epicId, agentConfig } = preconditions;

      const projectRoot = findProjectRoot();
      const escalate = buildEscalate(taskId, options);

      checkMcpServerRunning(escalate);

      const existingAgent = getAgentFromDb(taskId);
      if (existingAgent) {
        await resolveExistingAgent(taskId, existingAgent, options, projectRoot, escalate);
      }

      const agentsDir = getAgentsDir();
      const agentUtils = new AgentUtils(agentsDir);
      const runManager = new AgentRunManager(agentsDir);
      const agentDir = ensureDir(agentUtils.getAgentDir(taskId));

      const useWorktree = resolveWorktreeOption(agentConfig, options);

      await validateGitState(projectRoot, useWorktree);
      checkPendingMemoryGuard(epicId);

      const branching = getPrdBranching(prdId);
      const branchContext = { prdId, epicId, branching };

      setupBranchHierarchy(useWorktree, branching, branchContext, options);

      const timeout = options.timeout || agentConfig.timeout || 600;

      const bootstrapPrompt = buildBootstrapPrompt(taskId, useWorktree);

      if (options.dryRun) {
        console.log('Agent spawn (dry run):\n');
        console.log(`Task: ${taskId}`);
        console.log(`Epic: ${epicId}, PRD: ${prdId}`);
        console.log(`Worktree: ${useWorktree ? 'yes' : 'no'}`);
        console.log(`Timeout: ${timeout}s`);
        console.log(`Agent dir: ${agentDir}`);
        console.log(`\nBootstrap prompt:\n${bootstrapPrompt}`);
        return;
      }

      const worktreeResult = await setupWorktree(taskId, useWorktree, branchContext, branching, options, escalate);
      const { worktreeInfo } = worktreeResult;
      const cwd = worktreeResult.cwd;

      claimTask(runManager, taskId, options);

      buildAndWriteMission({
        taskId, epicId, prdId,
        taskBody: task.body.trim(), taskFile,
        projectRoot, useWorktree, timeout, agentDir
      });

      const spawnResult = await spawnAndSaveAgent({
        taskId, bootstrapPrompt, cwd, timeout,
        agentDir, projectRoot, options, agentConfig, worktreeInfo
      });

      spawnResult.process.on('exit', handleAgentExit(
        taskId, cwd, useWorktree, worktreeInfo, agentConfig, runManager, agentUtils, epicId, projectRoot
      ));

      const isQuiet = options.verbose !== true;
      const shouldLog = options.log !== false && !isQuiet;
      await waitAndReap(taskId, options, spawnResult, worktreeInfo, useWorktree, agentConfig, timeout, shouldLog);
    });
}
