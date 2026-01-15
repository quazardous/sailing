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

export interface DbOptions {
  status?: string;
}

// ============================================================================
// DbOps Class - POO Encapsulation
// ============================================================================

/**
 * Database operations class with injected dbDir.
 * Manages agents and runs collections.
 */
export class DbOps {
  private agentsDb: Collection | null = null;
  private runsDb: Collection | null = null;

  constructor(private dbDir: string) {}

  // --------------------------------------------------------------------------
  // Collection Access
  // --------------------------------------------------------------------------

  /**
   * Get agents collection
   */
  getAgentsDb(): Collection {
    if (!this.agentsDb) {
      this.agentsDb = new Collection(path.join(this.dbDir, 'agents.json'));
      this.agentsDb.ensureIndex({ fieldName: 'taskId', unique: true });
    }
    return this.agentsDb;
  }

  /**
   * Get runs collection
   */
  getRunsDb(): Collection {
    if (!this.runsDb) {
      this.runsDb = new Collection(path.join(this.dbDir, 'runs.json'));
      this.runsDb.ensureIndex({ fieldName: 'taskId' });
    }
    return this.runsDb;
  }

  // --------------------------------------------------------------------------
  // Agent Operations
  // --------------------------------------------------------------------------

  /**
   * Create or update agent entry
   */
  async upsertAgent(taskId: string, data: object): Promise<void> {
    const db = this.getAgentsDb();
    await db.update(
      { taskId },
      { $set: { taskId, ...data } },
      { upsert: true }
    );
  }

  /**
   * Get agent by task ID
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAgent(taskId: string): Promise<any> {
    const db = this.getAgentsDb();
    return await db.findOne({ taskId });
  }

  /**
   * Get all agents
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getAllAgents(options: DbOptions = {}): Promise<any[]> {
    const db = this.getAgentsDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {};

    if (options.status) {
      query.status = options.status;
    }

    const agents = await db.find(query);
    // Sort by spawnedAt descending
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return agents.sort((a: any, b: any) => {
      const dateA: string = (a.spawnedAt || a._createdAt || '') as string;
      const dateB: string = (b.spawnedAt || b._createdAt || '') as string;
      return dateB.localeCompare(dateA);
    });
  }

  /**
   * Delete agent entry
   */
  async deleteAgent(taskId: string): Promise<void> {
    const db = this.getAgentsDb();
    await db.remove({ taskId });
  }

  /**
   * Clear all agents
   */
  async clearAllAgents(): Promise<number> {
    const db = this.getAgentsDb();
    const count = await db.count();
    await db.clear();
    return count;
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(taskId: string, status: string, extraData: object = {}): Promise<void> {
    const db = this.getAgentsDb();
    await db.update(
      { taskId },
      { $set: { status, ...extraData } }
    );
  }

  // --------------------------------------------------------------------------
  // Run Operations
  // --------------------------------------------------------------------------

  /**
   * Create a new run entry
   */
  async createRun(taskId: string, logFile: string): Promise<string> {
    const db = this.getRunsDb();
    const doc: { _id: string } = await db.insert({
      taskId,
      startedAt: new Date().toISOString(),
      logFile
    }) as { _id: string };
    return doc._id;
  }

  /**
   * Complete a run
   */
  async completeRun(runId: string, exitCode: number): Promise<void> {
    const db = this.getRunsDb();
    await db.update(
      { _id: runId },
      { $set: { endedAt: new Date().toISOString(), exitCode } }
    );
  }

  /**
   * Get runs for a task
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getRunsForTask(taskId: string): Promise<any[]> {
    const db = this.getRunsDb();
    const runs = await db.find({ taskId });
    // Sort by startedAt descending
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return runs.sort((a: any, b: any) => {
      const dateA: string = (a.startedAt || '') as string;
      const dateB: string = (b.startedAt || '') as string;
      return dateB.localeCompare(dateA);
    });
  }

  // --------------------------------------------------------------------------
  // Migration
  // --------------------------------------------------------------------------

  /**
   * Migrate agents from state.json to jsondb
   */
  async migrateFromStateJson(stateAgents: Record<string, object>): Promise<number> {
    const db = this.getAgentsDb();

    let count = 0;
    for (const [taskId, data] of Object.entries(stateAgents)) {
      await db.update(
        { taskId },
        { $set: { taskId, ...(data), migratedAt: new Date().toISOString() } },
        { upsert: true }
      );
      count++;
    }

    return count;
  }
}
