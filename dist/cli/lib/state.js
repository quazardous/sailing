/**
 * State management for sailing project
 * Handles centralized ID counters and state.json
 * TODO[P2]: Add runtime validation/guards on loadState/saveState to catch corrupt state early.
 * TODO[P3]: Consider splitting lock/file I/O from state helpers for easier TS migration.
 */
import fs from 'fs';
import path from 'path';
import { getStateFile, findPrdDirs, findFiles, getSailingDir } from './core.js';
/**
 * Acquire exclusive lock on state file
 * Uses a simple .lock file with PID and timestamp
 * @param {number} timeout - Max wait time in ms (default 5000)
 * @returns {string} Lock file path
 */
function acquireLock(timeout = 5000) {
    const stateFile = getStateFile();
    const lockFile = stateFile + '.lock';
    const startTime = Date.now();
    const pid = process.pid;
    while (Date.now() - startTime < timeout) {
        try {
            // Try to create lock file exclusively
            fs.writeFileSync(lockFile, JSON.stringify({ pid, time: Date.now() }), { flag: 'wx' });
            return lockFile;
        }
        catch (err) {
            if (err.code === 'EEXIST') {
                // Lock exists - check if stale (> 30s old)
                try {
                    const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
                    if (Date.now() - lockData.time > 30000) {
                        // Stale lock - remove it
                        fs.unlinkSync(lockFile);
                        continue;
                    }
                }
                catch {
                    // Can't read lock - try to remove
                    try {
                        fs.unlinkSync(lockFile);
                    }
                    catch { /* ignore */ }
                    continue;
                }
                // Wait and retry
                const waitMs = 50 + Math.random() * 50;
                const waitUntil = Date.now() + waitMs;
                while (Date.now() < waitUntil) { /* busy wait */ }
            }
            else {
                throw err;
            }
        }
    }
    throw new Error(`Failed to acquire state lock after ${timeout}ms`);
}
/**
 * Release lock on state file
 */
function releaseLock(lockFile) {
    try {
        fs.unlinkSync(lockFile);
    }
    catch {
        // Ignore errors
    }
}
/**
 * Load state from file, auto-initializing if needed
 */
export function loadState() {
    const stateFile = getStateFile();
    // Ensure .sailing directory exists
    const sailingDir = getSailingDir();
    if (!fs.existsSync(sailingDir)) {
        fs.mkdirSync(sailingDir, { recursive: true });
    }
    if (fs.existsSync(stateFile)) {
        return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
    // Auto-init: scan existing files to find max IDs
    let maxPrd = 0, maxEpic = 0, maxTask = 0, maxStory = 0;
    findPrdDirs().forEach(prdDir => {
        const prdNum = parseInt(path.basename(prdDir).match(/PRD-(\d+)/)?.[1] || '0');
        if (prdNum > maxPrd)
            maxPrd = prdNum;
        findFiles(path.join(prdDir, 'epics'), /^E\d+.*\.md$/).forEach(f => {
            const num = parseInt(path.basename(f).match(/E(\d+)/)?.[1] || '0');
            if (num > maxEpic)
                maxEpic = num;
        });
        findFiles(path.join(prdDir, 'tasks'), /^T\d+.*\.md$/).forEach(f => {
            const num = parseInt(path.basename(f).match(/T(\d+)/)?.[1] || '0');
            if (num > maxTask)
                maxTask = num;
        });
        findFiles(path.join(prdDir, 'stories'), /^S\d+.*\.md$/).forEach(f => {
            const num = parseInt(path.basename(f).match(/S(\d+)/)?.[1] || '0');
            if (num > maxStory)
                maxStory = num;
        });
    });
    const state = { counters: { prd: maxPrd, epic: maxEpic, task: maxTask, story: maxStory } };
    saveState(state);
    return state;
}
/**
 * Save state to file
 */
export function saveState(state) {
    const stateFile = getStateFile();
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
}
/**
 * Atomically update state with locking
 * Prevents race conditions when multiple processes update simultaneously
 * @param {function} updateFn - Function that receives current state and returns updated state
 * @returns {object} The updated state
 */
export function updateStateAtomic(updateFn) {
    const lockFile = acquireLock();
    try {
        const state = loadState();
        const updatedState = updateFn(state);
        saveState(updatedState);
        return updatedState;
    }
    finally {
        releaseLock(lockFile);
    }
}
/**
 * Get next ID for an entity type and increment counter
 */
export function nextId(type) {
    const state = loadState();
    // Handle null/undefined counters (e.g., story counter added after initial state.json)
    if (state.counters[type] == null) {
        state.counters[type] = 0;
    }
    state.counters[type]++;
    saveState(state);
    return state.counters[type];
}
/**
 * Peek at next ID without incrementing (for dry-run / preview)
 */
export function peekNextId(type) {
    const state = loadState();
    const current = state.counters[type] ?? 0;
    return current + 1;
}
/**
 * Get next number in a directory for a given prefix (fallback method)
 */
export function getNextNumber(dir, prefix) {
    if (!fs.existsSync(dir))
        return 1;
    const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix));
    if (files.length === 0)
        return 1;
    const nums = files.map(f => parseInt(f.match(/\d+/)?.[0] || '0'));
    return Math.max(...nums) + 1;
}
