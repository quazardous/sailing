/**
 * Artefacts Library - Pure ID parsing functions
 *
 * ⚠️ NOTE: For artefact access (getTask, getEpic, etc.), use:
 *   import { getTask, getEpic, getPrd } from '../managers/artefacts-manager.js';
 *
 * This lib only contains pure string parsing functions:
 * - extractIdKey: Parse ID from filename
 * - extractNumericId: Extract numeric part from filename
 */
/**
 * Extract ID key from filename (number + optional suffix)
 * T039-foo.md → "39", T0039-bar.md → "39", T00039.md → "39"
 * E001-foo.md → "1", E0001.md → "1"
 * E005a-foo.md → "5a", E005b-bar.md → "5b"
 */
export function extractIdKey(filename, prefix = 'T') {
    // Match prefix + optional leading zeros + digits + optional letter suffix
    const match = filename.match(new RegExp(`^${prefix}0*(\\d+)([a-z])?`, 'i'));
    if (!match)
        return null;
    const num = match[1];
    const suffix = match[2] ? match[2].toLowerCase() : '';
    return num + suffix; // "39", "5a", "5b"
}
/**
 * Extract numeric part only (for backward compat)
 */
export function extractNumericId(filename, prefix = 'T') {
    const match = filename.match(new RegExp(`^${prefix}0*(\\d+)`, 'i'));
    return match ? parseInt(match[1], 10) : null;
}
