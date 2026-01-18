/**
 * Database Manager
 * Provides config-aware factory for DbOps and agent CRUD helpers.
 *
 * MANAGER: Creates configured lib instances, provides high-level agent operations.
 * Commands and other managers should use these helpers instead of state.agents.
 *
 * Primary key: taskNum (number) - the numeric part of task ID (5 for T005)
 * All public APIs accept both taskId (string) and taskNum (number) for convenience.
 */
import { resolvePlaceholders, resolvePath, getAgentConfig } from './core-manager.js';
import { DbOps } from '../lib/db.js';
import type { AgentRecord } from '../lib/types/agent.js';
import {
  parseTaskNum,
  formatTaskId,
  getAgentDirPath,
  getMissionFilePath,
  getLogFilePath,
  getSrtConfigPath,
  getMcpConfigPath
} from '../lib/normalize.js';

// Re-export types and class for direct usage
export { DbOps };
export type { DbOptions } from '../lib/db.js';
export { AgentRecord };

// ============================================================================
// DbOps Factory (lazy-initialized)
// ============================================================================

let _ops: DbOps | null = null;

/**
 * Get database directory from config
 */
function getDbDir(): string {
  const custom = resolvePath('db');
  return custom || resolvePlaceholders('${haven}/db');
}

/**
 * Get configured DbOps instance (lazy-initialized)
 * For direct db access. Prefer using the helper functions below.
 */
export function getDbOps(): DbOps {
  if (!_ops) {
    _ops = new DbOps(getDbDir());
  }
  return _ops;
}

/**
 * Reset ops instance (for testing or when config changes)
 */
export function resetDbOps(): void {
  _ops = null;
}

// ============================================================================
// TaskNum Resolution
// ============================================================================

/**
 * Resolve taskId (string) or taskNum (number) to taskNum
 * @param taskIdOrNum - "T005" or 5
 * @returns taskNum or null if invalid
 */
export function resolveTaskNum(taskIdOrNum: string | number): number | null {
  if (typeof taskIdOrNum === 'number') return taskIdOrNum;
  return parseTaskNum(taskIdOrNum);
}

/**
 * Get configured digit count for task IDs
 */
function getTaskDigits(): number {
  // Config has ids.task_digits, agent section doesn't have it
  // Default to 3 digits
  return 3;
}

/**
 * Get haven directory path
 */
function getHaven(): string {
  return resolvePlaceholders('${haven}');
}

// ============================================================================
// Agent CRUD Helpers
// ============================================================================

/**
 * Get agent by taskId or taskNum
 * @returns AgentRecord or null if not found
 */
export function getAgentFromDb(taskIdOrNum: string | number): AgentRecord | null {
  const taskNum = resolveTaskNum(taskIdOrNum);
  if (taskNum === null) return null;

  const doc = getDbOps().getAgent(taskNum);
  if (!doc) return null;

  // Convert db doc to AgentRecord (remove internal fields)
  const { _id, _createdAt, _updatedAt, migratedAt, ...record } = doc;
  return record as AgentRecord;
}

/**
 * Check if agent exists in db
 */
export function agentExistsInDb(taskIdOrNum: string | number): boolean {
  const taskNum = resolveTaskNum(taskIdOrNum);
  if (taskNum === null) return false;
  return getDbOps().getAgent(taskNum) !== null;
}

/**
 * Get all agents, optionally filtered by status
 * @returns Record<taskId, AgentRecord> for compatibility (taskId string keys)
 */
export function getAllAgentsFromDb(options: { status?: string } = {}): Record<string, AgentRecord> {
  const docs = getDbOps().getAllAgents(options);
  const digits = getTaskDigits();
  const result: Record<string, AgentRecord> = {};

  for (const doc of docs) {
    const { _id, _createdAt, _updatedAt, migratedAt, ...record } = doc;
    const taskId = formatTaskId(record.taskNum, digits);
    result[taskId] = record as AgentRecord;
  }
  return result;
}

/**
 * Get all agents as array (for iteration)
 * Includes computed taskId for convenience
 */
export function getAgentsArray(options: { status?: string } = {}): Array<AgentRecord & { taskId: string }> {
  const docs = getDbOps().getAllAgents(options);
  const digits = getTaskDigits();

  return docs.map(doc => {
    const { _id, _createdAt, _updatedAt, migratedAt, ...record } = doc;
    return {
      ...record,
      taskId: formatTaskId(record.taskNum, digits)
    } as AgentRecord & { taskId: string };
  });
}

/**
 * Save/create agent (full replace)
 */
export async function saveAgentToDb(taskIdOrNum: string | number, data: Partial<AgentRecord>): Promise<void> {
  const taskNum = resolveTaskNum(taskIdOrNum);
  if (taskNum === null) {
    throw new Error(`Invalid taskId: ${taskIdOrNum}`);
  }
  await getDbOps().upsertAgent(taskNum, data);
}

/**
 * Update agent fields (partial update)
 */
export async function updateAgentInDb(taskIdOrNum: string | number, updates: Partial<AgentRecord>): Promise<void> {
  const taskNum = resolveTaskNum(taskIdOrNum);
  if (taskNum === null) return;

  const db = getDbOps().getAgentsDb();
  await db.update({ taskNum }, { $set: updates });
}

/**
 * Delete agent from db
 */
export async function deleteAgentFromDb(taskIdOrNum: string | number): Promise<void> {
  const taskNum = resolveTaskNum(taskIdOrNum);
  if (taskNum === null) return;
  await getDbOps().deleteAgent(taskNum);
}

/**
 * Get agents by status (convenience)
 */
export function getAgentsByStatus(status: string): Array<AgentRecord & { taskId: string }> {
  return getAgentsArray({ status });
}

/**
 * Count agents by status
 */
export function countAgentsByStatus(): Record<string, number> {
  const agents = getAgentsArray();
  const counts: Record<string, number> = {};
  for (const agent of agents) {
    counts[agent.status] = (counts[agent.status] || 0) + 1;
  }
  return counts;
}

// ============================================================================
// Path Derivation Helpers (config-aware)
// ============================================================================

/**
 * Get agent directory path for a task
 */
export function getAgentDir(taskIdOrNum: string | number): string | null {
  const taskNum = resolveTaskNum(taskIdOrNum);
  if (taskNum === null) return null;
  return getAgentDirPath(getHaven(), taskNum, getTaskDigits());
}

/**
 * Get mission file path for a task
 */
export function getAgentMissionFile(taskIdOrNum: string | number): string | null {
  const agentDir = getAgentDir(taskIdOrNum);
  if (!agentDir) return null;
  return getMissionFilePath(agentDir);
}

/**
 * Get log file path for a task
 */
export function getAgentLogFile(taskIdOrNum: string | number): string | null {
  const agentDir = getAgentDir(taskIdOrNum);
  if (!agentDir) return null;
  return getLogFilePath(agentDir);
}

/**
 * Get SRT config file path for a task
 */
export function getAgentSrtConfig(taskIdOrNum: string | number): string | null {
  const agentDir = getAgentDir(taskIdOrNum);
  if (!agentDir) return null;
  return getSrtConfigPath(agentDir);
}

/**
 * Get MCP config file path for a task
 */
export function getAgentMcpConfig(taskIdOrNum: string | number): string | null {
  const agentDir = getAgentDir(taskIdOrNum);
  if (!agentDir) return null;
  return getMcpConfigPath(agentDir);
}

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Migrate existing agents.json from taskId to taskNum format
 */
export async function migrateAgentsToTaskNum(): Promise<number> {
  return getDbOps().convertExistingAgents();
}
