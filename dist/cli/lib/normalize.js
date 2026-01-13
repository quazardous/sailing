/**
 * ID normalization utilities
 * Handles flexible ID formats: T1, T01, T00001, E1, E0001, S1, S0001, PRD-1, PRD-001
 *
 * Canonical format uses configured digits (default: 3)
 */
import path from 'path';
import { formatId } from './config.js';
/**
 * Normalize entity IDs to canonical format
 * Accepts any number of digits, outputs configured padding
 */
export function normalizeId(id) {
    if (!id)
        return id ?? null;
    // PRD format
    const prdMatch = id.match(/^PRD-?(\d+)$/i);
    if (prdMatch) {
        return formatId('PRD-', parseInt(prdMatch[1], 10));
    }
    // Epic format
    const epicMatch = id.match(/^E(\d+)$/i);
    if (epicMatch) {
        return formatId('E', parseInt(epicMatch[1], 10));
    }
    // Task format
    const taskMatch = id.match(/^T(\d+)$/i);
    if (taskMatch) {
        return formatId('T', parseInt(taskMatch[1], 10));
    }
    // Story format
    const storyMatch = id.match(/^S(\d+)$/i);
    if (storyMatch) {
        return formatId('S', parseInt(storyMatch[1], 10));
    }
    return id;
}
/**
 * Check if a filename matches a normalized ID
 * e.g., matchesId("T002-some-task.md", "T2") => true
 */
export function matchesId(filename, rawId) {
    const normalizedInput = normalizeId(rawId);
    if (!normalizedInput)
        return false;
    const basename = path.basename(filename, '.md');
    // Extract ID from filename (e.g., "T002" from "T002-some-task")
    const filenameIdMatch = basename.match(/^(T\d+|E\d+|S\d+|PRD-\d+)/i);
    if (!filenameIdMatch)
        return false;
    const normalizedFilename = normalizeId(filenameIdMatch[1]);
    return normalizedFilename === normalizedInput;
}
/**
 * Check if a PRD directory matches a PRD ID (flexible matching)
 * e.g., matchesPrdDir("PRD-001-foundation", "PRD-1") => true
 * Also accepts partial name match: "foundation" matches "PRD-001-foundation"
 */
export function matchesPrdDir(dirname, rawId) {
    const basename = path.basename(dirname);
    // Try normalized PRD ID match first (PRD-1 → PRD-001)
    const inputIdMatch = rawId.match(/^PRD-?(\d+)/i);
    if (inputIdMatch) {
        const dirIdMatch = basename.match(/^(PRD-\d+)/i);
        if (dirIdMatch) {
            return normalizeId(dirIdMatch[1]) === normalizeId(rawId);
        }
    }
    // Fall back to substring match (e.g., "foundation", "quarkernel")
    return basename.toLowerCase().includes(rawId.toLowerCase());
}
/**
 * Extract task ID from blocked_by entry (handles "T002 (description)" format)
 * Always returns normalized format (T001, not T1)
 */
export function extractTaskId(blockerEntry) {
    const match = blockerEntry.match(/^(T\d+)/i);
    return match ? normalizeId(match[1]) : null;
}
/**
 * Determine entity type from ID
 */
export function getEntityType(id) {
    if (!id)
        return null;
    if (id.match(/^PRD-?\d+$/i))
        return 'prd';
    if (id.match(/^E\d+$/i))
        return 'epic';
    if (id.match(/^T\d+$/i))
        return 'task';
    if (id.match(/^S\d+$/i))
        return 'story';
    return null;
}
/**
 * Extract numeric key from ID (format-agnostic)
 * E001 → 1, E0001 → 1, E14 → 14, E005a → "5a"
 */
export function extractNumericKey(id) {
    if (!id)
        return null;
    const match = id.match(/^[A-Z]+-?0*(\d+)([a-z])?/i);
    if (!match)
        return null;
    return match[1] + (match[2] ? match[2].toLowerCase() : '');
}
/**
 * Check if parent field contains an epic ID (format-agnostic)
 * Compares by numeric key: "PRD-001 / E001" matches E1, E001, E0001
 */
export function parentContainsEpic(parent, epicId) {
    if (!parent || !epicId)
        return false;
    // Extract epic ID from parent string (e.g., "PRD-001 / E001" → "E001")
    const parentEpicMatch = parent.match(/E\d+[a-z]?/i);
    if (!parentEpicMatch)
        return false;
    // Compare by numeric key
    const parentKey = extractNumericKey(parentEpicMatch[0]);
    const epicKey = extractNumericKey(epicId);
    return parentKey === epicKey;
}
/**
 * Check if parent field contains a PRD ID (format-agnostic)
 */
export function parentContainsPrd(parent, prdId) {
    if (!parent || !prdId)
        return false;
    // Extract PRD ID from parent string
    const parentPrdMatch = parent.match(/PRD-?\d+/i);
    if (!parentPrdMatch)
        return false;
    // Compare by numeric key
    const parentKey = extractNumericKey(parentPrdMatch[0]);
    const prdKey = extractNumericKey(prdId);
    return parentKey === prdKey;
}
