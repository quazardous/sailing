/**
 * Database layer for sailing runtime state
 * Uses custom jsondb for concurrent-safe JSON storage
 *
 * PURE LIB: No config access, no manager imports.
 * dbDir must be passed as parameter.
 *
 * Files stored in dbDir/:
 *   - agents.json: Agent tracking
 *   - runs.json: Run history
 */
import path from 'path';
import { Collection } from './jsondb.js';

export interface DbOptions {
  status?: string;
}

// Singleton caches indexed by dbDir
const agentsDbCache = new Map<string, Collection>();
const runsDbCache = new Map<string, Collection>();

/**
 * Get agents collection for a specific dbDir
 * @param dbDir - Database directory path
 */
export function getAgentsDb(dbDir: string): Collection {
  if (!agentsDbCache.has(dbDir)) {
    const db = new Collection(path.join(dbDir, 'agents.json'));
    db.ensureIndex({ fieldName: 'taskId', unique: true });
    agentsDbCache.set(dbDir, db);
  }
  return agentsDbCache.get(dbDir)!;
}

/**
 * Get runs collection for a specific dbDir
 * @param dbDir - Database directory path
 */
export function getRunsDb(dbDir: string): Collection {
  if (!runsDbCache.has(dbDir)) {
    const db = new Collection(path.join(dbDir, 'runs.json'));
    db.ensureIndex({ fieldName: 'taskId' });
    runsDbCache.set(dbDir, db);
  }
  return runsDbCache.get(dbDir)!;
}

// ============ Agent Operations ============

/**
 * Create or update agent entry
 * @param dbDir - Database directory path
 * @param taskId - Task ID (e.g., T005)
 * @param data - Agent data
 */
export async function upsertAgent(dbDir: string, taskId: string, data: object): Promise<void> {
  const db = getAgentsDb(dbDir);
  await db.update(
    { taskId },
    { $set: { taskId, ...data } },
    { upsert: true }
  );
}

/**
 * Get agent by task ID
 * @param dbDir - Database directory path
 * @param taskId - Task ID
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAgent(dbDir: string, taskId: string): Promise<any> {
  const db = getAgentsDb(dbDir);
  return await db.findOne({ taskId });
}

/**
 * Get all agents
 * @param dbDir - Database directory path
 * @param options - Filter options
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAllAgents(dbDir: string, options: DbOptions = {}): Promise<any[]> {
  const db = getAgentsDb(dbDir);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {};

  if (options.status) {
    query.status = options.status;
  }

  const agents = await db.find(query);
  // Sort by spawnedAt descending
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return agents.sort((a: any, b: any) => {
    const dateA = a.spawnedAt || a._createdAt || '';
    const dateB = b.spawnedAt || b._createdAt || '';
    return dateB.localeCompare(dateA);
  });
}

/**
 * Delete agent entry
 * @param dbDir - Database directory path
 * @param taskId - Task ID
 */
export async function deleteAgent(dbDir: string, taskId: string): Promise<void> {
  const db = getAgentsDb(dbDir);
  await db.remove({ taskId });
}

/**
 * Clear all agents
 * @param dbDir - Database directory path
 * @returns Number of agents cleared
 */
export async function clearAllAgents(dbDir: string): Promise<number> {
  const db = getAgentsDb(dbDir);
  const count = await db.count();
  await db.clear();
  return count;
}

/**
 * Update agent status
 * @param dbDir - Database directory path
 * @param taskId - Task ID
 * @param status - New status
 * @param extraData - Additional fields to update
 */
export async function updateAgentStatus(dbDir: string, taskId: string, status: string, extraData: object = {}): Promise<void> {
  const db = getAgentsDb(dbDir);
  await db.update(
    { taskId },
    { $set: { status, ...extraData } }
  );
}

// ============ Run Operations ============

/**
 * Create a new run entry
 * @param dbDir - Database directory path
 * @param taskId - Task ID
 * @param logFile - Log file path
 * @returns Run ID
 */
export async function createRun(dbDir: string, taskId: string, logFile: string): Promise<string> {
  const db = getRunsDb(dbDir);
  const doc = await db.insert({
    taskId,
    startedAt: new Date().toISOString(),
    logFile
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return doc._id;
}

/**
 * Complete a run
 * @param dbDir - Database directory path
 * @param runId - Run ID
 * @param exitCode - Exit code
 */
export async function completeRun(dbDir: string, runId: string, exitCode: number): Promise<void> {
  const db = getRunsDb(dbDir);
  await db.update(
    { _id: runId },
    { $set: { endedAt: new Date().toISOString(), exitCode } }
  );
}

/**
 * Get runs for a task
 * @param dbDir - Database directory path
 * @param taskId - Task ID
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getRunsForTask(dbDir: string, taskId: string): Promise<any[]> {
  const db = getRunsDb(dbDir);
  const runs = await db.find({ taskId });
  // Sort by startedAt descending
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return runs.sort((a: any, b: any) => {
    const dateA = a.startedAt || '';
    const dateB = b.startedAt || '';
    return dateB.localeCompare(dateA);
  });
}

// ============ Migration ============

/**
 * Migrate agents from state.json to jsondb
 * @param dbDir - Database directory path
 * @param stateAgents - Agents from old state.json
 */
export async function migrateFromStateJson(dbDir: string, stateAgents: Record<string, object>): Promise<number> {
  const db = getAgentsDb(dbDir);

  let count = 0;
  for (const [taskId, data] of Object.entries(stateAgents)) {
    await db.update(
      { taskId },
      { $set: { taskId, ...(data as object), migratedAt: new Date().toISOString() } },
      { upsert: true }
    );
    count++;
  }

  return count;
}
