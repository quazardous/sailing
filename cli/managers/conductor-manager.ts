/**
 * Conductor Manager
 *
 * Orchestrates agent lifecycle operations with event emission.
 * Wraps agent-manager operations and emits events for real-time updates.
 *
 * MANAGER: Has config access, composes libs and other managers.
 */
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { eventBus } from '../lib/event-bus.js';
import { getAgentLifecycle, type ReapResult, type KillResult } from './agent-manager.js';
import { getAgentFromDb, getAllAgentsFromDb, getAgentsArray, saveAgentToDb } from './db-manager.js';
import { findProjectRoot, getAgentsDir, getAgentConfig, resolvePlaceholders } from './core-manager.js';
import { normalizeId, extractPrdId, extractEpicId } from '../lib/normalize.js';
import { parseTaskNum } from '../lib/agent-paths.js';
import { spawnClaude, getLogFilePath } from '../lib/claude.js';
import { buildAgentSpawnPrompt } from './compose-manager.js';
import { createWorktree, removeWorktree, getWorktreePath, getBranchName, worktreeExists, getMainBranch, getParentBranch, ensureBranchHierarchy, syncParentBranch } from './worktree-manager.js';
import { getTask, getEpic, getMemoryFile, getPrdBranching } from './artefacts-manager.js';
import { loadFile, ensureDir, getPathsInfo, findDevMd, findToolset } from './core-manager.js';
import { createMission } from '../lib/agent-schema.js';
import { AgentUtils } from '../lib/agent-utils.js';
import { AgentRunManager } from '../lib/agent-run.js';
import { getGit } from '../lib/git.js';
import { checkMcpAgentServer } from '../lib/srt.js';
import type { AgentRecord } from '../lib/types/agent.js';
import type { ChildProcess } from 'child_process';

// ============================================================================
// Types
// ============================================================================

export interface SpawnOptions {
  timeout?: number;
  worktree?: boolean;
  resume?: boolean;
  verbose?: boolean;
}

export interface SpawnResult {
  success: boolean;
  taskId: string;
  pid?: number;
  worktree?: {
    path: string;
    branch: string;
    baseBranch: string;
  };
  logFile?: string;
  error?: string;
  escalate?: {
    reason: string;
    nextSteps: string[];
  };
}

export interface AgentStatus {
  taskId: string;
  status: string;
  pid?: number;
  isRunning: boolean;
  worktree?: {
    path: string;
    branch: string;
  };
  spawnedAt?: string;
  completedAt?: string;
  exitCode?: number;
  resultStatus?: string;
}

export interface LogStreamOptions {
  follow?: boolean;
  tail?: number;
}

export type LogLine = {
  taskId: string;
  line: string;
  timestamp: string;
};

// ============================================================================
// ConductorManager Class
// ============================================================================

/**
 * Central orchestration manager for agent lifecycle.
 * Emits events for all state changes.
 */
export class ConductorManager {
  private readonly projectRoot: string;
  private readonly agentsDir: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private logStreams: Map<string, fs.FSWatcher> = new Map();

  constructor() {
    this.projectRoot = findProjectRoot();
    this.agentsDir = getAgentsDir();
  }

  // --------------------------------------------------------------------------
  // Agent Lifecycle Operations
  // --------------------------------------------------------------------------

  /**
   * Spawn an agent for a task
   * Emits: agent:spawned
   */
  async spawn(taskId: string, options: SpawnOptions = {}): Promise<SpawnResult> {
    taskId = normalizeId(taskId, undefined, 'task');
    const agentConfig = getAgentConfig();

    // Find task
    const taskInfo = getTask(taskId);
    if (!taskInfo?.file) {
      return {
        success: false,
        taskId,
        error: `Task not found: ${taskId}`
      };
    }

    // Load task data
    const task = loadFile(taskInfo.file);
    if (!task) {
      return {
        success: false,
        taskId,
        error: `Could not load task file: ${taskInfo.file}`
      };
    }

    // Extract IDs
    const prdId = extractPrdId(task.data.parent);
    const epicId = extractEpicId(task.data.parent);
    if (!prdId || !epicId) {
      return {
        success: false,
        taskId,
        error: `Could not extract PRD/Epic IDs from parent: ${task.data.parent}`
      };
    }

    // Check MCP agent server (required for spawning agents)
    const havenDir = resolvePlaceholders('${haven}');
    const mcpStatus = checkMcpAgentServer(havenDir);
    if (!mcpStatus.running) {
      return {
        success: false,
        taskId,
        escalate: {
          reason: 'MCP agent server not running',
          nextSteps: [
            'bin/rdrctl start     # Start MCP servers',
            'bin/rdrctl status    # Check server status',
            'Note: Requires use_subprocess=true in config'
          ]
        }
      };
    }

    // Check existing agent
    const existingAgent = getAgentFromDb(taskId);
    if (existingAgent?.pid) {
      try {
        process.kill(existingAgent.pid, 0);
        return {
          success: false,
          taskId,
          escalate: {
            reason: `Agent ${taskId} is still running (PID ${existingAgent.pid})`,
            nextSteps: [
              `agent:wait ${taskId}     # Wait for completion`,
              `agent:kill ${taskId}     # Force terminate`,
              `agent:reap ${taskId}     # Wait + harvest results`
            ]
          }
        };
      } catch {
        // Process not running, can proceed
      }
    }

    // Setup agent directory
    const agentUtils = new AgentUtils(this.agentsDir);
    const runManager = new AgentRunManager(this.agentsDir);
    const agentDir = ensureDir(agentUtils.getAgentDir(taskId));

    // Determine worktree mode
    let useWorktree = agentConfig.use_worktrees;
    if (options.worktree === true) useWorktree = true;
    else if (options.worktree === false) useWorktree = false;

    // Verify git repo if worktree mode
    if (useWorktree) {
      const git = getGit(this.projectRoot);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return {
          success: false,
          taskId,
          escalate: {
            reason: 'use_worktrees requires a git repository',
            nextSteps: [
              'git init',
              'git add .',
              'git commit -m "Initial commit"'
            ]
          }
        };
      }

      const gitStatus = await git.status();
      if (!gitStatus.isClean()) {
        const allFiles = [...gitStatus.modified, ...gitStatus.created, ...gitStatus.deleted, ...gitStatus.not_added];
        return {
          success: false,
          taskId,
          escalate: {
            reason: 'Working directory has uncommitted changes',
            nextSteps: [
              'Commit or stash changes before spawning agents',
              `Files: ${allFiles.slice(0, 5).join(', ')}${allFiles.length > 5 ? ` (+${allFiles.length - 5} more)` : ''}`
            ]
          }
        };
      }

      // Check for at least one commit (git worktree requires commits to create branches)
      const repoLog = await git.log().catch(() => ({ total: 0 }));
      if ((repoLog as { total: number }).total === 0) {
        return {
          success: false,
          taskId,
          escalate: {
            reason: 'No commits in repository',
            nextSteps: [
              'Git worktree requires at least one commit to create branches',
              'git add .',
              'git commit -m "Initial commit"'
            ]
          }
        };
      }
    }

    // Get branching strategy
    const branching = getPrdBranching(prdId);
    const branchContext = { prdId, epicId, branching };

    // Ensure branch hierarchy
    if (useWorktree && branching !== 'flat') {
      const hierarchyResult = ensureBranchHierarchy(branchContext);
      if (hierarchyResult.errors.length > 0) {
        return {
          success: false,
          taskId,
          error: `Branch creation errors: ${hierarchyResult.errors.join(', ')}`
        };
      }

      const syncResult = syncParentBranch(branchContext);
      if (syncResult.error) {
        return {
          success: false,
          taskId,
          error: `Sync error: ${syncResult.error}`
        };
      }
    }

    // Get timeout
    const timeout = options.timeout || agentConfig.timeout || 600;

    // Create mission file
    const mission = createMission({
      task_id: taskId,
      epic_id: epicId,
      prd_id: prdId,
      instruction: task.body.trim(),
      dev_md: findDevMd(this.projectRoot) || '',
      epic_file: getEpic(epicId)?.file || null,
      task_file: taskInfo.file,
      memory: getMemoryFile(epicId)?.file || null,
      toolset: findToolset(this.projectRoot),
      constraints: { no_git_commit: useWorktree },
      timeout
    });
    const missionFile = path.join(agentDir, 'mission.yaml');

    // Build bootstrap prompt
    const promptResult = buildAgentSpawnPrompt(taskId, { useWorktree });
    if (!promptResult) {
      return {
        success: false,
        taskId,
        error: `Failed to build prompt for task ${taskId}`
      };
    }

    // Create worktree if enabled
    let worktreeInfo: { path: string; branch: string; base_branch: string; branching: string } | null = null;
    let cwd = this.projectRoot;

    if (useWorktree) {
      // Handle existing worktree
      if (worktreeExists(taskId)) {
        if (options.resume) {
          const wtPath = getWorktreePath(taskId);
          const branch = getBranchName(taskId);
          const mainBranch = getMainBranch();
          worktreeInfo = {
            path: wtPath,
            branch,
            base_branch: mainBranch,
            branching
          };
          cwd = wtPath;
        } else {
          const wtPath = getWorktreePath(taskId);
          const wtGit = getGit(wtPath);
          const wtStatus = await wtGit.status();

          if (!wtStatus.isClean()) {
            return {
              success: false,
              taskId,
              escalate: {
                reason: `Worktree exists for ${taskId} with uncommitted changes`,
                nextSteps: [
                  `agent:spawn ${taskId} --resume  # Continue with existing work`,
                  `agent:reject ${taskId}          # Discard work`
                ]
              }
            };
          }

          // Clean worktree - remove it
          removeWorktree(taskId, { force: true });
        }
      }

      // Create new worktree if not resuming
      if (!worktreeInfo) {
        const parentBranch = getParentBranch(taskId, branchContext);
        const result = createWorktree(taskId, { baseBranch: parentBranch });
        if (!result.success) {
          return {
            success: false,
            taskId,
            error: `Failed to create worktree: ${result.error}`
          };
        }

        worktreeInfo = {
          path: result.path,
          branch: result.branch,
          base_branch: result.baseBranch,
          branching
        };
        cwd = result.path;
      }
    }

    // Pre-claim task
    runManager.claim(taskId, 'task');

    // Write mission file
    const yaml = await import('js-yaml');
    fs.writeFileSync(missionFile, yaml.dump(mission));

    // Get log file path
    const logFile = getLogFilePath(this.agentsDir, taskId);

    // Spawn Claude
    const paths = getPathsInfo();
    try {
      const spawnResult = await spawnClaude({
        prompt: promptResult.prompt,
        cwd,
        logFile,
        timeout,
        agentDir,
        taskId,
        projectRoot: this.projectRoot,
        quietMode: true,
        riskyMode: agentConfig.risky_mode,
        sandbox: agentConfig.sandbox,
        maxBudgetUsd: agentConfig.max_budget_usd,
        watchdogTimeout: agentConfig.watchdog_timeout,
        baseSrtConfigPath: paths.srtConfig?.absolute
      });

      // Track process
      this.activeProcesses.set(taskId, spawnResult.process);

      // Save agent to db
      const taskNum = parseTaskNum(taskId);
      if (taskNum === null) {
        return {
          success: false,
          taskId,
          error: `Invalid task ID: ${taskId}`
        };
      }

      const agentEntry: AgentRecord = {
        taskNum,
        status: 'spawned',
        spawned_at: new Date().toISOString(),
        pid: spawnResult.pid,
        agent_dir: agentDir,
        mcp_server: spawnResult.mcpServerPath || undefined,
        mcp_port: spawnResult.mcpPort ?? undefined,
        mcp_pid: spawnResult.mcpPid,
        timeout,
        ...(worktreeInfo && { worktree: worktreeInfo })
      };
      await saveAgentToDb(taskId, agentEntry);

      // Emit spawned event
      eventBus.emit('agent:spawned', {
        taskId,
        pid: spawnResult.pid,
        worktree: worktreeInfo ? { path: worktreeInfo.path, branch: worktreeInfo.branch } : undefined,
        timestamp: new Date().toISOString()
      });

      // Setup exit handler
      spawnResult.process.on('exit', async (code, signal) => {
        this.activeProcesses.delete(taskId);

        // Check result status
        const agentDir = agentUtils.getAgentDir(taskId);
        const resultFile = path.join(agentDir, 'result.yaml');
        let resultStatus: 'completed' | 'blocked' = 'completed';
        if (fs.existsSync(resultFile)) {
          try {
            const content = fs.readFileSync(resultFile, 'utf8');
            const result = yaml.load(content) as { status?: string };
            resultStatus = (result.status as 'completed' | 'blocked') || 'completed';
          } catch { /* ignore */ }
        }

        // Update db
        const currentAgent = getAgentFromDb(taskId);
        if (currentAgent) {
          await saveAgentToDb(taskId, {
            ...currentAgent,
            status: code === 0 ? 'completed' : 'error',
            exit_code: code,
            exit_signal: signal,
            ended_at: new Date().toISOString(),
            result_status: resultStatus,
            pid: undefined
          });
        }

        // Emit completed event
        eventBus.emit('agent:completed', {
          taskId,
          exitCode: code,
          exitSignal: signal,
          resultStatus,
          timestamp: new Date().toISOString()
        });

        // Auto-release
        if (code === 0) {
          runManager.release(taskId);
        }
      });

      return {
        success: true,
        taskId,
        pid: spawnResult.pid,
        worktree: worktreeInfo ? {
          path: worktreeInfo.path,
          branch: worktreeInfo.branch,
          baseBranch: worktreeInfo.base_branch
        } : undefined,
        logFile
      };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        taskId,
        error
      };
    }
  }

  /**
   * Reap an agent (wait, merge, cleanup)
   * Emits: agent:reaped
   */
  async reap(taskId: string, options: { wait?: boolean; timeout?: number } = {}): Promise<ReapResult> {
    taskId = normalizeId(taskId, undefined, 'task');
    const lifecycle = getAgentLifecycle(taskId);
    const result = await lifecycle.reap(options);

    if (result.success) {
      eventBus.emit('agent:reaped', {
        taskId,
        merged: result.merged,
        taskStatus: result.taskStatus,
        timestamp: new Date().toISOString()
      });
    }

    return result;
  }

  /**
   * Kill an agent
   * Emits: agent:killed
   */
  async kill(taskId: string): Promise<KillResult> {
    taskId = normalizeId(taskId, undefined, 'task');

    // Try to kill tracked process first
    const process = this.activeProcesses.get(taskId);
    if (process) {
      this.activeProcesses.delete(taskId);
    }

    const lifecycle = getAgentLifecycle(taskId);
    const result = await lifecycle.kill();

    if (result.success && result.pid) {
      eventBus.emit('agent:killed', {
        taskId,
        pid: result.pid,
        timestamp: new Date().toISOString()
      });
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Status & Queries
  // --------------------------------------------------------------------------

  /**
   * Get agent status
   */
  getStatus(taskId: string): AgentStatus | null {
    taskId = normalizeId(taskId, undefined, 'task');
    const agent = getAgentFromDb(taskId);
    if (!agent) return null;

    let isRunning = false;
    if (agent.pid) {
      try {
        process.kill(agent.pid, 0);
        isRunning = true;
      } catch {
        // Not running
      }
    }

    return {
      taskId,
      status: agent.status,
      pid: agent.pid,
      isRunning,
      worktree: agent.worktree ? {
        path: agent.worktree.path,
        branch: agent.worktree.branch
      } : undefined,
      spawnedAt: agent.spawned_at,
      completedAt: agent.completed_at || agent.ended_at,
      exitCode: agent.exit_code,
      resultStatus: agent.result_status
    };
  }

  /**
   * Get all agents
   */
  getAllAgents(): Record<string, AgentRecord> {
    return getAllAgentsFromDb();
  }

  /**
   * Get agents by status
   */
  getAgentsByStatus(status: string): Array<AgentRecord & { taskId: string }> {
    return getAgentsArray({ status });
  }

  // --------------------------------------------------------------------------
  // Log Streaming
  // --------------------------------------------------------------------------

  /**
   * Create a log stream for an agent
   * Returns an async iterator that yields log lines
   */
  createLogStream(taskId: string, options: LogStreamOptions = {}): AsyncIterable<LogLine> {
    taskId = normalizeId(taskId, undefined, 'task');
    const { follow = true, tail = 100 } = options;
    const logFile = getLogFilePath(this.agentsDir, taskId);

    const self = this;

    return {
      [Symbol.asyncIterator](): AsyncIterator<LogLine> {
        let closed = false;
        const lineQueue: LogLine[] = [];
        let resolveNext: ((value: IteratorResult<LogLine>) => void) | null = null;
        let watcher: fs.FSWatcher | null = null;
        const readStream: Readable | null = null;
        let initialized = false;

        const pushLine = (line: string) => {
          const logLine: LogLine = {
            taskId,
            line,
            timestamp: new Date().toISOString()
          };

          // Emit event
          eventBus.emit('agent:log', {
            taskId,
            line,
            timestamp: logLine.timestamp
          });

          if (resolveNext) {
            resolveNext({ value: logLine, done: false });
            resolveNext = null;
          } else {
            lineQueue.push(logLine);
          }
        };

        const init = async () => {
          if (initialized) return;
          initialized = true;

          // Read existing content
          if (fs.existsSync(logFile)) {
            const content = fs.readFileSync(logFile, 'utf8');
            const lines = content.split('\n');
            const startIdx = Math.max(0, lines.length - tail);
            for (let i = startIdx; i < lines.length; i++) {
              if (lines[i]) pushLine(lines[i]);
            }
          }

          // Watch for changes if follow mode
          if (follow) {
            let lastSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;

            const watchDir = path.dirname(logFile);
            if (!fs.existsSync(watchDir)) {
              fs.mkdirSync(watchDir, { recursive: true });
            }

            watcher = fs.watch(watchDir, (event, filename) => {
              if (filename === path.basename(logFile)) {
                if (!fs.existsSync(logFile)) return;

                const stat = fs.statSync(logFile);
                if (stat.size > lastSize) {
                  const fd = fs.openSync(logFile, 'r');
                  const buffer = Buffer.alloc(stat.size - lastSize);
                  fs.readSync(fd, buffer, 0, buffer.length, lastSize);
                  fs.closeSync(fd);

                  const newContent = buffer.toString('utf8');
                  const lines = newContent.split('\n');
                  for (const line of lines) {
                    if (line) pushLine(line);
                  }
                  lastSize = stat.size;
                }
              }
            });

            self.logStreams.set(taskId, watcher);
          }
        };

        return {
          async next(): Promise<IteratorResult<LogLine>> {
            await init();

            if (closed) {
              return { done: true, value: undefined };
            }

            if (lineQueue.length > 0) {
              return { value: lineQueue.shift(), done: false };
            }

            if (!follow) {
              return { done: true, value: undefined };
            }

            // Wait for next line
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },

          async return(): Promise<IteratorResult<LogLine>> {
            closed = true;
            if (watcher) {
              watcher.close();
              self.logStreams.delete(taskId);
            }
            if (readStream) {
              readStream.destroy();
            }
            return { done: true, value: undefined };
          }
        };
      }
    };
  }

  /**
   * Get log content (non-streaming)
   */
  getLog(taskId: string, options: { tail?: number } = {}): string[] {
    taskId = normalizeId(taskId, undefined, 'task');
    const { tail } = options;
    const logFile = getLogFilePath(this.agentsDir, taskId);

    if (!fs.existsSync(logFile)) {
      return [];
    }

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l);

    if (tail) {
      return lines.slice(-tail);
    }
    return lines;
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Stop all log streams
   */
  stopAllLogStreams(): void {
    for (const [taskId, watcher] of this.logStreams) {
      watcher.close();
    }
    this.logStreams.clear();
  }

  /**
   * Kill all active agents
   */
  async killAll(): Promise<void> {
    const tasks = Array.from(this.activeProcesses.keys());
    await Promise.all(tasks.map(taskId => this.kill(taskId)));
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _instance: ConductorManager | null = null;

/**
 * Get conductor manager instance (singleton)
 */
export function getConductorManager(): ConductorManager {
  if (!_instance) {
    _instance = new ConductorManager();
  }
  return _instance;
}

/**
 * Reset conductor manager (for testing)
 */
export function resetConductorManager(): void {
  if (_instance) {
    _instance.stopAllLogStreams();
    _instance = null;
  }
}
