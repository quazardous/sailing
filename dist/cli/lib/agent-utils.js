/**
 * Agent utility functions
 * Shared helpers for agent command operations
 */
import fs from 'fs';
import path from 'path';
import { resolvePlaceholders, resolvePath } from './paths.js';
import { loadState } from './state.js';
import { normalizeId } from './normalize.js';
/**
 * Get agents base directory (overridable via paths.yaml: agents)
 * @returns {string}
 */
export function getAgentsBaseDir() {
    const custom = resolvePath('agents');
    return custom || resolvePlaceholders('${haven}/agents');
}
/**
 * Get agent directory for a task
 * @param {string} taskId - Task ID
 * @returns {string}
 */
export function getAgentDir(taskId) {
    return path.join(getAgentsBaseDir(), normalizeId(taskId));
}
/**
 * Get process stats from /proc (Linux only)
 * @param {number} pid - Process ID
 * @returns {{ running: boolean, cpu?: string, mem?: string, rss?: number }}
 */
export function getProcessStats(pid) {
    try {
        // Check if process exists
        process.kill(pid, 0);
        // Read memory info from /proc/[pid]/statm (pages)
        const statmPath = `/proc/${pid}/statm`;
        if (fs.existsSync(statmPath)) {
            const statm = fs.readFileSync(statmPath, 'utf8').trim().split(' ');
            const pageSize = 4096; // 4KB pages on most Linux systems
            const rssPages = parseInt(statm[1], 10);
            const rssBytes = rssPages * pageSize;
            const rssMB = (rssBytes / (1024 * 1024)).toFixed(1);
            return { running: true, mem: `${rssMB}MB`, rss: rssBytes };
        }
        return { running: true };
    }
    catch {
        return { running: false };
    }
}
/**
 * Format duration as human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "2m15s", "1h03m")
 */
export function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hours > 0) {
        return `${hours}h${mins.toString().padStart(2, '0')}m`;
    }
    else if (mins > 0) {
        return `${mins}m${secs.toString().padStart(2, '0')}s`;
    }
    else {
        return `${secs}s`;
    }
}
/**
 * Check agent completion state
 * @param {string} taskId - Task ID
 * @returns {{ complete: boolean, hasResult: boolean, hasSentinel: boolean, hasStateComplete: boolean, agentDir: string }}
 */
export function checkAgentCompletion(taskId) {
    const agentDir = getAgentDir(taskId);
    const resultFile = path.join(agentDir, 'result.yaml');
    const sentinelFile = path.join(agentDir, 'done');
    // Also check state.json for completed status with exit_code=0
    const state = loadState();
    const agentInfo = state.agents?.[taskId];
    const stateComplete = agentInfo?.status === 'completed' && agentInfo?.exit_code === 0;
    return {
        complete: fs.existsSync(sentinelFile) || fs.existsSync(resultFile) || stateComplete,
        hasResult: fs.existsSync(resultFile),
        hasSentinel: fs.existsSync(sentinelFile),
        hasStateComplete: stateComplete,
        agentDir
    };
}
/**
 * Require agent exists, with escalation helper
 * @param {string} taskId - Task ID
 * @param {AgentUtilsOptions} options - Options
 * @param {boolean} options.json - JSON output mode
 * @param {function} options.escalate - Escalation function (reason, nextSteps)
 * @returns {{ taskId: string, agent: object, state: object } | null}
 */
export function getAgentOrEscalate(taskId, options = {}) {
    const normalized = normalizeId(taskId);
    const state = loadState();
    const agent = state.agents?.[normalized];
    if (!agent) {
        if (options.escalate) {
            options.escalate(`No agent found for task ${normalized}`, [
                `Check task ID: rudder task:show ${normalized}`,
                `List agents: rudder agent:list`,
                `Spawn agent: rudder agent:spawn ${normalized}`
            ]);
        }
        else if (options.json) {
            console.log(JSON.stringify({ error: `No agent found for task: ${normalized}` }));
            process.exit(1);
        }
        else {
            console.error(`No agent found for task: ${normalized}`);
            process.exit(1);
        }
        return null;
    }
    return { taskId: normalized, agent, state };
}
/**
 * Log file path for a task
 * @param {string} taskId - Task ID
 * @returns {string}
 */
export function getLogFilePath(taskId) {
    return path.join(getAgentDir(taskId), 'run.log');
}
/**
 * Check if agent directory exists
 * @param {string} taskId - Task ID
 * @returns {boolean}
 */
export function agentDirExists(taskId) {
    return fs.existsSync(getAgentDir(taskId));
}
