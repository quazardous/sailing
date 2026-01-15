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
// Types
// ============================================================================

export interface RunFileData {
  taskId: string;
  operation: string;
  started_at: string;
  pid: number;
}

export interface ClaimResult {
  success: boolean;
  alreadyClaimed?: boolean;
  error?: string;
}

export interface ReleaseResult {
  success: boolean;
  notClaimed?: boolean;
  error?: string;
}

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
  private readonly agentUtils: AgentUtils;

  constructor(private readonly agentsBaseDir: string) {
    this.agentUtils = new AgentUtils(agentsBaseDir);
  }

  /**
   * Get path to run file for a task
   */
  runFilePath(taskId: string): string {
    return path.join(this.agentUtils.getAgentDir(taskId), 'run.yaml');
  }

  /**
   * Check if a task is currently running
   */
  isRunning(taskId: string): boolean {
    return fs.existsSync(this.runFilePath(taskId));
  }

  /**
   * Create run file (mark task as being worked on)
   */
  createRunFile(taskId: string, operation = 'task'): string {
    const filePath = this.runFilePath(taskId);
    ensureDir(path.dirname(filePath));
    const data: RunFileData = {
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
  removeRunFile(taskId: string): boolean {
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
  readRunFile(taskId: string): RunFileData | null {
    const filePath = this.runFilePath(taskId);
    if (!fs.existsSync(filePath)) return null;
    try {
      return yaml.load(fs.readFileSync(filePath, 'utf8')) as RunFileData;
    } catch {
      return null;
    }
  }

  /**
   * Claim a task for agent work
   */
  claim(taskId: string, operation = 'task'): ClaimResult {
    if (this.isRunning(taskId)) {
      return { success: true, alreadyClaimed: true };
    }

    try {
      this.createRunFile(taskId, operation);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Release a task (mark as finished)
   */
  release(taskId: string): ReleaseResult {
    if (!this.isRunning(taskId)) {
      return { success: true, notClaimed: true };
    }

    try {
      this.removeRunFile(taskId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}

