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
 *   const agents = new Collection('/path/to/agents.json');
 *   await agents.insert({ taskId: 'T001', status: 'running' });
 *   const agent = await agents.findOne({ taskId: 'T001' });
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Lock timeout in ms (stale after this)
const LOCK_STALE_MS = 30000;
// Lock retry interval
const LOCK_RETRY_MS = 50;
// Default lock acquire timeout
const LOCK_TIMEOUT_MS = 5000;

/**
 * Generate unique ID
 */
function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Match document against query
 * Supports: exact match, $gt, $gte, $lt, $lte, $ne, $in, $exists
 */
function matchQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;

  for (const [key, condition] of Object.entries(query)) {
    const value = doc[key];

    // Operator query: { age: { $gt: 18 } }
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
      for (const [op, opValue] of Object.entries(condition)) {
        switch (op) {
          case '$gt': if (!(value > opValue)) return false; break;
          case '$gte': if (!(value >= opValue)) return false; break;
          case '$lt': if (!(value < opValue)) return false; break;
          case '$lte': if (!(value <= opValue)) return false; break;
          case '$ne': if (value === opValue) return false; break;
          case '$in': if (!opValue.includes(value)) return false; break;
          case '$nin': if (opValue.includes(value)) return false; break;
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
function applyUpdate(doc, update) {
  const result = { ...doc };

  for (const [op, fields] of Object.entries(update)) {
    switch (op) {
      case '$set':
        Object.assign(result, fields);
        break;
      case '$unset':
        for (const key of Object.keys(fields)) {
          delete result[key];
        }
        break;
      case '$inc':
        for (const [key, amount] of Object.entries(fields)) {
          result[key] = (result[key] || 0) + amount;
        }
        break;
      case '$push':
        for (const [key, value] of Object.entries(fields)) {
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
  return result;
}

/**
 * JSON Collection - one file, multiple documents
 */
export class Collection {
  constructor(filepath) {
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
  async acquireLock(timeout = LOCK_TIMEOUT_MS) {
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
        if (err.code === 'EEXIST') {
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
  releaseLock() {
    try {
      fs.unlinkSync(this.lockfile);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Read all documents from file
   */
  readAll() {
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
  writeAll(docs) {
    const tempFile = this.filepath + '.tmp.' + process.pid;
    fs.writeFileSync(tempFile, JSON.stringify(docs, null, 2) + '\n');
    fs.renameSync(tempFile, this.filepath);
  }

  /**
   * Execute operation with lock
   */
  async withLock(fn) {
    await this.acquireLock();
    try {
      return fn();
    } finally {
      this.releaseLock();
    }
  }

  // ============ Query Operations ============

  /**
   * Find all matching documents
   */
  async find(query = {}) {
    const docs = this.readAll();
    return docs.filter(doc => matchQuery(doc, query));
  }

  /**
   * Find first matching document
   */
  async findOne(query = {}) {
    const docs = this.readAll();
    return docs.find(doc => matchQuery(doc, query)) || null;
  }

  /**
   * Count matching documents
   */
  async count(query = {}) {
    const docs = await this.find(query);
    return docs.length;
  }

  // ============ Write Operations ============

  /**
   * Insert document(s)
   * @returns inserted document(s) with _id
   */
  async insert(doc) {
    const isArray = Array.isArray(doc);
    const docs = isArray ? doc : [doc];

    const now = new Date().toISOString();
    const toInsert = docs.map(d => ({
      _id: d._id || generateId(),
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
  async update(query, update, options = {}) {
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
        };
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
  async updateOne(query, update, options = {}) {
    return this.update(query, update, { ...options, multi: false });
  }

  /**
   * Remove matching documents
   * @returns number of removed documents
   */
  async remove(query, options = {}) {
    const { multi = true } = options;
    let removed = 0;

    await this.withLock(() => {
      const docs = this.readAll();
      const remaining = [];

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
  async clear() {
    await this.withLock(() => {
      this.writeAll([]);
    });
  }

  // ============ Index Operations ============

  /**
   * Ensure index exists (for API compatibility, indexes stored in separate file)
   * Note: For this simple implementation, indexes just speed up unique checks
   */
  async ensureIndex(options = {}) {
    const { fieldName, unique = false } = options;
    if (!fieldName) return;

    // Store index config
    const indexFile = this.filepath + '.idx';
    let indexes = {};
    try {
      indexes = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    } catch { /* ignore */ }

    indexes[fieldName] = { unique };
    fs.writeFileSync(indexFile, JSON.stringify(indexes, null, 2) + '\n');
  }

  /**
   * Compact file (rewrite without deleted entries - already done on each write)
   */
  async compact() {
    await this.withLock(() => {
      const docs = this.readAll();
      this.writeAll(docs);
    });
  }
}

/**
 * Create collection instance (factory function)
 */
export function createCollection(filepath) {
  return new Collection(filepath);
}
