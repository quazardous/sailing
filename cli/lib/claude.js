/**
 * Claude Subprocess Management
 *
 * Spawns Claude Code as subprocess with appropriate flags based on config.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getAgentConfig } from './config.js';
import { getAgentsDir } from './core.js';
import { ensureDir } from './paths.js';

// Alias for internal use
const getAgentsBaseDir = getAgentsDir;

/**
 * Build Claude command arguments based on config and options
 * @param {object} options - Command options
 * @param {string} options.prompt - The prompt to send to Claude
 * @param {boolean} [options.riskyMode] - Override risky_mode config
 * @param {boolean} [options.sandbox] - Override sandbox config
 * @returns {string[]} Command arguments
 */
export function buildClaudeArgs(options) {
  const config = getAgentConfig();

  const riskyMode = options.riskyMode ?? config.risky_mode;
  const sandbox = options.sandbox ?? config.sandbox;

  const args = [];

  // Sandbox mode (placeholder - requires sandbox-runtime integration)
  // TODO: Implement srt wrapper when sandbox-runtime is available
  // if (sandbox) { ... }

  // Risky mode: --dangerously-skip-permissions
  if (riskyMode) {
    args.push('--dangerously-skip-permissions');
  }

  // Prompt (using -p for non-interactive mode)
  args.push('-p');
  args.push(options.prompt);

  return args;
}

/**
 * Spawn Claude subprocess
 * @param {object} options - Spawn options
 * @param {string} options.prompt - The prompt to send to Claude
 * @param {string} options.cwd - Working directory (worktree path)
 * @param {string} options.logFile - Path to log file for stdout/stderr
 * @param {number} [options.timeout] - Timeout in seconds
 * @param {boolean} [options.riskyMode] - Override risky_mode config
 * @param {boolean} [options.sandbox] - Override sandbox config
 * @returns {{ process: ChildProcess, pid: number, logFile: string }}
 */
export function spawnClaude(options) {
  const { prompt, cwd, logFile, timeout } = options;

  // Ensure log directory exists
  ensureDir(path.dirname(logFile));

  // Build arguments
  const args = buildClaudeArgs({
    prompt,
    riskyMode: options.riskyMode,
    sandbox: options.sandbox
  });

  // Create log file stream
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  // Log start
  const startTime = new Date().toISOString();
  logStream.write(`\n=== Claude Started: ${startTime} ===\n`);
  logStream.write(`CWD: ${cwd}\n`);
  logStream.write(`Args: ${args.join(' ')}\n`);
  logStream.write('='.repeat(50) + '\n\n');

  // Spawn Claude
  const child = spawn('claude', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  // Pipe stdout/stderr to log file
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  // Handle timeout
  let timeoutId = null;
  if (timeout && timeout > 0) {
    timeoutId = setTimeout(() => {
      logStream.write(`\n=== TIMEOUT after ${timeout}s ===\n`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeout * 1000);
  }

  // Clean up on exit
  child.on('exit', (code, signal) => {
    if (timeoutId) clearTimeout(timeoutId);
    const endTime = new Date().toISOString();
    logStream.write(`\n=== Claude Exited: ${endTime} ===\n`);
    logStream.write(`Exit code: ${code}, Signal: ${signal}\n`);
    logStream.end();
  });

  return {
    process: child,
    pid: child.pid,
    logFile
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
