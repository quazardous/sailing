/**
 * Agent Run Management
 *
 * Tracks which tasks are currently being worked on by agents.
 * Provides claim/release API for task locking.
 *
 * TODO: Use proper lock library (e.g., proper-lockfile) for:
 *   - Stale lock detection (process died)
 *   - Race condition handling
 *   - Lock timeouts
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ensureDir } from './paths.js';
import { getAgentDir } from './agent-utils.js';

/**
 * Get path to run file for a task
 */
export function runFilePath(taskId: string): string {
  return path.join(getAgentDir(taskId), 'run.yaml');
}

/**
 * Check if a task is currently running (has run file)
 */
export function isRunning(taskId: string): boolean {
  return fs.existsSync(runFilePath(taskId));
}

/**
 * Create run file (mark task as being worked on)
 */
export function createRunFile(taskId: string, operation = 'task'): string {
  const filePath = runFilePath(taskId);
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
export function removeRunFile(taskId: string): boolean {
  const filePath = runFilePath(taskId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Read run file data
 */
export function readRunFile(taskId: string): { taskId: string; operation: string; started_at: string; pid: number } | null {
  const filePath = runFilePath(taskId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8')) as any;
  } catch {
    return null;
  }
}

/**
 * Claim a task for agent work
 * Returns { success, alreadyClaimed, error }
 */
export function claimTask(taskId: string, operation = 'task'): {
  success: boolean;
  alreadyClaimed?: boolean;
  error?: string
} {
  if (isRunning(taskId)) {
    return { success: true, alreadyClaimed: true };
  }

  try {
    createRunFile(taskId, operation);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

/**
 * Release a task (mark as finished)
 * Returns { success, notClaimed, error }
 */
export function releaseTask(taskId: string): {
  success: boolean;
  notClaimed?: boolean;
  error?: string
} {
  if (!isRunning(taskId)) {
    return { success: true, notClaimed: true };
  }

  try {
    removeRunFile(taskId);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
