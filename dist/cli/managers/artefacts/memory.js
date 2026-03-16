/**
 * Memory file operations
 */
import fs from 'fs';
import path from 'path';
import { getMemoryDir } from '../core-manager.js';
import { _memoryIndex, setMemoryIndex, _logIndex, setLogIndex } from './common.js';
// ============================================================================
// INDEX
// ============================================================================
/**
 * Build memory file index
 */
export function buildMemoryIndex() {
    if (_memoryIndex)
        return _memoryIndex;
    const index = new Map();
    const memDir = getMemoryDir();
    if (!fs.existsSync(memDir)) {
        setMemoryIndex(index);
        return index;
    }
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
        const filePath = path.join(memDir, file);
        const epicMatch = /^E0*(\d+)([a-z])?\.md$/i.exec(file);
        if (epicMatch) {
            const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
            index.set(key, { key, type: 'epic', file: filePath });
            continue;
        }
        const prdMatch = /^PRD-0*(\d+)\.md$/i.exec(file);
        if (prdMatch) {
            const key = 'PRD-' + prdMatch[1];
            index.set(key, { key, type: 'prd', file: filePath });
        }
    }
    setMemoryIndex(index);
    return index;
}
// ============================================================================
// GETTERS
// ============================================================================
/**
 * Get memory file by ID
 */
export function getMemoryFile(id) {
    const index = buildMemoryIndex();
    const epicMatch = /^E0*(\d+)([a-z])?$/i.exec(String(id));
    if (epicMatch) {
        const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
        return index.get(key) || null;
    }
    const prdMatch = /^PRD-?0*(\d+)$/i.exec(String(id));
    if (prdMatch) {
        const key = 'PRD-' + prdMatch[1];
        return index.get(key) || null;
    }
    return null;
}
// ============================================================================
// LOG INDEX
// ============================================================================
/**
 * Build log file index
 */
export function buildLogIndex() {
    if (_logIndex)
        return _logIndex;
    const index = new Map();
    const memDir = getMemoryDir();
    if (!fs.existsSync(memDir)) {
        setLogIndex(index);
        return index;
    }
    const files = fs.readdirSync(memDir).filter(f => f.endsWith('.log'));
    for (const file of files) {
        const filePath = path.join(memDir, file);
        const epicMatch = /^E0*(\d+)([a-z])?\.log$/i.exec(file);
        if (epicMatch) {
            const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
            index.set(key, { key, type: 'epic', file: filePath });
            continue;
        }
        const taskMatch = /^T0*(\d+)\.log$/i.exec(file);
        if (taskMatch) {
            const key = 'T' + taskMatch[1];
            index.set(key, { key, type: 'task', file: filePath });
        }
    }
    setLogIndex(index);
    return index;
}
/**
 * Get log file by ID
 */
export function getLogFile(id) {
    const index = buildLogIndex();
    const epicMatch = /^E0*(\d+)([a-z])?$/i.exec(String(id));
    if (epicMatch) {
        const key = 'E' + epicMatch[1] + (epicMatch[2] ? epicMatch[2].toLowerCase() : '');
        return index.get(key) || null;
    }
    const taskMatch = /^T0*(\d+)$/i.exec(String(id));
    if (taskMatch) {
        const key = 'T' + taskMatch[1];
        return index.get(key) || null;
    }
    return null;
}
/**
 * Invalidate log index (call after log file changes)
 */
export function invalidateLogIndex() {
    setLogIndex(null);
}
