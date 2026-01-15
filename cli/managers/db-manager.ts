/**
 * Database Manager
 * Provides database operations with config/path access.
 *
 * MANAGER: Orchestrates libs with config/data access.
 */
import { resolvePlaceholders, resolvePath } from './core-manager.js';
import {
  getAgentsDb as getAgentsDbPure,
  getRunsDb as getRunsDbPure,
  upsertAgent as upsertAgentPure,
  getAgent as getAgentPure,
  getAllAgents as getAllAgentsPure,
  deleteAgent as deleteAgentPure,
  clearAllAgents as clearAllAgentsPure,
  updateAgentStatus as updateAgentStatusPure,
  createRun as createRunPure,
  completeRun as completeRunPure,
  getRunsForTask as getRunsForTaskPure,
  migrateFromStateJson as migrateFromStateJsonPure,
  type DbOptions,
} from '../lib/db.js';

// Re-export types
export type { DbOptions };

/**
 * Get database directory from config
 */
function getDbDir(): string {
  const custom = resolvePath('db');
  return custom || resolvePlaceholders('${haven}/db');
}

// ============ Collection Access ============

export function getAgentsDb() {
  return getAgentsDbPure(getDbDir());
}

export function getRunsDb() {
  return getRunsDbPure(getDbDir());
}

// ============ Agent Operations ============

export async function upsertAgent(taskId: string, data: object): Promise<void> {
  return upsertAgentPure(getDbDir(), taskId, data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAgent(taskId: string): Promise<any> {
  return getAgentPure(getDbDir(), taskId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAllAgents(options: DbOptions = {}): Promise<any[]> {
  return getAllAgentsPure(getDbDir(), options);
}

export async function deleteAgent(taskId: string): Promise<void> {
  return deleteAgentPure(getDbDir(), taskId);
}

export async function clearAllAgents(): Promise<number> {
  return clearAllAgentsPure(getDbDir());
}

export async function updateAgentStatus(taskId: string, status: string, extraData: object = {}): Promise<void> {
  return updateAgentStatusPure(getDbDir(), taskId, status, extraData);
}

// ============ Run Operations ============

export async function createRun(taskId: string, logFile: string): Promise<string> {
  return createRunPure(getDbDir(), taskId, logFile);
}

export async function completeRun(runId: string, exitCode: number): Promise<void> {
  return completeRunPure(getDbDir(), runId, exitCode);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getRunsForTask(taskId: string): Promise<any[]> {
  return getRunsForTaskPure(getDbDir(), taskId);
}

// ============ Migration ============

export async function migrateFromStateJson(stateAgents: Record<string, object>): Promise<number> {
  return migrateFromStateJsonPure(getDbDir(), stateAgents);
}
