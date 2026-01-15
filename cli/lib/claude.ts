/**
 * Claude Subprocess Management
 *
 * PURE LIB: No config access, no manager imports.
 * All config values must be passed as parameters.
 */
import path from 'path';
import fs from 'fs';
import { spawnClaudeWithSrt, generateSrtConfig, generateAgentMcpConfig, checkMcpServer, startSocatBridge } from './srt.js';
import type { ChildProcess } from 'child_process';

export interface SpawnClaudeResult {
  process: ChildProcess;
  pid: number;
  logFile?: string;
  jsonLogFile?: string;
  srtConfig?: string | null;
  mcpConfig?: string | null;
  mcpSocket?: string | null;
  mcpPid?: number | null;
  mcpPort?: number | null;
  mcpServerPath?: string | null;
  sandboxHome?: string | null;
  bridgePid?: number | null;
  bridgeSocket?: string | null;
  bridgeCleanup?: (() => void) | null;
}

/**
 * Generate agent-specific srt config
 * When using external MCP (sandbox mode), agent only needs worktree write access
 * MCP server runs outside sandbox and handles all sailing operations
 * @param options.agentDir - Agent directory path
 * @param options.cwd - Working directory (worktree)
 * @param options.logFile - Log file path
 * @param options.taskId - Task ID (to identify current worktree)
 * @param options.baseSrtConfigPath - Base srt config path (optional)
 * @param options.externalMcp - If true, only allow worktree writes (MCP handles haven)
 * @param options.mcpSocket - MCP Unix socket path to bind-mount into sandbox
 * @returns Path to generated srt config
 */
export function generateAgentSrtConfig(options: {
  agentDir: string;
  cwd: string;
  logFile: string;
  taskId: string;
  baseSrtConfigPath?: string;
  externalMcp?: boolean;
  mcpSocket?: string;
}): string {
  const { agentDir, cwd, logFile, taskId, baseSrtConfigPath, externalMcp = false, mcpSocket } = options;

  // Base write paths: worktree + log directory
  const additionalWritePaths = [
    cwd,                          // Worktree directory
    path.dirname(logFile)         // Log directory
  ];

  // Add MCP socket to allow socat to connect from inside sandbox
  if (mcpSocket) {
    additionalWritePaths.push(mcpSocket);
  }

  // If NOT using external MCP, agent needs haven write access for rudder commands
  // (this is the fallback mode when MCP runs inside sandbox)
  if (!externalMcp) {
    const agentsBaseDir = path.dirname(agentDir);  // .../agents
    const havenDir = path.dirname(agentsBaseDir);  // .../havens/<hash>
    additionalWritePaths.push(havenDir);
  }

  // Block reading of other worktrees and haven artefacts
  // Agent should use MCP for context, not explore the filesystem
  const havenDir = getHavenDir(agentDir);
  const additionalDenyReadPaths = [];

  // Block other worktrees (agent should only see its own)
  const worktreesDir = path.join(havenDir, 'worktrees');
  if (fs.existsSync(worktreesDir)) {
    const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== taskId) {
        additionalDenyReadPaths.push(path.join(worktreesDir, entry.name));
      }
    }
  }

  // Block other agents' directories
  const agentsDir = path.join(havenDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== taskId) {
        additionalDenyReadPaths.push(path.join(agentsDir, entry.name));
      }
    }
  }

  // Block artefacts - agent should use MCP context:load, not read files
  additionalDenyReadPaths.push(path.join(havenDir, 'artefacts'));

  // On Linux, allowAllUnixSockets is required to disable seccomp AF_UNIX blocking
  // This allows the agent to connect to MCP server via Unix socket
  const isLinux = process.platform === 'linux';

  return generateSrtConfig({
    baseConfigPath: baseSrtConfigPath,
    outputPath: path.join(agentDir, 'srt-settings.json'),
    additionalWritePaths,
    additionalDenyReadPaths,
    allowUnixSockets: mcpSocket ? [mcpSocket] : [],
    allowAllUnixSockets: isLinux,  // Required for socket mode on Linux
    strictMode: true
  });
}

/**
 * Get haven directory from agent directory
 * @param {string} agentDir - Agent directory path (.../havens/<hash>/agents/T042)
 * @returns {string} Haven directory path (.../havens/<hash>)
 */
function getHavenDir(agentDir) {
  // agentDir = .../havens/<hash>/agents/T042
  // havenDir = .../havens/<hash>
  return path.dirname(path.dirname(agentDir));
}

export interface SpawnClaudeOptions {
  prompt: string;
  cwd: string;
  logFile: string;
  agentDir?: string;
  taskId?: string;
  projectRoot?: string;
  timeout?: number;
  riskyMode?: boolean;
  sandbox?: boolean;
  stderrToFile?: boolean | string;
  quietMode?: boolean;
  maxBudgetUsd?: number;
  watchdogTimeout?: number;
  baseSrtConfigPath?: string;  // Base srt config path for sandbox mode
}

/**
 * Spawn Claude subprocess
 * Config values (riskyMode, sandbox, maxBudgetUsd, watchdogTimeout, baseSrtConfigPath) should be passed explicitly.
 */
export async function spawnClaude(options: SpawnClaudeOptions): Promise<SpawnClaudeResult> {
  const { prompt, cwd, logFile, timeout, agentDir, taskId, projectRoot, stderrToFile, quietMode, baseSrtConfigPath } = options;

  // Config values must be passed explicitly (no defaults from config)
  const riskyMode = options.riskyMode ?? false;
  const sandbox = options.sandbox ?? false;

  // When sandbox is enabled with agent context, use external MCP
  // MCP server runs OUTSIDE sandbox at haven level, agent connects via Unix socket
  const useExternalMcp = sandbox && agentDir && projectRoot;

  // Start external MCP server if needed (before Claude, outside sandbox)
  let mcpInfo: { configPath: string; mode: string } | null = null;
  let mcpSocket: string | null = null;
  let mcpPid: number | null = null;
  let mcpPort: number | null = null;
  let mcpServerPath: string | null = null;

  // Socat bridge for port mode on Linux (works around --unshare-net)
  let bridgePid: number | null = null;
  let bridgeSocket: string | null = null;
  let bridgeCleanup: (() => void) | null = null;

  const isLinux = process.platform === 'linux';

  if (useExternalMcp) {
    const havenDir = getHavenDir(agentDir);
    const mcpStatus = checkMcpServer(havenDir);

    if (!mcpStatus.running) {
      throw new Error(
        'MCP server not running. Start it first:\n\n' +
        '  bin/rudder-mcp start\n\n' +
        'Then retry spawn. Check status with "bin/rudder-mcp status".\n' +
        'Transport mode (socket/port) is set in .sailing/config.yaml (agent.mcp_mode).'
      );
    }

    mcpPid = mcpStatus.pid;

    // Generate MCP config based on mode (socket or port)
    if (mcpStatus.mode === 'port') {
      // On Linux with sandbox, port mode needs a socat bridge
      // because --unshare-net isolates the network namespace
      if (isLinux && sandbox) {
        // Start socat bridge: Unix socket → TCP port
        const bridgeSocketPath = path.join(agentDir, 'mcp-bridge.sock');
        const bridge = startSocatBridge({
          socketPath: bridgeSocketPath,
          targetPort: mcpStatus.port
        });
        bridgePid = bridge.pid;
        bridgeSocket = bridge.socket;
        bridgeCleanup = bridge.cleanup;

        // Agent connects to bridge socket instead of TCP port
        mcpSocket = bridgeSocket;
        mcpInfo = generateAgentMcpConfig({
          outputPath: path.join(agentDir, 'mcp-config.json'),
          projectRoot,
          externalSocket: bridgeSocket  // Use bridge socket
        });
        console.error(`Using MCP server (pid: ${mcpPid}, port: ${mcpStatus.port} via bridge socket)`);
      } else {
        // Non-Linux or no sandbox: direct TCP connection
        mcpInfo = generateAgentMcpConfig({
          outputPath: path.join(agentDir, 'mcp-config.json'),
          projectRoot,
          externalPort: mcpStatus.port
        });
        mcpPort = mcpStatus.port ?? null;
        console.error(`Using MCP server (pid: ${mcpPid}, port: ${mcpStatus.port})`);
      }
    } else {
      mcpSocket = mcpStatus.socket;
      mcpServerPath = mcpSocket || null;
      mcpInfo = generateAgentMcpConfig({
        outputPath: path.join(agentDir, 'mcp-config.json'),
        projectRoot,
        externalSocket: mcpSocket
      });
      console.error(`Using MCP server (pid: ${mcpPid}, socket)`);
    }
  }

  // If not using external MCP, generate internal MCP config
  if (!mcpInfo && agentDir && projectRoot) {
    mcpInfo = generateAgentMcpConfig({
      outputPath: path.join(agentDir, 'mcp-config.json'),
      projectRoot,
      taskId  // Task restriction only for internal mode
    });
  }

  // Generate srt config if sandbox enabled
  // On Linux, sandbox + MCP requires:
  // - allowAllUnixSockets: true (disables seccomp AF_UNIX blocking)
  // - For port mode: socat bridge (started above) to work around --unshare-net
  let srtConfigPath: string | null = null;
  if (sandbox) {
    if (agentDir) {
      srtConfigPath = generateAgentSrtConfig({
        agentDir,
        cwd,
        logFile,
        taskId,
        baseSrtConfigPath,
        externalMcp: !!mcpSocket,  // Strict sandbox if external MCP is active
        mcpSocket                   // Pass socket for macOS allowUnixSockets
      });
    } else if (baseSrtConfigPath) {
      srtConfigPath = baseSrtConfigPath;
    }
  }

  // Setup output handlers for quiet mode
  let onStdout: ((data: Buffer) => void) | null = null;
  let onStderr: ((data: Buffer) => void) | null = null;
  if (quietMode) {
    // Quiet mode: suppress all console output (log file still gets it)
    onStdout = () => {};
    onStderr = () => {};
  } else if (stderrToFile) {
    // Just stderr to file only
    onStderr = () => {};
  }

  // Sandbox HOME isolation: use agentDir/home to isolate Claude's config
  // Required to prevent race conditions when spawning multiple agents in parallel
  const sandboxHome = sandbox && agentDir ? path.join(agentDir, 'home') : null;

  // Budget and watchdog from options
  const maxBudgetUsd = options.maxBudgetUsd;
  const watchdogTimeout = options.watchdogTimeout;

  const result = spawnClaudeWithSrt({
    prompt,
    cwd,
    logFile,
    sandbox,
    srtConfigPath,
    riskyMode,
    timeout,
    onStdout,
    onStderr,
    mcpConfigPath: mcpInfo?.configPath,
    sandboxHome,
    maxBudgetUsd,
    watchdogTimeout
  });

  // Clean up bridge when process exits
  if (bridgeCleanup) {
    result.process.on('exit', () => {
      bridgeCleanup();
    });
  }

  return {
    ...result,
    srtConfig: srtConfigPath,
    mcpConfig: mcpInfo?.configPath,
    mcpSocket,
    mcpPid,
    mcpPort,
    mcpServerPath,
    sandboxHome,
    bridgePid,
    bridgeSocket,
    bridgeCleanup
  };
}

/**
 * Build prompt from mission file
 * @param {object} mission - Mission object from YAML
 * @returns {string} Formatted prompt
 */
export function buildPromptFromMission(mission) {
  const parts = [];

  // Task identity
  parts.push(`# Agent Mission: ${mission.task_id}`);
  parts.push(`Epic: ${mission.epic_id}, PRD: ${mission.prd_id}`);
  parts.push('');

  // Instructions
  parts.push('## Instructions');
  parts.push(mission.instruction);
  parts.push('');

  // Context files
  if (mission.context) {
    parts.push('## Context');

    if (mission.context.task_file) {
      parts.push(`- Task file: ${mission.context.task_file}`);
    }
    if (mission.context.epic_file) {
      parts.push(`- Epic file: ${mission.context.epic_file}`);
    }
    if (mission.context.memory) {
      parts.push(`- Memory: ${mission.context.memory}`);
    }
    if (mission.context.dev_md) {
      parts.push(`- Dev docs: ${mission.context.dev_md}`);
    }
    if (mission.context.toolset) {
      parts.push(`- Toolset: ${mission.context.toolset}`);
    }
    parts.push('');
  }

  // Constraints
  if (mission.constraints) {
    parts.push('## Constraints');
    if (mission.constraints.no_git_commit) {
      parts.push('- NO git commit (user will commit after review)');
    }
    parts.push('');
  }

  // Result expectations
  parts.push('## Expected Output');
  parts.push('When complete, create a result.yaml file in the agent directory with:');
  parts.push('- status: completed | failed | blocked');
  parts.push('- files_modified: list of files changed');
  parts.push('- log: structured log entries');
  parts.push('- issues: any problems encountered');
  parts.push('');
  parts.push('Create a "done" sentinel file when finished.');

  return parts.join('\n');
}

/**
 * Get log file path for a task
 * @param agentsDir - Agents directory path
 * @param taskId - Task ID
 * @returns Absolute path to log file
 */
export function getLogFilePath(agentsDir: string, taskId: string): string {
  return path.join(agentsDir, taskId, 'run.log');
}
