/**
 * Claude Subprocess Management
 *
 * Spawns Claude Code as subprocess with appropriate flags based on config.
 * Uses srt.js for actual spawning.
 */
import path from 'path';
import { getAgentConfig } from './config.js';
import { getAgentsDir, getPathsInfo } from './core.js';
import { spawnClaudeWithSrt, generateSrtConfig, generateAgentMcpConfig, startExternalMcpServer } from './srt.js';

// Alias for internal use
const getAgentsBaseDir = getAgentsDir;

/**
 * Generate agent-specific srt config
 * When using external MCP (sandbox mode), agent only needs worktree write access
 * MCP server runs outside sandbox and handles all sailing operations
 * @param {object} options - Options
 * @param {string} options.agentDir - Agent directory path
 * @param {string} options.cwd - Working directory (worktree)
 * @param {string} options.logFile - Log file path
 * @param {boolean} [options.externalMcp=false] - If true, only allow worktree writes (MCP handles haven)
 * @returns {string} Path to generated srt config
 */
export function generateAgentSrtConfig(options) {
  const { agentDir, cwd, logFile, externalMcp = false } = options;
  const paths = getPathsInfo();

  // Base write paths: worktree + log directory
  const additionalWritePaths = [
    cwd,                          // Worktree directory
    path.dirname(logFile)         // Log directory
  ];

  // If NOT using external MCP, agent needs haven write access for rudder commands
  // (this is the fallback mode when MCP runs inside sandbox)
  if (!externalMcp) {
    const agentsBaseDir = path.dirname(agentDir);  // .../agents
    const havenDir = path.dirname(agentsBaseDir);  // .../havens/<hash>
    additionalWritePaths.push(havenDir);
  }

  return generateSrtConfig({
    baseConfigPath: paths.srtConfig?.absolute,
    outputPath: path.join(agentDir, 'srt-settings.json'),
    additionalWritePaths,
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

/**
 * Spawn Claude subprocess
 * @param {object} options - Spawn options
 * @param {string} options.prompt - The prompt to send to Claude
 * @param {string} options.cwd - Working directory (worktree path)
 * @param {string} options.logFile - Path to log file for stdout/stderr
 * @param {string} [options.agentDir] - Agent directory (for srt config generation)
 * @param {string} [options.taskId] - Task ID (for logging, not MCP restriction)
 * @param {string} [options.projectRoot] - Project root for MCP server
 * @param {number} [options.timeout] - Timeout in seconds
 * @param {boolean} [options.riskyMode] - Override risky_mode config
 * @param {boolean} [options.sandbox] - Override sandbox config
 * @param {boolean|string} [options.stderrToFile] - Redirect stderr to file only (true=logFile, string=custom path)
 * @returns {Promise<{ process: ChildProcess, pid: number, logFile: string, srtConfig?: string, mcpConfig?: string, mcpSocket?: string, mcpPid?: number }>}
 */
export async function spawnClaude(options) {
  const { prompt, cwd, logFile, timeout, agentDir, taskId, projectRoot, stderrToFile } = options;
  const config = getAgentConfig();
  const paths = getPathsInfo();

  const riskyMode = options.riskyMode ?? config.risky_mode;
  const sandbox = options.sandbox ?? config.sandbox;

  // When sandbox is enabled with agent context, use external MCP
  // MCP server runs OUTSIDE sandbox at haven level, agent connects via Unix socket
  const useExternalMcp = sandbox && agentDir && projectRoot;

  // Start external MCP server if needed (before Claude, outside sandbox)
  let mcpInfo = null;
  let mcpSocket = null;
  let mcpPid = null;
  let mcpReused = false;

  if (useExternalMcp) {
    try {
      const havenDir = getHavenDir(agentDir);
      const externalMcp = await startExternalMcpServer({
        havenDir,
        projectRoot
      });
      mcpSocket = externalMcp.socket;
      mcpPid = externalMcp.pid;
      mcpReused = externalMcp.reused;

      // Generate MCP config with socat bridge to Unix socket
      mcpInfo = generateAgentMcpConfig({
        outputPath: path.join(agentDir, 'mcp-config.json'),
        projectRoot,
        externalSocket: mcpSocket
      });

      if (mcpReused) {
        console.error(`MCP server already running (pid: ${mcpPid})`);
      }
    } catch (err) {
      console.error(`Failed to start external MCP server: ${err.message}`);
      // Fall back to internal MCP (with haven write access)
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
  let srtConfigPath = null;
  if (sandbox) {
    if (agentDir) {
      srtConfigPath = generateAgentSrtConfig({
        agentDir,
        cwd,
        logFile,
        externalMcp: !!mcpSocket  // Strict sandbox if external MCP is active
      });
    } else if (paths.srtConfig?.absolute) {
      srtConfigPath = paths.srtConfig.absolute;
    }
  }

  // Setup stderr handler for stderrToFile option
  let onStderr = null;
  if (stderrToFile) {
    // Stderr to file only (quiet mode) - don't output to console
    onStderr = () => {}; // swallow console output, log file still gets it
  }

  // Sandbox HOME isolation: use agentDir/home to isolate Claude's config
  // DISABLED for debugging - using normal HOME
  // const sandboxHome = sandbox && agentDir ? path.join(agentDir, 'home') : null;
  const sandboxHome = null;

  const result = spawnClaudeWithSrt({
    prompt,
    cwd,
    logFile,
    sandbox,
    srtConfigPath,
    riskyMode,
    timeout,
    onStderr,
    mcpConfigPath: mcpInfo?.configPath,
    sandboxHome
  });

  return {
    ...result,
    srtConfig: srtConfigPath,
    mcpConfig: mcpInfo?.configPath,
    mcpSocket,
    mcpPid,
    mcpReused,
    sandboxHome
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
 * @param {string} taskId - Task ID
 * @returns {string} Absolute path to log file
 */
export function getLogFilePath(taskId) {
  return path.join(getAgentsBaseDir(), taskId, 'run.log');
}
