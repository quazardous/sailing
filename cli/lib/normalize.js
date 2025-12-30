/**
 * ID normalization utilities
 * Handles flexible ID formats: T1, T01, T001, E1, E001, PRD-1, PRD-001
 */
import path from 'path';

/**
 * Normalize entity IDs to canonical format (E001, T001, PRD-001)
 * Accepts: E1, E01, E001, E0001, T2, T02, T002, PRD-1, PRD-001, etc.
 */
export function normalizeId(id) {
  if (!id) return id;

  // PRD format: PRD-NNN
  const prdMatch = id.match(/^PRD-?(\d+)$/i);
  if (prdMatch) {
    return `PRD-${String(parseInt(prdMatch[1], 10)).padStart(3, '0')}`;
  }

  // Epic format: ENNN
  const epicMatch = id.match(/^E(\d+)$/i);
  if (epicMatch) {
    return `E${String(parseInt(epicMatch[1], 10)).padStart(3, '0')}`;
  }

  // Task format: TNNN
  const taskMatch = id.match(/^T(\d+)$/i);
  if (taskMatch) {
    return `T${String(parseInt(taskMatch[1], 10)).padStart(3, '0')}`;
  }

  return id;
}

/**
 * Check if a filename matches a normalized ID
 * e.g., matchesId("T002-some-task.md", "T2") => true
 */
export function matchesId(filename, rawId) {
  const normalizedInput = normalizeId(rawId);
  const basename = path.basename(filename, '.md');
  // Extract ID from filename (e.g., "T002" from "T002-some-task")
  const filenameIdMatch = basename.match(/^(T\d+|E\d+|PRD-\d+)/i);
  if (!filenameIdMatch) return false;
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
  if (!id) return null;
  if (id.match(/^PRD-?\d+$/i)) return 'prd';
  if (id.match(/^E\d+$/i)) return 'epic';
  if (id.match(/^T\d+$/i)) return 'task';
  return null;
}
