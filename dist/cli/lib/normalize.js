/**
 * ID normalization and extraction utilities
 * Handles flexible ID formats: T1, T01, T00001, E1, E0001, S1, S0001, PRD-1, PRD-001
 *
 * Canonical format uses configured digits (default: 3)
 *
 * Pure string operations only - no I/O, no config.
 */
import path from 'path';
// Default digit configuration
const DEFAULT_DIGITS = {
    prd: 3,
    epic: 3,
    task: 3,
    story: 3
};
// ============================================================================
// Pure ID Formatting
// ============================================================================
/**
 * Format an ID with specified digits (pure function)
 * @param prefix - ID prefix (e.g., 'PRD-', 'E', 'T', 'S')
 * @param num - Numeric part of the ID
 * @param digits - Number of digits to pad to
 */
export function formatIdWith(prefix, num, digits) {
    return `${prefix}${String(num).padStart(digits, '0')}`;
}
/**
 * Format ID using digit config (pure function)
 */
export function formatIdFrom(prefix, num, config = DEFAULT_DIGITS) {
    const digitMap = {
        'PRD-': config.prd,
        'E': config.epic,
        'T': config.task,
        'S': config.story
    };
    const digits = digitMap[prefix] || 3;
    return formatIdWith(prefix, num, digits);
}
// ============================================================================
// ID Extraction (from parent fields, strings)
// ============================================================================
/**
 * Extract PRD ID from parent field or string
 * @param parent - Parent field (e.g., "PRD-001 / E002") or any string containing PRD ID
 * @returns PRD ID or null
 */
export function extractPrdId(parent) {
    if (!parent)
        return null;
    const match = parent.match(/PRD-\d+/);
    return match ? match[0] : null;
}
/**
 * Extract Epic ID from parent field or string
 * @param parent - Parent field (e.g., "PRD-001 / E002") or any string containing Epic ID
 * @returns Epic ID or null
 */
export function extractEpicId(parent) {
    if (!parent)
        return null;
    const match = parent.match(/E\d+/);
    return match ? match[0] : null;
}
/**
 * Normalize entity IDs to canonical format (pure function)
 * Accepts any number of digits, outputs configured padding
 * @param id - ID to normalize
 * @param digitConfig - Optional digit configuration (defaults to 3 digits each)
 * @param defaultType - Optional default type for numeric-only input (e.g., "1" → "T001" if defaultType is 'task')
 */
export function normalizeId(id, digitConfig = DEFAULT_DIGITS, defaultType) {
    if (!id)
        return id ?? null;
    // PRD format
    const prdMatch = id.match(/^PRD-?(\d+)$/i);
    if (prdMatch) {
        return formatIdFrom('PRD-', parseInt(prdMatch[1], 10), digitConfig);
    }
    // Epic format
    const epicMatch = id.match(/^E(\d+)$/i);
    if (epicMatch) {
        return formatIdFrom('E', parseInt(epicMatch[1], 10), digitConfig);
    }
    // Task format
    const taskMatch = id.match(/^T(\d+)$/i);
    if (taskMatch) {
        return formatIdFrom('T', parseInt(taskMatch[1], 10), digitConfig);
    }
    // Story format
    const storyMatch = id.match(/^S(\d+)$/i);
    if (storyMatch) {
        return formatIdFrom('S', parseInt(storyMatch[1], 10), digitConfig);
    }
    // Numeric-only format with defaultType
    const numericMatch = id.match(/^(\d+)$/);
    if (numericMatch && defaultType) {
        const prefixMap = {
            'prd': 'PRD-',
            'epic': 'E',
            'task': 'T',
            'story': 'S'
        };
        return formatIdFrom(prefixMap[defaultType], parseInt(numericMatch[1], 10), digitConfig);
    }
    return id;
}
/**
 * Check if a filename matches a normalized ID
 * e.g., matchesId("T002-some-task.md", "T2") => true
 */
export function matchesId(filename, rawId, digitConfig = DEFAULT_DIGITS) {
    const normalizedInput = normalizeId(rawId, digitConfig);
    if (!normalizedInput)
        return false;
    const basename = path.basename(filename, '.md');
    // Extract ID from filename (e.g., "T002" from "T002-some-task")
    const filenameIdMatch = basename.match(/^(T\d+|E\d+|S\d+|PRD-\d+)/i);
    if (!filenameIdMatch)
        return false;
    const normalizedFilename = normalizeId(filenameIdMatch[1], digitConfig);
    return normalizedFilename === normalizedInput;
}
/**
 * Check if a PRD ID matches a filter (flexible matching)
 * e.g., matchesPrd("PRD-001", "PRD-1") => true
 * e.g., matchesPrd("PRD-001", "1") => true
 */
export function matchesPrd(prdId, filter, digitConfig = DEFAULT_DIGITS) {
    // Try normalized PRD ID match (PRD-1 → PRD-001)
    const filterMatch = filter.match(/^PRD-?(\d+)/i);
    if (filterMatch) {
        return normalizeId(prdId, digitConfig) === normalizeId(filter, digitConfig);
    }
    // Try numeric-only match (e.g., "1" matches "PRD-001")
    const numericMatch = filter.match(/^(\d+)$/);
    if (numericMatch) {
        const prdNum = prdId.match(/PRD-0*(\d+)/i);
        return prdNum ? prdNum[1] === numericMatch[1] : false;
    }
    // Fall back to case-insensitive comparison
    return prdId.toLowerCase() === filter.toLowerCase();
}
/**
 * Check if a PRD directory matches a PRD ID (flexible matching)
 * e.g., matchesPrdDir("PRD-001-foundation", "PRD-1") => true
 * Also accepts partial name match: "foundation" matches "PRD-001-foundation"
 *
 * NOTE: Prefer matchesPrd() when you have a prdId. Use this only when
 * you need to find a directory from findPrdDirs().
 */
export function matchesPrdDir(dirname, rawId, digitConfig = DEFAULT_DIGITS) {
    const basename = path.basename(dirname);
    // Try normalized PRD ID match first (PRD-1 → PRD-001)
    const inputIdMatch = rawId.match(/^PRD-?(\d+)/i);
    if (inputIdMatch) {
        const dirIdMatch = basename.match(/^(PRD-\d+)/i);
        if (dirIdMatch) {
            return normalizeId(dirIdMatch[1], digitConfig) === normalizeId(rawId, digitConfig);
        }
    }
    // Fall back to substring match (e.g., "foundation", "quarkernel")
    return basename.toLowerCase().includes(rawId.toLowerCase());
}
/**
 * Extract task ID from blocked_by entry (handles "T002 (description)" format)
 * Always returns normalized format (T001, not T1)
 */
export function extractTaskId(blockerEntry, digitConfig = DEFAULT_DIGITS) {
    const match = blockerEntry.match(/^(T\d+)/i);
    return match ? normalizeId(match[1], digitConfig) : null;
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
