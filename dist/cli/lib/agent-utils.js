/**
 * Agent utility functions
 * Shared helpers for agent command operations
 *
 * PURE LIB: No config access, no manager imports.
 * Uses POO encapsulation: AgentUtils class holds agentsBaseDir.
 */
import fs from 'fs';
import path from 'path';
import { normalizeId } from './normalize.js';
// ============================================================================
// AgentUtils Class (POO Encapsulation)
// ============================================================================
/**
 * Agent utilities with encapsulated base directory.
 * Instantiate in manager, pass to commands/libs as needed.
 *
 * @example
 * // In manager:
 * const agentUtils = new AgentUtils(getAgentsDir());
 * const dir = agentUtils.getAgentDir('T042');
 */
export class AgentUtils {
    agentsBaseDir;
    constructor(agentsBaseDir) {
        this.agentsBaseDir = agentsBaseDir;
    }
    /**
     * Get agent directory for a task
     */
    getAgentDir(taskId) {
        return path.join(this.agentsBaseDir, normalizeId(taskId));
    }
    /**
     * Check agent completion state
     */
    checkCompletion(taskId, agentInfo) {
        const agentDir = this.getAgentDir(taskId);
        const resultFile = path.join(agentDir, 'result.yaml');
        const sentinelFile = path.join(agentDir, 'done');
        const stateComplete = agentInfo?.status === 'completed';
        return {
            complete: fs.existsSync(sentinelFile) || fs.existsSync(resultFile) || stateComplete,
            hasResult: fs.existsSync(resultFile),
            hasSentinel: fs.existsSync(sentinelFile),
            hasStateComplete: stateComplete,
            agentDir
        };
    }
    /**
     * Log file path for a task
     */
    getLogFilePath(taskId) {
        return path.join(this.getAgentDir(taskId), 'run.log');
    }
    /**
     * Check if agent directory exists
     */
    dirExists(taskId) {
        return fs.existsSync(this.getAgentDir(taskId));
    }
    /**
     * Get the base agents directory
     */
    getBaseDir() {
        return this.agentsBaseDir;
    }
}
// ============================================================================
// Standalone Functions (functions without shared context - NOT wrappers)
// ============================================================================
/**
 * Require agent exists, with escalation helper
 * (No shared context with agentsBaseDir, stays standalone)
 */
export function getAgentOrEscalate(taskId, agents, options = {}) {
    const normalized = normalizeId(taskId);
    const agent = agents[normalized];
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
    return { taskId: normalized, agent };
}
// ============================================================================
// Pure Utility Functions (no shared context)
// ============================================================================
/**
 * Get process stats from /proc (Linux only)
 */
export function getProcessStats(pid) {
    try {
        process.kill(pid, 0);
        const statmPath = `/proc/${pid}/statm`;
        if (fs.existsSync(statmPath)) {
            const statm = fs.readFileSync(statmPath, 'utf8').trim().split(' ');
            const pageSize = 4096;
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
