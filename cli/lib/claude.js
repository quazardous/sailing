/**
 * Claude Subprocess Management
 *
 * Spawns Claude Code as subprocess with appropriate flags based on config.
 * Uses srt.js for actual spawning.
 */
import path from 'path';
import { getAgentConfig } from './config.js';
import { getAgentsDir, getPathsInfo } from './core.js';
import { spawnClaudeWithSrt, generateSrtConfig, generateAgentMcpConfig } from './srt.js';

// Alias for internal use
const getAgentsBaseDir = getAgentsDir;

/**
 * Generate agent-specific srt config
 * Agents are sandboxed to ONLY write to their worktree + /tmp (strict mode)
 * @param {object} options - Options
 * @param {string} options.agentDir - Agent directory path
 * @param {string} options.cwd - Working directory (worktree)
 * @param {string} options.logFile - Log file path
 * @returns {string} Path to generated srt config
 */
export function generateAgentSrtConfig(options) {
  const { agentDir, cwd, logFile } = options;
  const paths = getPathsInfo();

  return generateSrtConfig({
    baseConfigPath: paths.srtConfig?.absolute,
    outputPath: path.join(agentDir, 'srt-settings.json'),
    additionalWritePaths: [
      cwd,                          // Worktree directory
      agentDir,                     // Agent directory (for mission, result files)
      path.dirname(logFile)         // Log directory
    ],
    strictMode: true                // Agents can ONLY write to worktree + /tmp
  });
}

/**
 * Spawn Claude subprocess
 * @param {object} options - Spawn options
 * @param {string} options.prompt - The prompt to send to Claude
 * @param {string} options.cwd - Working directory (worktree path)
 * @param {string} options.logFile - Path to log file for stdout/stderr
 * @param {string} [options.agentDir] - Agent directory (for srt config generation)
 * @param {string} [options.taskId] - Task ID for MCP server restriction
 * @param {string} [options.projectRoot] - Project root for MCP server
 * @param {number} [options.timeout] - Timeout in seconds
 * @param {boolean} [options.riskyMode] - Override risky_mode config
 * @param {boolean} [options.sandbox] - Override sandbox config
 * @param {boolean|string} [options.stderrToFile] - Redirect stderr to file only (true=logFile, string=custom path)
 * @returns {{ process: ChildProcess, pid: number, logFile: string, srtConfig?: string, mcpConfig?: string }}
 */
export function spawnClaude(options) {
  const { prompt, cwd, logFile, timeout, agentDir, taskId, projectRoot, stderrToFile } = options;
  const config = getAgentConfig();
  const paths = getPathsInfo();

  const riskyMode = options.riskyMode ?? config.risky_mode;
  const sandbox = options.sandbox ?? config.sandbox;

  // Generate srt config if sandbox enabled
  let srtConfigPath = null;
  if (sandbox) {
    if (agentDir) {
      srtConfigPath = generateAgentSrtConfig({ agentDir, cwd, logFile });
    } else if (paths.srtConfig?.absolute) {
      srtConfigPath = paths.srtConfig.absolute;
    }
  }

  // Generate MCP config for agent with task restriction
  let mcpConfigPath = null;
  let mcpInfo = null;
  if (agentDir && taskId && projectRoot) {
    mcpInfo = generateAgentMcpConfig({
      outputPath: path.join(agentDir, 'mcp-config.json'),
      taskId,
      projectRoot
    });
    mcpConfigPath = mcpInfo.configPath;
  }

  // Setup stderr handler for stderrToFile option
  let onStderr = null;
  if (stderrToFile) {
    // Stderr to file only (quiet mode) - don't output to console
    onStderr = () => {}; // swallow console output, log file still gets it
  }

  // Sandbox HOME isolation: use agentDir/home to isolate Claude's config
  const sandboxHome = sandbox && agentDir ? path.join(agentDir, 'home') : null;

  const result = spawnClaudeWithSrt({
    prompt,
    cwd,
    logFile,
    sandbox,
    srtConfigPath,
    riskyMode,
    timeout,
    onStderr,
    mcpConfigPath,
    sandboxHome
  });

  return {
    ...result,
    srtConfig: srtConfigPath,
    mcpConfig: mcpConfigPath,
    mcpServerPath: mcpInfo?.mcpServerPath,
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
