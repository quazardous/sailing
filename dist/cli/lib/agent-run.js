/**
 * Agent Run Management
 *
 * Tracks which tasks are currently being worked on by agents.
 * Provides claim/release API for task locking.
 *
 * PURE LIB: No config access, no manager imports.
 * Uses POO encapsulation: AgentRunManager class holds agentsBaseDir.
 *
 * TODO: Use proper lock library (e.g., proper-lockfile) for:
 *   - Stale lock detection (process died)
 *   - Race condition handling
 *   - Lock timeouts
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { AgentUtils } from './agent-utils.js';
import { ensureDir } from './fs-utils.js';
// ============================================================================
// AgentRunManager Class (POO Encapsulation)
// ============================================================================
/**
 * Agent run management with encapsulated base directory.
 * Instantiate in manager, use for claim/release operations.
 *
 * @example
 * // In manager:
 * const runManager = new AgentRunManager(getAgentsDir());
 * runManager.claim('T042', 'task');
 */
export class AgentRunManager {
    agentsBaseDir;
    agentUtils;
    constructor(agentsBaseDir) {
        this.agentsBaseDir = agentsBaseDir;
        this.agentUtils = new AgentUtils(agentsBaseDir);
    }
    /**
     * Get path to run file for a task
     */
    runFilePath(taskId) {
        return path.join(this.agentUtils.getAgentDir(taskId), 'run.yaml');
    }
    /**
     * Check if a task is currently running
     */
    isRunning(taskId) {
        return fs.existsSync(this.runFilePath(taskId));
    }
    /**
     * Create run file (mark task as being worked on)
     */
    createRunFile(taskId, operation = 'task') {
        const filePath = this.runFilePath(taskId);
        ensureDir(path.dirname(filePath));
        const data = {
            taskId,
            operation,
            started_at: new Date().toISOString(),
            pid: process.pid
        };
        fs.writeFileSync(filePath, yaml.dump(data));
        return filePath;
    }
    /**
     * Remove run file (task finished)
     */
    removeRunFile(taskId) {
        const filePath = this.runFilePath(taskId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    }
    /**
     * Read run file data
     */
    readRunFile(taskId) {
        const filePath = this.runFilePath(taskId);
        if (!fs.existsSync(filePath))
            return null;
        try {
            return yaml.load(fs.readFileSync(filePath, 'utf8'));
        }
        catch {
            return null;
        }
    }
    /**
     * Claim a task for agent work
     */
    claim(taskId, operation = 'task') {
        if (this.isRunning(taskId)) {
            return { success: true, alreadyClaimed: true };
        }
        try {
            this.createRunFile(taskId, operation);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
    }
    /**
     * Release a task (mark as finished)
     */
    release(taskId) {
        if (!this.isRunning(taskId)) {
            return { success: true, notClaimed: true };
        }
        try {
            this.removeRunFile(taskId);
            return { success: true };
        }
        catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
    }
}
