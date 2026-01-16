/**
 * Database layer for sailing runtime state
 * Uses custom jsondb for concurrent-safe JSON storage
 *
 * PURE LIB: No config access, no manager imports.
 * DbOps class encapsulates operations needing dbDir.
 *
 * Files stored in dbDir/:
 *   - agents.json: Agent tracking
 *   - runs.json: Run history
 */
import path from 'path';
import { Collection } from './jsondb.js';
// ============================================================================
// DbOps Class - POO Encapsulation
// ============================================================================
/**
 * Database operations class with injected dbDir.
 * Manages agents and runs collections.
 */
export class DbOps {
    dbDir;
    agentsDb = null;
    runsDb = null;
    constructor(dbDir) {
        this.dbDir = dbDir;
    }
    // --------------------------------------------------------------------------
    // Collection Access
    // --------------------------------------------------------------------------
    /**
     * Get agents collection
     */
    getAgentsDb() {
        if (!this.agentsDb) {
            this.agentsDb = new Collection(path.join(this.dbDir, 'agents.json'));
            void this.agentsDb.ensureIndex({ fieldName: 'taskId', unique: true });
        }
        return this.agentsDb;
    }
    /**
     * Get runs collection
     */
    getRunsDb() {
        if (!this.runsDb) {
            this.runsDb = new Collection(path.join(this.dbDir, 'runs.json'));
            void this.runsDb.ensureIndex({ fieldName: 'taskId' });
        }
        return this.runsDb;
    }
    // --------------------------------------------------------------------------
    // Agent Operations
    // --------------------------------------------------------------------------
    /**
     * Create or update agent entry
     */
    async upsertAgent(taskId, data) {
        const db = this.getAgentsDb();
        await db.update({ taskId }, { $set: { taskId, ...data } }, { upsert: true });
    }
    /**
     * Get agent by task ID
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAgent(taskId) {
        const db = this.getAgentsDb();
        return db.findOne({ taskId });
    }
    /**
     * Get all agents
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAllAgents(options = {}) {
        const db = this.getAgentsDb();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query = {};
        if (options.status) {
            query.status = options.status;
        }
        const agents = db.find(query);
        // Sort by spawnedAt descending
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return agents.sort((a, b) => {
            const dateA = (a.spawnedAt || a._createdAt || '');
            const dateB = (b.spawnedAt || b._createdAt || '');
            return dateB.localeCompare(dateA);
        });
    }
    /**
     * Delete agent entry
     */
    async deleteAgent(taskId) {
        const db = this.getAgentsDb();
        await db.remove({ taskId });
    }
    /**
     * Clear all agents
     */
    async clearAllAgents() {
        const db = this.getAgentsDb();
        const count = db.count();
        await db.clear();
        return count;
    }
    /**
     * Update agent status
     */
    async updateAgentStatus(taskId, status, extraData = {}) {
        const db = this.getAgentsDb();
        await db.update({ taskId }, { $set: { status, ...extraData } });
    }
    // --------------------------------------------------------------------------
    // Run Operations
    // --------------------------------------------------------------------------
    /**
     * Create a new run entry
     */
    async createRun(taskId, logFile) {
        const db = this.getRunsDb();
        const doc = await db.insert({
            taskId,
            startedAt: new Date().toISOString(),
            logFile
        });
        return doc._id;
    }
    /**
     * Complete a run
     */
    async completeRun(runId, exitCode) {
        const db = this.getRunsDb();
        await db.update({ _id: runId }, { $set: { endedAt: new Date().toISOString(), exitCode } });
    }
    /**
     * Get runs for a task
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getRunsForTask(taskId) {
        const db = this.getRunsDb();
        const runs = db.find({ taskId });
        // Sort by startedAt descending
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return runs.sort((a, b) => {
            const dateA = (a.startedAt || '');
            const dateB = (b.startedAt || '');
            return dateB.localeCompare(dateA);
        });
    }
    // --------------------------------------------------------------------------
    // Migration
    // --------------------------------------------------------------------------
    /**
     * Migrate agents from state.json to jsondb
     */
    async migrateFromStateJson(stateAgents) {
        const db = this.getAgentsDb();
        let count = 0;
        for (const [taskId, data] of Object.entries(stateAgents)) {
            await db.update({ taskId }, { $set: { taskId, ...(data), migratedAt: new Date().toISOString() } }, { upsert: true });
            count++;
        }
        return count;
    }
}
