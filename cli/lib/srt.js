/**
 * SRT (Sandbox Runtime) Wrapper
 *
 * Shared library for spawning Claude with or without srt sandbox.
 * Used by spawnClaude (agent:spawn) and sandbox:run.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { ensureDir } from './paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find rudder MCP server path for a project
 * Looks in project first, then falls back to current sailing installation
 * @param {string} projectRoot - Project root path
 * @returns {string} Path to MCP server
 */
export function findMcpServerPath(projectRoot) {
  // Priority 1: Project's own sailing installation
  const projectMcp = path.join(projectRoot, 'mcp', 'rudder-server.js');
  if (fs.existsSync(projectMcp)) {
    return projectMcp;
  }

  // Priority 2: Project's node_modules sailing
  const nodeModulesMcp = path.join(projectRoot, 'node_modules', '@quazardous', 'sailing', 'mcp', 'rudder-server.js');
  if (fs.existsSync(nodeModulesMcp)) {
    return nodeModulesMcp;
  }

  // Priority 3: Current sailing installation (fallback)
  return path.resolve(__dirname, '../../mcp/rudder-server.js');
}

/**
 * Generate MCP config for agent with restricted rudder access
 * @param {object} options - Options
 * @param {string} options.outputPath - Where to write the MCP config
 * @param {string} options.taskId - Task ID to restrict access to
 * @param {string} options.projectRoot - Project root path
 * @param {string} [options.mcpServerPath] - Override MCP server path (auto-detected if not provided)
 * @returns {{ configPath: string, mcpServerPath: string, taskId: string, projectRoot: string }}
 */
export function generateAgentMcpConfig(options) {
  const { outputPath, taskId, projectRoot, mcpServerPath: customMcpPath } = options;

  // Find MCP server path (project-specific or fallback)
  const mcpServerPath = customMcpPath || findMcpServerPath(projectRoot);

  const config = {
    mcpServers: {
      rudder: {
        command: 'node',
        args: [
          mcpServerPath,
          '--task-id', taskId,
          '--project-root', projectRoot
        ]
      }
    }
  };

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));

  // Return object with paths for debugging
  return {
    configPath: outputPath,
    mcpServerPath,
    taskId,
    projectRoot
  };
}

/**
 * Load base srt config from file or generate defaults
 * @param {string} [configPath] - Path to existing config
 * @returns {object} SRT configuration
 */
export function loadBaseSrtConfig(configPath) {
  if (configPath && fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      // Fall through to defaults
    }
  }

  const homeDir = os.homedir();
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
 * Generate agent-specific srt config with additional write paths
 * @param {object} options - Options
 * @param {string} options.baseConfigPath - Base config path (optional)
 * @param {string} options.outputPath - Where to write the generated config
 * @param {string[]} options.additionalWritePaths - Additional paths to allow writing
 * @param {boolean} [options.strictMode=false] - If true, ONLY allow /tmp + additionalWritePaths (ignore base config paths)
 * @returns {string} Path to generated config
 */
export function generateSrtConfig(options) {
  const { baseConfigPath, outputPath, additionalWritePaths = [], strictMode = false } = options;

  const config = loadBaseSrtConfig(baseConfigPath);

  if (strictMode) {
    // Strict mode: only essential paths + explicitly provided paths
    // This is for worktree agents that should be sandboxed to their worktree
    const homeDir = os.homedir();
    config.filesystem.allowWrite = [
      '/tmp',                         // Temp files
      `${homeDir}/.claude`,           // Claude session data (required)
      `${homeDir}/.claude.json`       // Claude config (required)
    ];
    for (const p of additionalWritePaths) {
      if (p) {
        config.filesystem.allowWrite.push(p);
      }
    }
  } else {
    // Normal mode: merge additional paths with base config
    const existingPaths = new Set(config.filesystem.allowWrite);
    for (const p of additionalWritePaths) {
      if (p && !existingPaths.has(p)) {
        config.filesystem.allowWrite.push(p);
      }
    }
  }

  // Ensure output directory exists
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));

  return outputPath;
}

/**
 * Spawn Claude with optional srt wrapper
 *
 * @param {object} options - Spawn options
 * @param {string} options.prompt - The prompt to send (via stdin)
 * @param {string} options.cwd - Working directory
 * @param {string} [options.logFile] - Log file for tee mode (optional)
 * @param {boolean} [options.sandbox=false] - Wrap with srt
 * @param {string} [options.srtConfigPath] - Path to srt config (required if sandbox=true)
 * @param {boolean} [options.riskyMode=false] - Add --dangerously-skip-permissions
 * @param {string[]} [options.extraArgs=[]] - Additional claude args
 * @param {boolean} [options.debug=false] - Enable SRT_DEBUG
 * @param {number} [options.timeout] - Timeout in seconds
 * @param {function} [options.onStdout] - Custom stdout handler (data => void)
 * @param {function} [options.onStderr] - Custom stderr handler (data => void)
 * @param {string} [options.mcpConfigPath] - Path to MCP config for agent (adds --mcp-config + --strict-mcp-config)
 * @returns {{ process: ChildProcess, pid: number, logFile?: string }}
 */
export function spawnClaudeWithSrt(options) {
  const {
    prompt,
    cwd,
    logFile,
    sandbox = false,
    srtConfigPath,
    riskyMode = false,
    extraArgs = [],
    debug = false,
    timeout,
    onStdout,
    onStderr,
    mcpConfigPath
  } = options;

  // Build claude args
  const claudeArgs = [];

  if (riskyMode) {
    claudeArgs.push('--dangerously-skip-permissions');
  }

  // Add MCP config for agent (restricted to specific MCP servers only)
  if (mcpConfigPath) {
    claudeArgs.push('--mcp-config', mcpConfigPath);
    claudeArgs.push('--strict-mcp-config');  // Only use specified MCP servers
  }

  // Add any extra args
  claudeArgs.push(...extraArgs);

  // -p without argument: read prompt from stdin
  claudeArgs.push('-p');

  // Build final command
  let command, finalArgs;

  if (sandbox) {
    command = 'srt';
    finalArgs = [];

    if (srtConfigPath) {
      finalArgs.push('--settings', srtConfigPath);
    }

    finalArgs.push('claude', ...claudeArgs);
  } else {
    command = 'claude';
    finalArgs = claudeArgs;
  }

  // Setup log stream if logFile provided
  let logStream = null;
  if (logFile) {
    ensureDir(path.dirname(logFile));
    logStream = fs.createWriteStream(logFile, { flags: 'a' });

    const startTime = new Date().toISOString();
    logStream.write(`\n=== Claude Started: ${startTime} ===\n`);
    logStream.write(`CWD: ${cwd}\n`);
    logStream.write(`Command: ${command} ${finalArgs.join(' ')} (prompt via stdin)\n`);
    logStream.write(`Sandbox: ${sandbox ? 'enabled' : 'disabled'}\n`);
    if (srtConfigPath) {
      logStream.write(`SRT Config: ${srtConfigPath}\n`);
    }
    if (mcpConfigPath) {
      logStream.write(`MCP Config: ${mcpConfigPath}\n`);
    }
    logStream.write('='.repeat(50) + '\n\n');
  }

  // Spawn process
  const child = spawn(command, finalArgs, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    env: {
      ...process.env,
      ...(debug && { SRT_DEBUG: '1' })
    }
  });

  // Write prompt to stdin and close
  child.stdin.write(prompt);
  child.stdin.end();

  // Handle stdout (tee mode: log + custom handler or console)
  child.stdout.on('data', (data) => {
    if (logStream) logStream.write(data);
    if (onStdout) {
      onStdout(data);
    } else {
      process.stdout.write(data);
    }
  });

  // Handle stderr (tee mode: log + custom handler or console)
  child.stderr.on('data', (data) => {
    if (logStream) logStream.write(data);
    if (onStderr) {
      onStderr(data);
    } else {
      process.stderr.write(data);
    }
  });

  // Handle timeout
  let timeoutId = null;
  if (timeout && timeout > 0) {
    timeoutId = setTimeout(() => {
      if (logStream) logStream.write(`\n=== TIMEOUT after ${timeout}s ===\n`);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeout * 1000);
  }

  // Handle exit
  child.on('exit', (code, signal) => {
    if (timeoutId) clearTimeout(timeoutId);
    if (logStream) {
      const endTime = new Date().toISOString();
      logStream.write(`\n=== Claude Exited: ${endTime} ===\n`);
      logStream.write(`Exit code: ${code}, Signal: ${signal}\n`, () => {
        logStream.end();
      });
    }
  });

  return {
    process: child,
    pid: child.pid,
    logFile
  };
}
