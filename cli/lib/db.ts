/**
 * Database layer for sailing runtime state
 * Uses custom jsondb for concurrent-safe JSON storage
 *
 * PURE LIB: No config access, no manager imports.
 * DbOps class encapsulates operations needing dbDir.
 *
 * Files stored in dbDir/:
 *   - agents.json: Agent tracking (keyed by taskNum)
 *   - runs.json: Run history
 *
 * Migration: taskId (string) → taskNum (number) as primary key
 */
import path from 'path';
import { Collection } from './jsondb.js';
import { parseTaskNum } from './agent-paths.js';

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
   * Index: taskNum (number) - survives nomenclature changes
   */
  getAgentsDb(): Collection {
    if (!this.agentsDb) {
      this.agentsDb = new Collection(path.join(this.dbDir, 'agents.json'));
      void this.agentsDb.ensureIndex({ fieldName: 'taskNum', unique: true });
    }
    return this.agentsDb;
  }

  /**
   * Get runs collection
   */
  getRunsDb(): Collection {
    if (!this.runsDb) {
      this.runsDb = new Collection(path.join(this.dbDir, 'runs.json'));
      void this.runsDb.ensureIndex({ fieldName: 'taskId' });
    }
    return this.runsDb;
  }

  // --------------------------------------------------------------------------
  // Agent Operations (taskNum-based)
  // --------------------------------------------------------------------------

  /**
   * Create or update agent entry
   */
  async upsertAgent(taskNum: number, data: object): Promise<void> {
    const db = this.getAgentsDb();
    await db.update(
      { taskNum },
      { $set: { taskNum, ...data } },
      { upsert: true }
    );
  }

  /**
   * Get agent by taskNum
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAgent(taskNum: number): any {
    const db = this.getAgentsDb();
    return db.findOne({ taskNum });
  }

  /**
   * Get all agents
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAllAgents(options: DbOptions = {}): any[] {
    const db = this.getAgentsDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {};

    if (options.status) {
      query.status = options.status;
    }

    const agents = db.find(query);
    // Sort by spawned_at descending
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return agents.sort((a: any, b: any) => {
      const dateA: string = (a.spawned_at || a._createdAt || '') as string;
      const dateB: string = (b.spawned_at || b._createdAt || '') as string;
      return dateB.localeCompare(dateA);
    });
  }

  /**
   * Delete agent entry
   */
  async deleteAgent(taskNum: number): Promise<void> {
    const db = this.getAgentsDb();
    await db.remove({ taskNum });
  }

  /**
   * Clear all agents
   */
  async clearAllAgents(): Promise<number> {
    const db = this.getAgentsDb();
    const count = db.count();
    await db.clear();
    return count;
  }

  /**
   * Update agent status
   */
  async updateAgentStatus(taskNum: number, status: string, extraData: object = {}): Promise<void> {
    const db = this.getAgentsDb();
    await db.update(
      { taskNum },
      { $set: { status, ...extraData } }
    );
  }

  // --------------------------------------------------------------------------
  // Run Operations
  // --------------------------------------------------------------------------

  /**
   * Create a new run entry
   */
  async createRun(taskNum: number, logFile: string): Promise<string> {
    const db = this.getRunsDb();
    const doc: { _id: string } = await db.insert({
      taskNum,
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
  getRunsForTask(taskNum: number): any[] {
    const db = this.getRunsDb();
    const runs = db.find({ taskNum });
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
   * Migrate agents from old taskId-based format to taskNum-based
   * Handles both state.json migration and existing agents.json conversion
   */
  async migrateToTaskNum(agents: Record<string, object>): Promise<number> {
    const db = this.getAgentsDb();

    let count = 0;
    for (const [taskId, data] of Object.entries(agents)) {
      const taskNum = parseTaskNum(taskId);
      if (taskNum === null) {
        console.warn(`Skipping invalid taskId: ${taskId}`);
        continue;
      }

      // Remove old taskId field, add taskNum
      const { taskId: _oldTaskId, ...cleanData } = data as Record<string, unknown>;
      await db.update(
        { taskNum },
        { $set: { taskNum, ...cleanData, migratedAt: new Date().toISOString() } },
        { upsert: true }
      );
      count++;
    }

    return count;
  }

  /**
   * Convert existing agents.json from taskId to taskNum format
   * Reads current data, removes old entries, inserts with taskNum
   */
  async convertExistingAgents(): Promise<number> {
    const db = this.getAgentsDb();
    const existing = db.find({});

    let count = 0;
    for (const doc of existing) {
      // Skip if already has taskNum and no taskId
      if (doc.taskNum !== undefined && doc.taskId === undefined) {
        continue;
      }

      // Get taskNum from taskId or existing taskNum
      let taskNum: number | null = doc.taskNum;
      if (taskNum === undefined && doc.taskId) {
        taskNum = parseTaskNum(doc.taskId);
      }

      if (taskNum === null) {
        console.warn(`Skipping invalid agent entry: ${JSON.stringify(doc)}`);
        continue;
      }

      // Remove old entry and insert new one
      if (doc._id) {
        await db.remove({ _id: doc._id });
      }

      const { _id, taskId: _oldTaskId, ...cleanData } = doc;
      await db.update(
        { taskNum },
        { $set: { taskNum, ...cleanData, migratedAt: new Date().toISOString() } },
        { upsert: true }
      );
      count++;
    }

    return count;
  }
}
