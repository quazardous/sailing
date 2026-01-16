/**
 * Agent Context Detection
 *
 * Detects whether CLI is running in main mode or agent mode
 * Agent mode: running in a git worktree with a mission.yaml present
 *
 * PURE LIB: No config access, no manager imports.
 * Uses POO encapsulation: AgentContext class holds projectRoot and cwd.
 */
import fs from 'fs';
import path from 'path';
import { execaSync } from 'execa';
// ============================================================================
// Pure Utility Functions (no shared context)
// ============================================================================
/**
 * Check if current directory is a git worktree
 * Pure utility - no config needed
 */
export function checkGitWorktree() {
    try {
        const commonDirResult = execaSync('git', ['rev-parse', '--git-common-dir'], { reject: false });
        if (commonDirResult.exitCode !== 0)
            return { isWorktree: false };
        const commonDir = String(commonDirResult.stdout).trim();
        const gitDirResult = execaSync('git', ['rev-parse', '--git-dir'], { reject: false });
        if (gitDirResult.exitCode !== 0)
            return { isWorktree: false };
        const gitDir = String(gitDirResult.stdout).trim();
        // If git-common-dir != git-dir, we're in a worktree
        const isWorktree = commonDir !== gitDir && commonDir !== '.git';
        if (isWorktree) {
            // Main repo is parent of git-common-dir
            const mainPath = path.dirname(commonDir);
            return { isWorktree: true, mainPath };
        }
        return { isWorktree: false };
    }
    catch {
        return { isWorktree: false };
    }
}
// ============================================================================
// AgentContext Class (POO Encapsulation)
// ============================================================================
/**
 * Agent context detection with encapsulated projectRoot and cwd.
 * Instantiate in manager, use for mode detection.
 *
 * @example
 * // In manager:
 * const ctx = new AgentContext(findProjectRoot(), process.cwd());
 * const mode = ctx.detectMode();
 */
export class AgentContext {
    projectRoot;
    cwd;
    constructor(projectRoot, cwd) {
        this.projectRoot = projectRoot;
        this.cwd = cwd;
    }
    /**
     * Find mission file for current context
     * Checks: haven agents folder, current directory, worktree parent
     */
    findMissionFile() {
        const cwdParts = this.cwd.split(path.sep);
        // Look for agents/<TNNN> pattern in path
        for (let i = 0; i < cwdParts.length - 1; i++) {
            if (cwdParts[i] === 'agents' && /^T\d+$/.test(cwdParts[i + 1])) {
                const agentDir = cwdParts.slice(0, i + 2).join(path.sep);
                const missionPath = path.join(agentDir, 'mission.yaml');
                if (fs.existsSync(missionPath)) {
                    return {
                        taskId: cwdParts[i + 1],
                        missionPath,
                        agentDir
                    };
                }
            }
        }
        // Check if we're in a worktree and the parent has mission.yaml
        const worktreeInfo = checkGitWorktree();
        if (worktreeInfo.isWorktree) {
            // Worktree might be at ${haven}/agents/TNNN/worktree
            // Mission would be at ${haven}/agents/TNNN/mission.yaml
            const worktreeParent = path.dirname(this.projectRoot);
            const missionPath = path.join(worktreeParent, 'mission.yaml');
            if (fs.existsSync(missionPath)) {
                const taskId = path.basename(worktreeParent);
                if (/^T\d+$/.test(taskId)) {
                    return {
                        taskId,
                        missionPath,
                        agentDir: worktreeParent
                    };
                }
            }
        }
        return null;
    }
    /**
     * Detect execution mode
     */
    detectMode() {
        const missionInfo = this.findMissionFile();
        if (missionInfo) {
            return {
                mode: 'agent',
                taskId: missionInfo.taskId,
                missionPath: missionInfo.missionPath,
                agentDir: missionInfo.agentDir,
                projectRoot: this.projectRoot
            };
        }
        return {
            mode: 'main',
            projectRoot: this.projectRoot
        };
    }
    /**
     * Check if running in agent mode
     */
    isAgentMode() {
        return this.detectMode().mode === 'agent';
    }
    /**
     * Get agent info if in agent mode
     */
    getAgentInfo() {
        const mode = this.detectMode();
        if (mode.mode === 'agent') {
            return {
                taskId: mode.taskId,
                missionPath: mode.missionPath,
                agentDir: mode.agentDir
            };
        }
        return null;
    }
}
