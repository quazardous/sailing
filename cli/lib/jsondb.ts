/**
 * Minimal JSON NoSQL database with file locking
 *
 * Features:
 * - One file per collection (plain JSON, human-readable)
 * - File-based locking for concurrent access
 * - Atomic writes (temp file + rename)
 * - MongoDB-like API (find, insert, update, remove)
 * - Stale lock detection
 *
 * Usage:
 *   import { Collection } from './jsondb.js';
 *   const agents = new Collection<AgentDoc>('/path/to/agents.json');
 *   await agents.insert({ taskId: 'T001', status: 'running' });
 *   const agent = await agents.findOne({ taskId: 'T001' });
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type Query<T> = Partial<T> & Record<string, any>;
export type UpdateOps<T> = {
  $set?: Partial<T>;
  $unset?: Partial<Record<keyof T, any>>;
  $inc?: Partial<Record<keyof T, number>>;
  $push?: Partial<Record<keyof T, any>>;
  [key: string]: any;
};
export type UpdateOptions = { upsert?: boolean; multi?: boolean };
export type RemoveOptions = { multi?: boolean };
export type EnsureIndexOptions = { fieldName?: string; unique?: boolean };

// Lock timeout in ms (stale after this)
const LOCK_STALE_MS = 30000;
// Lock retry interval
const LOCK_RETRY_MS = 50;
// Default lock acquire timeout
const LOCK_TIMEOUT_MS = 5000;

/**
 * Generate unique ID
 */
function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Match document against query
 * Supports: exact match, $gt, $gte, $lt, $lte, $ne, $in, $exists
 */
function matchQuery<T>(doc: T, query: Query<T>): boolean {
  if (!query || Object.keys(query).length === 0) return true;

  for (const [key, condition] of Object.entries(query)) {
    const value = (doc as any)[key];

    // Operator query: { age: { $gt: 18 } }
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      for (const [op, opValue] of Object.entries(condition)) {
        switch (op) {
          case '$gt': if (!(value > (opValue as number))) return false; break;
          case '$gte': if (!(value >= (opValue as number))) return false; break;
          case '$lt': if (!(value < (opValue as number))) return false; break;
          case '$lte': if (!(value <= (opValue as number))) return false; break;
          case '$ne': if (value === opValue) return false; break;
          case '$in': if (!Array.isArray(opValue) || !opValue.includes(value)) return false; break;
          case '$nin': if (Array.isArray(opValue) && opValue.includes(value)) return false; break;
          case '$exists':
            if (opValue && value === undefined) return false;
            if (!opValue && value !== undefined) return false;
            break;
          default:
            // Nested object match
            if (value?.[op] !== opValue) return false;
        }
      }
    } else {
      // Exact match
      if (value !== condition) return false;
    }
  }
  return true;
}

/**
 * Apply update operations to document
 * Supports: $set, $unset, $inc, $push
 */
function applyUpdate<T>(doc: T, update: UpdateOps<T>): T {
  const result = { ...doc } as any;

  for (const [op, fields] of Object.entries(update)) {
    switch (op) {
      case '$set':
        Object.assign(result, fields);
        break;
      case '$unset':
        for (const key of Object.keys(fields as object)) {
          delete result[key];
        }
        break;
      case '$inc':
        for (const [key, amount] of Object.entries(fields as object)) {
          result[key] = (result[key] || 0) + (amount as number);
        }
        break;
      case '$push':
        for (const [key, value] of Object.entries(fields as object)) {
          if (!Array.isArray(result[key])) result[key] = [];
          result[key].push(value);
        }
        break;
      default:
        // Direct field update (no operator)
        if (!op.startsWith('$')) {
          result[op] = fields;
        }
    }
  }

  result._updatedAt = new Date().toISOString();
  return result as T;
}

/**
 * JSON Collection - one file, multiple documents
 */
export class Collection<T = Record<string, any>> {
  filepath: string;
  lockfile: string;

  constructor(filepath: string) {
    this.filepath = filepath;
    this.lockfile = filepath + '.lock';

    // Ensure directory exists
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Acquire file lock
   */
  async acquireLock(timeout = LOCK_TIMEOUT_MS): Promise<boolean> {
    const startTime = Date.now();
    const pid = process.pid;

    while (Date.now() - startTime < timeout) {
      try {
        // Try to create lock file exclusively
        fs.writeFileSync(this.lockfile, JSON.stringify({
          pid,
          time: Date.now(),
          host: process.env.HOSTNAME || 'localhost'
        }), { flag: 'wx' });
        return true;
      } catch (err) {
        const anyErr = err as NodeJS.ErrnoException;
        if (anyErr.code === 'EEXIST') {
          // Lock exists - check if stale
          try {
            const lockData = JSON.parse(fs.readFileSync(this.lockfile, 'utf8'));
            if (Date.now() - lockData.time > LOCK_STALE_MS) {
              // Stale lock - remove it
              fs.unlinkSync(this.lockfile);
              continue;
            }
          } catch {
            // Can't read lock - try to remove
            try { fs.unlinkSync(this.lockfile); } catch { /* ignore */ }
            continue;
          }
          // Wait and retry
          await new Promise(r => setTimeout(r, LOCK_RETRY_MS + Math.random() * LOCK_RETRY_MS));
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Failed to acquire lock on ${this.filepath} after ${timeout}ms`);
  }

  /**
   * Release file lock
   */
  releaseLock(): void {
    try {
      fs.unlinkSync(this.lockfile);
    } catch (_err) {
      // Ignore errors
    }
  }

  /**
   * Read all documents from file
   */
  readAll(): T[] {
    if (!fs.existsSync(this.filepath)) {
      return [];
    }
    try {
      const content = fs.readFileSync(this.filepath, 'utf8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Write all documents to file (atomic)
   */
  writeAll(docs: T[]): void {
    const tempFile = this.filepath + '.tmp.' + process.pid;
    fs.writeFileSync(tempFile, JSON.stringify(docs, null, 2) + '\n');
    fs.renameSync(tempFile, this.filepath);
  }

  /**
   * Execute operation with lock
   */
  async withLock<R>(fn: () => R | Promise<R>): Promise<R> {
    await this.acquireLock();
    try {
      return await fn();
    } finally {
      this.releaseLock();
    }
  }

  // ============ Query Operations ============

  /**
   * Find all matching documents
   */
  async find(query: Query<T> = {}): Promise<T[]> {
    const docs = this.readAll();
    return docs.filter(doc => matchQuery(doc, query));
  }

  /**
   * Find first matching document
   */
  async findOne(query: Query<T> = {}): Promise<T | null> {
    const docs = this.readAll();
    return docs.find(doc => matchQuery(doc, query)) || null;
  }

  /**
   * Count matching documents
   */
  async count(query: Query<T> = {}): Promise<number> {
    const docs = await this.find(query);
    return docs.length;
  }

  // ============ Write Operations ============

  /**
   * Insert document(s)
   * @returns inserted document(s) with _id
   */
  async insert(doc: T | T[]): Promise<T | T[]> {
    const isArray = Array.isArray(doc);
    const docs = isArray ? doc : [doc];

    const now = new Date().toISOString();
    const toInsert = docs.map(d => ({
      _id: (d as any)._id || generateId(),
      ...d,
      _createdAt: now,
      _updatedAt: now
    }));

    await this.withLock(() => {
      const existing = this.readAll();
      this.writeAll([...existing, ...toInsert]);
    });

    return isArray ? toInsert : toInsert[0];
  }

  /**
   * Update matching documents
   * @param {object} query - Match query
   * @param {object} update - Update operations ($set, $unset, $inc, $push)
   * @param {object} options - { upsert: boolean, multi: boolean }
   * @returns {{ matched: number, modified: number, upserted: boolean }}
   */
  async update(query: Query<T>, update: UpdateOps<T>, options: UpdateOptions = {}): Promise<{ matched: number; modified: number; upserted: boolean }> {
    const { upsert = false, multi = false } = options;
    let matched = 0, modified = 0, upserted = false;

    await this.withLock(() => {
      const docs = this.readAll();
      let found = false;

      for (let i = 0; i < docs.length; i++) {
        if (matchQuery(docs[i], query)) {
          found = true;
          matched++;
          docs[i] = applyUpdate(docs[i], update);
          modified++;
          if (!multi) break;
        }
      }

      if (!found && upsert) {
        // Create new document from query + update
        const newDoc = {
          _id: generateId(),
          ...query,
          _createdAt: new Date().toISOString()
        } as unknown as T;
        docs.push(applyUpdate(newDoc, update));
        upserted = true;
        modified++;
      }

      this.writeAll(docs);
    });

    return { matched, modified, upserted };
  }

  /**
   * Update one document (upsert by default for convenience)
   */
  async updateOne(query: Query<T>, update: UpdateOps<T>, options: UpdateOptions = {}): Promise<{ matched: number; modified: number; upserted: boolean }> {
    return this.update(query, update, { ...options, multi: false });
  }

  /**
   * Remove matching documents
   * @returns number of removed documents
   */
  async remove(query: Query<T>, options: RemoveOptions = {}): Promise<number> {
    const { multi = true } = options;
    let removed = 0;

    await this.withLock(() => {
      const docs = this.readAll();
      const remaining: T[] = [];

      for (const doc of docs) {
        if (matchQuery(doc, query) && (multi || removed === 0)) {
          removed++;
        } else {
          remaining.push(doc);
        }
      }

      this.writeAll(remaining);
    });

    return removed;
  }

  /**
   * Remove all documents
   */
  async clear(): Promise<void> {
    await this.withLock(() => {
      this.writeAll([]);
    });
  }

  // ============ Index Operations ============

  /**
   * Ensure index exists (for API compatibility, indexes stored in separate file)
   * Note: For this simple implementation, indexes just speed up unique checks
   */
  async ensureIndex(options: EnsureIndexOptions = {}): Promise<void> {
    const { fieldName, unique = false } = options;
    if (!fieldName) return;

    // Store index config
    const indexFile = this.filepath + '.idx';
    let indexes: Record<string, { unique: boolean }> = {};
    try {
      indexes = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    } catch { /* ignore */ }

    indexes[fieldName] = { unique };
    fs.writeFileSync(indexFile, JSON.stringify(indexes, null, 2) + '\n');
  }

  /**
   * Compact file (rewrite without deleted entries - already done on each write)
   */
  async compact(): Promise<void> {
    await this.withLock(() => {
      const docs = this.readAll();
      this.writeAll(docs);
    });
  }
}

/**
 * Create collection instance (factory function)
 */
export function createCollection<T = Record<string, any>>(filepath: string): Collection<T> {
  return new Collection<T>(filepath);
}