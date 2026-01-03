/**
 * Database layer for sailing runtime state
 * Uses custom jsondb for concurrent-safe JSON storage
 *
 * Files stored in ${haven}/db/:
 *   - agents.json: Agent tracking
 *   - runs.json: Run history
 *
 * state.json remains for simple counters (prd, epic, task, story)
 */
import path from 'path';
import { resolvePlaceholders, resolvePath } from './paths.js';
import { Collection } from './jsondb.js';

let agentsDb = null;
let runsDb = null;

/**
 * Get database directory (configurable via paths.yaml: db)
 */
function getDbDir() {
  const custom = resolvePath('db');
  return custom || resolvePlaceholders('${haven}/db');
}

/**
 * Get agents collection
 * @returns {Collection}
 */
export function getAgentsDb() {
  if (!agentsDb) {
    agentsDb = new Collection(path.join(getDbDir(), 'agents.json'));
    agentsDb.ensureIndex({ fieldName: 'taskId', unique: true });
  }
  return agentsDb;
}

/**
 * Get runs collection
 * @returns {Collection}
 */
export function getRunsDb() {
  if (!runsDb) {
    runsDb = new Collection(path.join(getDbDir(), 'runs.json'));
    runsDb.ensureIndex({ fieldName: 'taskId' });
  }
  return runsDb;
}

// ============ Agent Operations ============

/**
 * Create or update agent entry
 * @param {string} taskId - Task ID (e.g., T005)
 * @param {object} data - Agent data
 */
export async function upsertAgent(taskId, data) {
  const db = getAgentsDb();
  await db.update(
    { taskId },
    { $set: { taskId, ...data } },
    { upsert: true }
  );
}

/**
 * Get agent by task ID
 * @param {string} taskId - Task ID
 * @returns {Promise<object|null>} Agent data or null
 */
export async function getAgent(taskId) {
  const db = getAgentsDb();
  return await db.findOne({ taskId });
}

/**
 * Get all agents
 * @param {object} options - Filter options
 * @returns {Promise<object[]>} Array of agents
 */
export async function getAllAgents(options = {}) {
  const db = getAgentsDb();
  const query = {};

  if (options.status) {
    query.status = options.status;
  }

  const agents = await db.find(query);
  // Sort by spawnedAt descending
  return agents.sort((a, b) => {
    const dateA = a.spawnedAt || a._createdAt || '';
    const dateB = b.spawnedAt || b._createdAt || '';
    return dateB.localeCompare(dateA);
  });
}

/**
 * Delete agent entry
 * @param {string} taskId - Task ID
 */
export async function deleteAgent(taskId) {
  const db = getAgentsDb();
  await db.remove({ taskId });
}

/**
 * Clear all agents
 * @returns {Promise<number>} Number of agents cleared
 */
export async function clearAllAgents() {
  const db = getAgentsDb();
  const count = await db.count();
  await db.clear();
  return count;
}

/**
 * Update agent status
 * @param {string} taskId - Task ID
 * @param {string} status - New status
 * @param {object} extraData - Additional fields to update
 */
export async function updateAgentStatus(taskId, status, extraData = {}) {
  const db = getAgentsDb();
  await db.update(
    { taskId },
    { $set: { status, ...extraData } }
  );
}

// ============ Run Operations ============

/**
 * Create a new run entry
 * @param {string} taskId - Task ID
 * @param {string} logFile - Log file path
 * @returns {Promise<string>} Run ID
 */
export async function createRun(taskId, logFile) {
  const db = getRunsDb();
  const doc = await db.insert({
    taskId,
    startedAt: new Date().toISOString(),
    logFile
  });
  return doc._id;
}

/**
 * Complete a run
 * @param {string} runId - Run ID
 * @param {number} exitCode - Exit code
 */
export async function completeRun(runId, exitCode) {
  const db = getRunsDb();
  await db.update(
    { _id: runId },
    { $set: { endedAt: new Date().toISOString(), exitCode } }
  );
}

/**
 * Get runs for a task
 * @param {string} taskId - Task ID
 * @returns {Promise<object[]>} Array of runs
 */
export async function getRunsForTask(taskId) {
  const db = getRunsDb();
  const runs = await db.find({ taskId });
  // Sort by startedAt descending
  return runs.sort((a, b) => {
    const dateA = a.startedAt || '';
    const dateB = b.startedAt || '';
    return dateB.localeCompare(dateA);
  });
}

// ============ Migration ============

/**
 * Migrate agents from state.json to jsondb
 * Call this once during upgrade
 */
export async function migrateFromStateJson(stateAgents) {
  const db = getAgentsDb();

  let count = 0;
  for (const [taskId, data] of Object.entries(stateAgents)) {
    await db.update(
      { taskId },
      { $set: { taskId, ...data, migratedAt: new Date().toISOString() } },
      { upsert: true }
    );
    count++;
  }

  return count;
}
