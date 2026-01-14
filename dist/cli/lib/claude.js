/**
 * Claude Subprocess Management
 *
 * Spawns Claude Code as subprocess with appropriate flags based on config.
 * Uses srt.js for actual spawning.
 */
import path from 'path';
import fs from 'fs';
import { getAgentConfig } from './config.js';
import { getAgentsDir, getPathsInfo } from './core.js';
import { spawnClaudeWithSrt, generateSrtConfig, generateAgentMcpConfig, checkMcpServer, startSocatBridge } from './srt.js';
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
 * @param {string} options.taskId - Task ID (to identify current worktree)
 * @param {boolean} [options.externalMcp=false] - If true, only allow worktree writes (MCP handles haven)
 * @param {string} [options.mcpSocket] - MCP Unix socket path to bind-mount into sandbox
 * @returns {string} Path to generated srt config
 */
export function generateAgentSrtConfig(options) {
    const { agentDir, cwd, logFile, taskId, externalMcp = false, mcpSocket } = options;
    const paths = getPathsInfo();
    // Base write paths: worktree + log directory
    const additionalWritePaths = [
        cwd, // Worktree directory
        path.dirname(logFile) // Log directory
    ];
    // Add MCP socket to allow socat to connect from inside sandbox
    if (mcpSocket) {
        additionalWritePaths.push(mcpSocket);
    }
    // If NOT using external MCP, agent needs haven write access for rudder commands
    // (this is the fallback mode when MCP runs inside sandbox)
    if (!externalMcp) {
        const agentsBaseDir = path.dirname(agentDir); // .../agents
        const havenDir = path.dirname(agentsBaseDir); // .../havens/<hash>
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
        baseConfigPath: paths.srtConfig?.absolute,
        outputPath: path.join(agentDir, 'srt-settings.json'),
        additionalWritePaths,
        additionalDenyReadPaths,
        allowUnixSockets: mcpSocket ? [mcpSocket] : [],
        allowAllUnixSockets: isLinux, // Required for socket mode on Linux
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
 * @param {boolean} [options.quietMode] - Suppress all console output (stdout+stderr to file only)
 * @returns {Promise<SpawnClaudeResult>}
 */
export async function spawnClaude(options) {
    const { prompt, cwd, logFile, timeout, agentDir, taskId, projectRoot, stderrToFile, quietMode } = options;
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
    let mcpPort = null;
    let mcpServerPath = null;
    // Socat bridge for port mode on Linux (works around --unshare-net)
    let bridgePid = null;
    let bridgeSocket = null;
    let bridgeCleanup = null;
    const isLinux = process.platform === 'linux';
    if (useExternalMcp) {
        const havenDir = getHavenDir(agentDir);
        const mcpStatus = checkMcpServer(havenDir);
        if (!mcpStatus.running) {
            throw new Error('MCP server not running. Start it first:\n\n' +
                '  bin/rudder-mcp start\n\n' +
                'Then retry spawn. Check status with "bin/rudder-mcp status".\n' +
                'Transport mode (socket/port) is set in .sailing/config.yaml (agent.mcp_mode).');
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
                    externalSocket: bridgeSocket // Use bridge socket
                });
                console.error(`Using MCP server (pid: ${mcpPid}, port: ${mcpStatus.port} via bridge socket)`);
            }
            else {
                // Non-Linux or no sandbox: direct TCP connection
                mcpInfo = generateAgentMcpConfig({
                    outputPath: path.join(agentDir, 'mcp-config.json'),
                    projectRoot,
                    externalPort: mcpStatus.port
                });
                mcpPort = mcpStatus.port ?? null;
                console.error(`Using MCP server (pid: ${mcpPid}, port: ${mcpStatus.port})`);
            }
        }
        else {
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
            taskId // Task restriction only for internal mode
        });
    }
    // Generate srt config if sandbox enabled
    // On Linux, sandbox + MCP requires:
    // - allowAllUnixSockets: true (disables seccomp AF_UNIX blocking)
    // - For port mode: socat bridge (started above) to work around --unshare-net
    let srtConfigPath = null;
    if (sandbox) {
        if (agentDir) {
            srtConfigPath = generateAgentSrtConfig({
                agentDir,
                cwd,
                logFile,
                taskId,
                externalMcp: !!mcpSocket, // Strict sandbox if external MCP is active
                mcpSocket // Pass socket for macOS allowUnixSockets
            });
        }
        else if (paths.srtConfig?.absolute) {
            srtConfigPath = paths.srtConfig.absolute;
        }
    }
    // Setup output handlers for quiet mode
    let onStdout = null;
    let onStderr = null;
    if (quietMode) {
        // Quiet mode: suppress all console output (log file still gets it)
        onStdout = () => { };
        onStderr = () => { };
    }
    else if (stderrToFile) {
        // Just stderr to file only
        onStderr = () => { };
    }
    // Sandbox HOME isolation: use agentDir/home to isolate Claude's config
    // Required to prevent race conditions when spawning multiple agents in parallel
    const sandboxHome = sandbox && agentDir ? path.join(agentDir, 'home') : null;
    // Get budget and watchdog from config
    const maxBudgetUsd = config.max_budget_usd;
    const watchdogTimeout = config.watchdog_timeout;
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
 * @param {string} taskId - Task ID
 * @returns {string} Absolute path to log file
 */
export function getLogFilePath(taskId) {
    return path.join(getAgentsBaseDir(), taskId, 'run.log');
}
