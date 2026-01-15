/**
 * Entity Resolution
 *
 * Provides utility functions for entity ID parsing and project file search.
 * For entity file lookups, use lib/index.ts instead (getTask, getEpic, getPrd).
 *
 * This module provides:
 *   - extractPrdId/extractEpicId/extractTaskId (string parsing)
 *   - normalizeId (ID normalization)
 *   - getPrdBranching (PRD config)
 *   - findStoryFile (story file search - no index.ts equivalent yet)
 *   - findDevMd/findToolset (project file search)
 */
import fs from 'fs';
import path from 'path';
import { getPrdsDir } from './core.js';
import { getPrd } from './index.js';
/**
 * Find story file by ID
 * @param {string} storyId - Story ID (e.g., S001)
 * @returns {string|null} Absolute path to story file or null
 */
export function findStoryFile(storyId) {
    storyId = normalizeId(storyId, 'S');
    const prdsDir = getPrdsDir();
    if (!fs.existsSync(prdsDir))
        return null;
    for (const prdDir of fs.readdirSync(prdsDir)) {
        const storiesDir = path.join(prdsDir, prdDir, 'stories');
        if (!fs.existsSync(storiesDir))
            continue;
        for (const file of fs.readdirSync(storiesDir)) {
            if (file.startsWith(storyId + '-') && file.endsWith('.md')) {
                return path.join(storiesDir, file);
            }
        }
    }
    return null;
}
/**
 * Extract PRD ID from parent field
 * @param {string} parent - Parent field (e.g., "PRD-001 / E002")
 * @returns {string|null} PRD ID or null
 */
export function extractPrdId(parent) {
    if (!parent)
        return null;
    const match = parent.match(/PRD-\d+/);
    return match ? match[0] : null;
}
/**
 * Extract Epic ID from parent field
 * @param {string} parent - Parent field (e.g., "PRD-001 / E002")
 * @returns {string|null} Epic ID or null
 */
export function extractEpicId(parent) {
    if (!parent)
        return null;
    const match = parent.match(/E\d+/);
    return match ? match[0] : null;
}
/**
 * Extract Task ID from string
 * @param {string} str - String containing task ID
 * @returns {string|null} Task ID or null
 */
export function extractTaskId(str) {
    if (!str)
        return null;
    const match = str.match(/T\d+/);
    return match ? match[0] : null;
}
/**
 * Normalize entity ID
 * @param {string} id - Raw ID
 * @param {string} prefix - Expected prefix (T, E, S, PRD-)
 * @returns {string} Normalized ID
 */
export function normalizeId(id, prefix) {
    if (!id)
        return id;
    id = id.toUpperCase();
    if (!id.startsWith(prefix)) {
        id = prefix + id;
    }
    return id;
}
/**
 * Get PRD branching strategy
 * @param {string} prdId - PRD ID
 * @returns {string} 'flat' | 'prd' | 'epic'
 */
export function getPrdBranching(prdId) {
    const prd = getPrd(prdId);
    if (!prd)
        return 'flat';
    return prd.data?.branching || 'flat';
}
/**
 * Find DEV.md file (check project root and common locations)
 * @param {string} projectRoot - Project root path
 * @returns {string|null} Path to DEV.md or null
 */
export function findDevMd(projectRoot) {
    const candidates = [
        path.join(projectRoot, 'DEV.md'),
        path.join(projectRoot, 'DEVELOPMENT.md'),
        path.join(projectRoot, 'docs', 'DEV.md'),
        path.join(projectRoot, 'docs', 'DEVELOPMENT.md')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
/**
 * Find TOOLSET.md file
 * @param {string} projectRoot - Project root path
 * @returns {string|null} Path to TOOLSET.md or null
 */
export function findToolset(projectRoot) {
    const candidates = [
        path.join(projectRoot, '.claude', 'TOOLSET.md'),
        path.join(projectRoot, 'TOOLSET.md')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}
