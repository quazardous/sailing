/**
 * Agent Lifecycle Manager
 *
 * High-level orchestration of agent operations.
 * Composes low-level libs (worktree, git, state) into business operations.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { loadFile, saveFile, findProjectRoot, getAgentsDir } from './core-manager.js';
import { loadState, saveState } from './state-manager.js';
import { getGit } from '../lib/git.js';
import { getAgentConfig } from './core-manager.js';
import { removeWorktree } from './worktree-manager.js';
import { getTask } from './artefacts-manager.js';
import { normalizeId } from '../lib/normalize.js';
import { parseUpdateOptions } from '../lib/update.js';
import { AgentUtils } from '../lib/agent-utils.js';
// ============================================================================
// AgentLifecycleManager Class
// ============================================================================
/**
 * Manages the lifecycle of a single agent.
 * Encapsulates taskId context to avoid repeated parameter passing.
 */
export class AgentLifecycleManager {
    taskId;
    agentUtils;
    projectRoot;
    constructor(taskId) {
        this.taskId = normalizeId(taskId);
        this.agentUtils = new AgentUtils(getAgentsDir());
        this.projectRoot = findProjectRoot();
    }
    /** Get fresh state (not cached - state can change) */
    getState() {
        return loadState();
    }
    /** Get fresh agent info */
    getAgentInfo() {
        return this.getState().agents?.[this.taskId];
    }
    /** Get agent directory */
    getAgentDir() {
        return this.agentUtils.getAgentDir(this.taskId);
    }
    // --------------------------------------------------------------------------
    // Wait / Monitor
    // --------------------------------------------------------------------------
    /** Check if agent process is still running */
    isRunning() {
        const agentInfo = this.getAgentInfo();
        if (!agentInfo?.pid)
            return false;
        try {
            process.kill(agentInfo.pid, 0);
            return true;
        }
        catch {
            return false;
        }
    }
    /** Wait for agent to complete */
    async wait(timeoutSec) {
        const timeoutMs = timeoutSec * 1000;
        const startTime = Date.now();
        while (true) {
            const agentInfo = this.getAgentInfo();
            const completion = this.agentUtils.checkCompletion(this.taskId, agentInfo);
            if (completion.complete) {
                return { success: true, taskId: this.taskId };
            }
            if (Date.now() - startTime > timeoutMs) {
                return { success: false, taskId: this.taskId, timedOut: true };
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    // --------------------------------------------------------------------------
    // Git / Merge
    // --------------------------------------------------------------------------
    /** Check for merge conflicts before merging */
    async checkMergeConflicts() {
        const agentInfo = this.getAgentInfo();
        if (!agentInfo?.worktree) {
            return { hasConflicts: false, files: [] };
        }
        const branch = agentInfo.worktree.branch;
        const mainGit = getGit(this.projectRoot);
        try {
            const mergeBase = await mainGit.raw(['merge-base', 'HEAD', branch]);
            const mergeTree = await mainGit.raw(['merge-tree', mergeBase.trim(), 'HEAD', branch]);
            if (mergeTree.includes('<<<<<<<') || mergeTree.includes('>>>>>>>')) {
                const conflictFiles = [];
                for (const line of mergeTree.split('\n')) {
                    if (line.startsWith('changed in both')) {
                        const match = line.match(/changed in both\s+(.+)/);
                        if (match)
                            conflictFiles.push(match[1]);
                    }
                }
                return { hasConflicts: true, files: conflictFiles };
            }
        }
        catch {
            // Can't check - assume no conflicts
        }
        return { hasConflicts: false, files: [] };
    }
    /** Auto-commit uncommitted changes in worktree */
    async autoCommitChanges() {
        const agentInfo = this.getAgentInfo();
        if (!agentInfo?.worktree?.path) {
            return { committed: false, files: 0 };
        }
        const worktreePath = agentInfo.worktree.path;
        if (!fs.existsSync(worktreePath)) {
            return { committed: false, files: 0 };
        }
        const reapGit = getGit(worktreePath);
        const reapStatus = await reapGit.status();
        if (reapStatus.isClean()) {
            return { committed: false, files: 0 };
        }
        const allFiles = [
            ...reapStatus.modified,
            ...reapStatus.created,
            ...reapStatus.deleted,
            ...reapStatus.not_added
        ];
        try {
            await reapGit.add('-A');
            await reapGit.commit(`chore(${this.taskId}): auto-commit agent changes`);
            return { committed: true, files: allFiles.length };
        }
        catch {
            return { committed: false, files: 0 };
        }
    }
    /** Merge agent work into main branch */
    async mergeWork(strategy = 'merge') {
        const agentInfo = this.getAgentInfo();
        if (!agentInfo?.worktree) {
            return { success: false, strategy, error: 'No worktree for agent' };
        }
        const branch = agentInfo.worktree.branch;
        const mainGit = getGit(this.projectRoot);
        // Check conflicts first
        const conflicts = await this.checkMergeConflicts();
        if (conflicts.hasConflicts) {
            return { success: false, strategy, conflicts: conflicts.files, error: 'Merge conflicts detected' };
        }
        try {
            if (strategy === 'squash') {
                await mainGit.merge([branch, '--squash']);
                await mainGit.commit(`feat(${this.taskId}): ${branch}`);
            }
            else if (strategy === 'rebase') {
                await mainGit.rebase([branch]);
            }
            else {
                await mainGit.merge([branch, '--no-edit']);
            }
            return { success: true, strategy };
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return { success: false, strategy, error: message };
        }
    }
    // --------------------------------------------------------------------------
    // Core Lifecycle
    // --------------------------------------------------------------------------
    /**
     * Reap agent: wait for completion, merge work, update status
     *
     * This is the main orchestration function that:
     * 1. Waits for agent completion (optional)
     * 2. Auto-commits uncommitted changes
     * 3. Checks for merge conflicts
     * 4. Merges worktree to main
     * 5. Updates task status (Done/Blocked)
     * 6. Updates agent state (reaped)
     */
    async reap(options = {}) {
        const { wait = true, timeout = 300, cleanupWorktree = false } = options;
        const state = this.getState();
        const agentInfo = state.agents?.[this.taskId];
        const config = getAgentConfig();
        // Validation
        if (!agentInfo) {
            return {
                success: false,
                taskId: this.taskId,
                resultStatus: 'blocked',
                taskStatus: 'Blocked',
                merged: false,
                cleanedUp: false,
                escalate: {
                    reason: `No agent found for task ${this.taskId}`,
                    nextSteps: [`agent:spawn ${this.taskId}    # Start agent first`]
                }
            };
        }
        // Wait for completion if running
        if (this.isRunning()) {
            if (!wait) {
                return {
                    success: false,
                    taskId: this.taskId,
                    resultStatus: 'blocked',
                    taskStatus: 'Blocked',
                    merged: false,
                    cleanedUp: false,
                    escalate: {
                        reason: `Agent ${this.taskId} is still running (PID ${agentInfo.pid})`,
                        nextSteps: [
                            `agent:wait ${this.taskId}     # Wait for completion`,
                            `agent:kill ${this.taskId}     # Force terminate`
                        ]
                    }
                };
            }
            const waitResult = await this.wait(timeout);
            if (!waitResult.success) {
                return {
                    success: false,
                    taskId: this.taskId,
                    resultStatus: 'blocked',
                    taskStatus: 'Blocked',
                    merged: false,
                    cleanedUp: false,
                    escalate: {
                        reason: `Timeout waiting for agent ${this.taskId}`,
                        nextSteps: [
                            `agent:wait ${this.taskId} --timeout 3600    # Wait longer`,
                            `agent:kill ${this.taskId}                   # Force terminate`
                        ]
                    }
                };
            }
        }
        // Check completion
        const completion = this.agentUtils.checkCompletion(this.taskId, agentInfo);
        if (!completion.complete) {
            return {
                success: false,
                taskId: this.taskId,
                resultStatus: 'blocked',
                taskStatus: 'Blocked',
                merged: false,
                cleanedUp: false,
                escalate: {
                    reason: `Agent ${this.taskId} did not complete`,
                    nextSteps: [
                        `agent:status ${this.taskId}    # Check status`,
                        `agent:reject ${this.taskId}    # Discard incomplete work`
                    ]
                }
            };
        }
        // Read result status
        let resultStatus = 'completed';
        const agentDir = this.getAgentDir();
        const resultFile = path.join(agentDir, 'result.yaml');
        if (fs.existsSync(resultFile)) {
            try {
                const result = yaml.load(fs.readFileSync(resultFile, 'utf8'));
                resultStatus = result.status || 'completed';
            }
            catch { /* ignore */ }
        }
        let merged = false;
        let cleanedUp = false;
        // Handle worktree merge
        if (agentInfo.worktree) {
            const worktreePath = agentInfo.worktree.path;
            if (!fs.existsSync(worktreePath)) {
                return {
                    success: false,
                    taskId: this.taskId,
                    resultStatus,
                    taskStatus: 'Blocked',
                    merged: false,
                    cleanedUp: false,
                    escalate: {
                        reason: `Worktree not found: ${worktreePath}`,
                        nextSteps: [`agent:clear ${this.taskId}    # Clear stale state`]
                    }
                };
            }
            // Auto-commit uncommitted changes
            await this.autoCommitChanges();
            // Check for conflicts
            const conflicts = await this.checkMergeConflicts();
            if (conflicts.hasConflicts) {
                return {
                    success: false,
                    taskId: this.taskId,
                    resultStatus,
                    taskStatus: 'Blocked',
                    merged: false,
                    cleanedUp: false,
                    escalate: {
                        reason: 'Merge conflicts detected',
                        nextSteps: [
                            `/dev:merge ${this.taskId}                           # Guided conflict resolution`,
                            ``,
                            `Manual resolution:`,
                            `  git checkout -b merge/${this.taskId}-to-main main`,
                            `  git merge ${agentInfo.worktree.branch} --no-commit`,
                            `  # ... resolve conflicts ...`,
                            `  git commit -m "merge(${this.taskId}): resolved conflicts"`,
                            `  git checkout main && git merge merge/${this.taskId}-to-main --ff-only`,
                            `  agent:clear ${this.taskId}`,
                            ...(conflicts.files.length > 0 ? [``, `Conflicting files:`, ...conflicts.files.map(f => `  ${f}`)] : [])
                        ]
                    }
                };
            }
            // Merge
            const strategy = config.merge_strategy || 'merge';
            const mergeResult = await this.mergeWork(strategy);
            if (!mergeResult.success) {
                return {
                    success: false,
                    taskId: this.taskId,
                    resultStatus,
                    taskStatus: 'Blocked',
                    merged: false,
                    cleanedUp: false,
                    escalate: {
                        reason: `Merge failed: ${mergeResult.error}`,
                        nextSteps: [`/dev:merge ${this.taskId}    # Manual resolution`]
                    }
                };
            }
            merged = true;
            // Cleanup worktree if requested
            if (cleanupWorktree) {
                const removeResult = removeWorktree(this.taskId, { force: true });
                cleanedUp = removeResult.success;
            }
        }
        // Update task status
        const taskStatus = resultStatus === 'completed' ? 'Done' : 'Blocked';
        const taskFile = getTask(this.taskId)?.file;
        if (taskFile) {
            const file = loadFile(taskFile);
            const { updated, data } = parseUpdateOptions({ status: taskStatus }, file.data, 'task');
            if (updated) {
                saveFile(taskFile, data, file.body);
            }
        }
        // Update agent state
        const freshState = this.getState();
        freshState.agents[this.taskId] = {
            ...agentInfo,
            status: 'reaped',
            result_status: resultStatus,
            reaped_at: new Date().toISOString()
        };
        saveState(freshState);
        return {
            success: true,
            taskId: this.taskId,
            resultStatus,
            taskStatus,
            merged,
            cleanedUp
        };
    }
    /** Kill agent process */
    async kill() {
        const state = this.getState();
        const agentInfo = state.agents?.[this.taskId];
        if (!agentInfo) {
            return { success: false, taskId: this.taskId, error: `No agent found for task ${this.taskId}` };
        }
        if (!agentInfo.pid) {
            return { success: false, taskId: this.taskId, error: `Agent ${this.taskId} has no running process` };
        }
        const pid = agentInfo.pid;
        try {
            process.kill(pid, 'SIGTERM');
            // Wait and force kill if needed
            await new Promise(r => setTimeout(r, 5000));
            try {
                process.kill(pid, 0);
                process.kill(pid, 'SIGKILL');
            }
            catch {
                // Already terminated
            }
        }
        catch (e) {
            const error = e;
            if (error.code !== 'ESRCH') {
                const message = error.message || String(e);
                return { success: false, taskId: this.taskId, pid, error: message };
            }
            // ESRCH = process already gone, that's fine
        }
        // Update state
        const freshState = this.getState();
        freshState.agents[this.taskId] = {
            ...agentInfo,
            status: 'killed',
            killed_at: new Date().toISOString()
        };
        delete freshState.agents[this.taskId].pid;
        saveState(freshState);
        return { success: true, taskId: this.taskId, pid };
    }
    /** Reject agent work and cleanup */
    reject(reason) {
        const state = this.getState();
        const agentInfo = state.agents?.[this.taskId];
        if (!agentInfo) {
            return { success: false, taskId: this.taskId };
        }
        // Remove worktree if exists
        if (agentInfo.worktree) {
            removeWorktree(this.taskId, { force: true });
        }
        // Update state
        const freshState = this.getState();
        freshState.agents[this.taskId] = {
            ...agentInfo,
            status: 'rejected',
            reject_reason: reason,
            rejected_at: new Date().toISOString()
        };
        saveState(freshState);
        return { success: true, taskId: this.taskId };
    }
    /** Clear agent from state */
    clear() {
        const state = this.getState();
        if (!state.agents?.[this.taskId]) {
            return false;
        }
        delete state.agents[this.taskId];
        saveState(state);
        return true;
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create an AgentLifecycleManager for a task
 */
export function getAgentLifecycle(taskId) {
    return new AgentLifecycleManager(taskId);
}
