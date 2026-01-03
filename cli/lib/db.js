/**
 * SQLite database for sailing runtime state
 * Handles agents, runs, and other concurrent-access data
 *
 * state.json remains for simple counters (prd, epic, task, story)
 * sailing.db handles everything that needs concurrent access
 */
import Database from 'better-sqlite3';
import path from 'path';
import { resolvePlaceholders } from './paths.js';

let db = null;

/**
 * Get or create database connection
 * @returns {Database} SQLite database instance
 */
export function getDb() {
  if (db) return db;

  const havenPath = resolvePlaceholders('%haven%');
  const dbPath = path.join(havenPath, 'sailing.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // Better concurrent access

  initSchema();
  return db;
}

/**
 * Initialize database schema
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      task_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'spawned',
      spawned_at TEXT,
      ended_at TEXT,
      pid INTEGER,
      exit_code INTEGER,
      exit_signal TEXT,
      worktree_path TEXT,
      branch TEXT,
      base_branch TEXT,
      branching TEXT,
      mission_file TEXT,
      log_file TEXT,
      srt_config TEXT,
      mcp_config TEXT,
      mcp_pid INTEGER,
      timeout INTEGER,
      dirty_worktree INTEGER DEFAULT 0,
      uncommitted_files INTEGER DEFAULT 0,
      recovered_at TEXT,
      killed_at TEXT,
      orphaned_at TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      exit_code INTEGER,
      log_file TEXT,
      FOREIGN KEY (task_id) REFERENCES agents(task_id)
    );

    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
  `);
}

/**
 * Close database connection
 */
export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// ============ Agent Operations ============

/**
 * Create or update agent entry
 * @param {string} taskId - Task ID (e.g., T005)
 * @param {object} data - Agent data
 */
export function upsertAgent(taskId, data) {
  const db = getDb();

  const existing = db.prepare('SELECT task_id FROM agents WHERE task_id = ?').get(taskId);

  if (existing) {
    // Update existing
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(data)) {
      const col = toSnakeCase(key);
      sets.push(`${col} = ?`);
      values.push(value);
    }
    values.push(taskId);

    if (sets.length > 0) {
      db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE task_id = ?`).run(...values);
    }
  } else {
    // Insert new
    const cols = ['task_id', ...Object.keys(data).map(toSnakeCase)];
    const placeholders = cols.map(() => '?').join(', ');
    const values = [taskId, ...Object.values(data)];

    db.prepare(`INSERT INTO agents (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
  }
}

/**
 * Get agent by task ID
 * @param {string} taskId - Task ID
 * @returns {object|null} Agent data or null
 */
export function getAgent(taskId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agents WHERE task_id = ?').get(taskId);
  return row ? rowToAgent(row) : null;
}

/**
 * Get all agents
 * @param {object} options - Filter options
 * @returns {object[]} Array of agents
 */
export function getAllAgents(options = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM agents';
  const params = [];

  if (options.status) {
    sql += ' WHERE status = ?';
    params.push(options.status);
  }

  sql += ' ORDER BY spawned_at DESC';

  return db.prepare(sql).all(...params).map(rowToAgent);
}

/**
 * Delete agent entry
 * @param {string} taskId - Task ID
 */
export function deleteAgent(taskId) {
  const db = getDb();
  db.prepare('DELETE FROM agents WHERE task_id = ?').run(taskId);
}

/**
 * Clear all agents
 * @returns {number} Number of agents cleared
 */
export function clearAllAgents() {
  const db = getDb();
  const result = db.prepare('DELETE FROM agents').run();
  return result.changes;
}

/**
 * Update agent status
 * @param {string} taskId - Task ID
 * @param {string} status - New status
 * @param {object} extraData - Additional fields to update
 */
export function updateAgentStatus(taskId, status, extraData = {}) {
  const db = getDb();
  const data = { status, ...extraData };

  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    const col = toSnakeCase(key);
    sets.push(`${col} = ?`);
    values.push(value);
  }
  values.push(taskId);

  db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE task_id = ?`).run(...values);
}

// ============ Run Operations ============

/**
 * Create a new run entry
 * @param {string} taskId - Task ID
 * @param {string} logFile - Log file path
 * @returns {number} Run ID
 */
export function createRun(taskId, logFile) {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO runs (task_id, started_at, log_file) VALUES (?, ?, ?)'
  ).run(taskId, new Date().toISOString(), logFile);
  return result.lastInsertRowid;
}

/**
 * Complete a run
 * @param {number} runId - Run ID
 * @param {number} exitCode - Exit code
 */
export function completeRun(runId, exitCode) {
  const db = getDb();
  db.prepare(
    'UPDATE runs SET ended_at = ?, exit_code = ? WHERE id = ?'
  ).run(new Date().toISOString(), exitCode, runId);
}

/**
 * Get runs for a task
 * @param {string} taskId - Task ID
 * @returns {object[]} Array of runs
 */
export function getRunsForTask(taskId) {
  const db = getDb();
  return db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId);
}

// ============ Helpers ============

/**
 * Convert camelCase to snake_case
 */
function toSnakeCase(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

/**
 * Convert database row to agent object (camelCase keys)
 */
function rowToAgent(row) {
  const agent = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    agent[camelKey] = value;
  }

  // Reconstruct worktree object if fields exist
  if (agent.worktreePath) {
    agent.worktree = {
      path: agent.worktreePath,
      branch: agent.branch,
      baseBranch: agent.baseBranch,
      branching: agent.branching
    };
  }

  // Convert boolean-ish fields
  agent.dirtyWorktree = !!agent.dirtyWorktree;

  return agent;
}

/**
 * Migrate agents from state.json to sailing.db
 * Call this once during upgrade
 */
export function migrateFromStateJson(stateAgents) {
  const db = getDb();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO agents (
      task_id, status, spawned_at, ended_at, pid, exit_code, exit_signal,
      worktree_path, branch, base_branch, branching,
      mission_file, log_file, srt_config, mcp_config, mcp_pid, timeout,
      dirty_worktree, uncommitted_files, recovered_at, killed_at, orphaned_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  const migrateMany = db.transaction((agents) => {
    for (const [taskId, data] of Object.entries(agents)) {
      insert.run(
        taskId,
        data.status || 'unknown',
        data.spawned_at || data.spawnedAt,
        data.ended_at || data.endedAt,
        data.pid,
        data.exit_code || data.exitCode,
        data.exit_signal || data.exitSignal,
        data.worktree?.path,
        data.worktree?.branch,
        data.worktree?.base_branch || data.worktree?.baseBranch,
        data.worktree?.branching,
        data.mission_file || data.missionFile,
        data.log_file || data.logFile,
        data.srt_config || data.srtConfig,
        data.mcp_config || data.mcpConfig,
        data.mcp_pid || data.mcpPid,
        data.timeout,
        data.dirty_worktree || data.dirtyWorktree ? 1 : 0,
        data.uncommitted_files || data.uncommittedFiles || 0,
        data.recovered_at || data.recoveredAt,
        data.killed_at || data.killedAt,
        data.orphaned_at || data.orphanedAt
      );
    }
  });

  migrateMany(stateAgents);
  return Object.keys(stateAgents).length;
}
