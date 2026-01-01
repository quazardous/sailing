/**
 * Claude Subprocess Management
 *
 * Spawns Claude Code as subprocess with appropriate flags based on config.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAgentConfig } from './config.js';
import { getAgentsDir, getPathsInfo } from './core.js';
import { ensureDir } from './paths.js';

// Alias for internal use
const getAgentsBaseDir = getAgentsDir;

/**
 * Load base srt config from project or generate defaults
 */
function loadBaseSrtConfig() {
  const paths = getPathsInfo();
  const homeDir = os.homedir();

  // Try to load from project config
  if (paths.srtConfig && fs.existsSync(paths.srtConfig.absolute)) {
    try {
      return JSON.parse(fs.readFileSync(paths.srtConfig.absolute, 'utf8'));
    } catch {
      // Fall through to defaults
    }
  }

  // Default config
  return {
    network: {
      allowedDomains: [
        'api.anthropic.com',
        '*.anthropic.com',
        'sentry.io',
        'statsig.anthropic.com',
        'github.com',
        '*.github.com',
        'api.github.com',
        'raw.githubusercontent.com',
        'registry.npmjs.org',
        '*.npmjs.org'
      ],
      deniedDomains: []
    },
    filesystem: {
      allowWrite: [
        `${homeDir}/.claude`,
        `${homeDir}/.claude.json`,
        `${homeDir}/.npm/_logs`,
        '/tmp'
      ],
      denyWrite: [],
      denyRead: [
        `${homeDir}/.ssh`,
        `${homeDir}/.gnupg`,
        `${homeDir}/.aws`
      ]
    }
  };
}

/**
 * Generate agent-specific srt config
 * @param {object} options - Options
 * @param {string} options.agentDir - Agent directory path
 * @param {string} options.cwd - Working directory (worktree)
 * @param {string} options.logFile - Log file path
 * @returns {string} Path to generated srt config
 */
export function generateAgentSrtConfig(options) {
  const { agentDir, cwd, logFile } = options;

  // Load base config
  const config = loadBaseSrtConfig();

  // Add agent-specific write paths
  const additionalPaths = [
    cwd,                          // Worktree directory
    agentDir,                     // Agent directory (for mission, result files)
    path.dirname(logFile)         // Log directory
  ];

  // Merge with base allowWrite (avoid duplicates)
  const existingPaths = new Set(config.filesystem.allowWrite);
  for (const p of additionalPaths) {
    if (p && !existingPaths.has(p)) {
      config.filesystem.allowWrite.push(p);
    }
  }

  // Write agent-specific config
  const configPath = path.join(agentDir, 'srt-settings.json');
  ensureDir(agentDir);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  return configPath;
}

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

  // Risky mode: --dangerously-skip-permissions
  if (riskyMode) {
    args.push('--dangerously-skip-permissions');
  }

  // Prompt (using -p for non-interactive mode)
  args.push('-p');
  args.push(options.prompt);

  return { args, sandbox };
}

/**
 * Spawn Claude subprocess
 * @param {object} options - Spawn options
 * @param {string} options.prompt - The prompt to send to Claude
 * @param {string} options.cwd - Working directory (worktree path)
 * @param {string} options.logFile - Path to log file for stdout/stderr
 * @param {string} [options.agentDir] - Agent directory (for srt config generation)
 * @param {number} [options.timeout] - Timeout in seconds
 * @param {boolean} [options.riskyMode] - Override risky_mode config
 * @param {boolean} [options.sandbox] - Override sandbox config
 * @param {boolean|string} [options.stderrToFile] - Redirect stderr to file only (true=logFile, string=custom path)
 * @returns {{ process: ChildProcess, pid: number, logFile: string, srtConfig?: string }}
 */
export function spawnClaude(options) {
  const { prompt, cwd, logFile, timeout, agentDir } = options;

  // Ensure log directory exists
  ensureDir(path.dirname(logFile));

  // Build arguments
  const { args, sandbox } = buildClaudeArgs({
    prompt,
    riskyMode: options.riskyMode,
    sandbox: options.sandbox
  });

  // Determine command and final args based on sandbox mode
  let command, finalArgs, srtConfigPath;
  if (sandbox) {
    // Generate agent-specific srt config with worktree paths
    if (agentDir) {
      srtConfigPath = generateAgentSrtConfig({
        agentDir,
        cwd,
        logFile
      });
    } else {
      // Fallback to project config
      const paths = getPathsInfo();
      if (paths.srtConfig && fs.existsSync(paths.srtConfig.absolute)) {
        srtConfigPath = paths.srtConfig.absolute;
      }
    }

    // Wrap with srt (sandbox-runtime): srt --settings <path> claude [args]
    command = 'srt';
    finalArgs = [];

    if (srtConfigPath) {
      finalArgs.push('--settings', srtConfigPath);
    }

    finalArgs.push('claude', ...args);
  } else {
    command = 'claude';
    finalArgs = args;
  }

  // Create log file stream
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  // Log start
  const startTime = new Date().toISOString();
  logStream.write(`\n=== Claude Started: ${startTime} ===\n`);
  logStream.write(`CWD: ${cwd}\n`);
  logStream.write(`Command: ${command} ${finalArgs.join(' ')}\n`);
  logStream.write(`Sandbox: ${sandbox ? 'enabled' : 'disabled'}\n`);
  if (srtConfigPath) {
    logStream.write(`SRT Config: ${srtConfigPath}\n`);
  }
  logStream.write('='.repeat(50) + '\n\n');

  // Spawn Claude (with or without sandbox wrapper)
  const child = spawn(command, finalArgs, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  // Pipe stdout to log file and console
  child.stdout.on('data', (data) => {
    logStream.write(data);
    process.stdout.write(data);
  });

  // Pipe stderr: to file only (--stderr-to-file) or console + log (default)
  const stderrToFile = options.stderrToFile;
  if (stderrToFile) {
    // Stderr to file only (quiet mode)
    const stderrPath = typeof stderrToFile === 'string' ? stderrToFile : logFile;
    const stderrStream = stderrPath === logFile ? logStream : fs.createWriteStream(stderrPath, { flags: 'a' });
    child.stderr.pipe(stderrStream);
  } else {
    // Default: stderr to both console and log (visible for srt debugging)
    child.stderr.on('data', (data) => {
      logStream.write(data);
      process.stderr.write(data);
    });
  }

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
    logFile,
    srtConfig: srtConfigPath
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
