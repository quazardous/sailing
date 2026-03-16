/**
 * ID normalization and extraction utilities
 * Handles flexible ID formats: T1, T01, T00001, E1, E0001, S1, S0001, PRD-1, PRD-001
 *
 * Canonical format uses configured digits (default: 3)
 *
 * Pure string operations only - no I/O, no config.
 */
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface DigitConfig {
  prd: number;
  epic: number;
  task: number;
  story: number;
  panic: number;
}

// Default digit configuration
const DEFAULT_DIGITS: DigitConfig = {
  prd: 3,
  epic: 3,
  task: 3,
  story: 3,
  panic: 3
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
export function formatIdWith(prefix: string, num: number, digits: number): string {
  return `${prefix}${String(num).padStart(digits, '0')}`;
}

/**
 * Format ID using digit config (pure function)
 */
export function formatIdFrom(prefix: string, num: number, config: DigitConfig = DEFAULT_DIGITS): string {
  const digitMap: Record<string, number> = {
    'PRD-': config.prd,
    'E': config.epic,
    'T': config.task,
    'S': config.story,
    'P': config.panic
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
export function extractPrdId(parent: string | null | undefined): string | null {
  if (!parent) return null;
  const match = /PRD-\d+/.exec(parent);
  return match ? match[0] : null;
}

/**
 * Extract Epic ID from parent field or string
 * @param parent - Parent field (e.g., "PRD-001 / E002") or any string containing Epic ID
 * @returns Epic ID or null
 */
export function extractEpicId(parent: string | null | undefined): string | null {
  if (!parent) return null;
  const match = /E(\d+)/.exec(parent);
  return match ? formatIdFrom('E', parseInt(match[1], 10)) : null;
}

// ============================================================================
// ID Normalization
// ============================================================================

export type EntityType = 'prd' | 'epic' | 'task' | 'story' | 'panic';

/**
 * Normalize entity IDs to canonical format (pure function)
 * Accepts any number of digits, outputs configured padding
 * @param id - ID to normalize
 * @param digitConfig - Optional digit configuration (defaults to 3 digits each)
 * @param defaultType - Optional default type for numeric-only input (e.g., "1" → "T001" if defaultType is 'task')
 */
export function normalizeId(id: string | null | undefined, digitConfig: DigitConfig = DEFAULT_DIGITS, defaultType?: EntityType): string | null {
  if (!id) return id ?? null;

  // PRD format
  const prdMatch = /^PRD-?(\d+)$/i.exec(id);
  if (prdMatch) {
    return formatIdFrom('PRD-', parseInt(prdMatch[1], 10), digitConfig);
  }

  // Epic format
  const epicMatch = /^E(\d+)$/i.exec(id);
  if (epicMatch) {
    return formatIdFrom('E', parseInt(epicMatch[1], 10), digitConfig);
  }

  // Task format
  const taskMatch = /^T(\d+)$/i.exec(id);
  if (taskMatch) {
    return formatIdFrom('T', parseInt(taskMatch[1], 10), digitConfig);
  }

  // Story format
  const storyMatch = /^S(\d+)$/i.exec(id);
  if (storyMatch) {
    return formatIdFrom('S', parseInt(storyMatch[1], 10), digitConfig);
  }

  // Panic format (must be before numeric-only, after PRD check since PRD uses 3+ chars)
  const panicMatch = /^P(\d+)$/i.exec(id);
  if (panicMatch) {
    return formatIdFrom('P', parseInt(panicMatch[1], 10), digitConfig);
  }

  // Numeric-only format with defaultType
  const numericMatch = /^(\d+)$/.exec(id);
  if (numericMatch && defaultType) {
    const prefixMap: Record<EntityType, string> = {
      'prd': 'PRD-',
      'epic': 'E',
      'task': 'T',
      'story': 'S',
      'panic': 'P'
    };
    return formatIdFrom(prefixMap[defaultType], parseInt(numericMatch[1], 10), digitConfig);
  }

  return id;
}

/**
 * Compare two IDs, ignoring padding differences.
 *
 * Rules:
 * - Same prefix: compare numbers → isSameId("E107", "E0107") = true
 * - Different prefixes: false → isSameId("E001", "T001") = false
 * - Raw number + prefixed: optimistic → isSameId("107", "E107") = true
 * - Both raw numbers: optimistic → isSameId("1", "001") = true
 * - type hint: forces prefix for raw numbers → isSameId("107", "E0107", "epic") = true
 */
export function isSameId(
  a: string | null | undefined,
  b: string | null | undefined,
  type?: EntityType
): boolean {
  if (!a || !b) return false;

  // Extract prefix and numeric part
  const parse = (s: string): { prefix: string | null; num: number } | null => {
    const prd = /^PRD-?(\d+)$/i.exec(s);
    if (prd) return { prefix: 'PRD', num: parseInt(prd[1], 10) };
    const prefixed = /^([ETSPRD]+)(\d+)$/i.exec(s);
    if (prefixed) return { prefix: prefixed[1].toUpperCase(), num: parseInt(prefixed[2], 10) };
    const raw = /^(\d+)$/.exec(s);
    if (raw) return { prefix: null, num: parseInt(raw[1], 10) };
    return null;
  };

  const pa = parse(a.trim());
  const pb = parse(b.trim());
  if (!pa || !pb) return false;

  // Apply type hint to raw numbers
  if (type) {
    const prefixMap: Record<EntityType, string> = { prd: 'PRD', epic: 'E', task: 'T', story: 'S', panic: 'P' };
    if (!pa.prefix) pa.prefix = prefixMap[type];
    if (!pb.prefix) pb.prefix = prefixMap[type];
  }

  // Both have prefixes: must match
  if (pa.prefix && pb.prefix) {
    return pa.prefix === pb.prefix && pa.num === pb.num;
  }

  // One or both raw: optimistic, compare numbers only
  return pa.num === pb.num;
}

/**
 * Check if a filename matches a normalized ID
 * e.g., matchesId("T002-some-task.md", "T2") => true
 */
export function matchesId(filename: string, rawId: string, digitConfig: DigitConfig = DEFAULT_DIGITS): boolean {
  const normalizedInput = normalizeId(rawId, digitConfig);
  if (!normalizedInput) return false;
  const basename = path.basename(filename, '.md');
  // Extract ID from filename (e.g., "T002" from "T002-some-task")
  const filenameIdMatch = /^(T\d+|E\d+|S\d+|P\d+|PRD-\d+)/i.exec(basename);
  if (!filenameIdMatch) return false;
  const normalizedFilename = normalizeId(filenameIdMatch[1], digitConfig);
  return normalizedFilename === normalizedInput;
}

/**
 * Check if a PRD ID matches a filter (flexible matching)
 * e.g., matchesPrd("PRD-001", "PRD-1") => true
 * e.g., matchesPrd("PRD-001", "1") => true
 */
export function matchesPrd(prdId: string, filter: string, digitConfig: DigitConfig = DEFAULT_DIGITS): boolean {
  // Try normalized PRD ID match (PRD-1 → PRD-001)
  const filterMatch = /^PRD-?(\d+)/i.exec(filter);
  if (filterMatch) {
    return normalizeId(prdId, digitConfig) === normalizeId(filter, digitConfig);
  }

  // Try numeric-only match (e.g., "1" matches "PRD-001")
  const numericMatch = /^(\d+)$/.exec(filter);
  if (numericMatch) {
    const prdNum = /PRD-0*(\d+)/i.exec(prdId);
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
export function matchesPrdDir(dirname: string, rawId: string, digitConfig: DigitConfig = DEFAULT_DIGITS): boolean {
  const basename = path.basename(dirname);

  // Try normalized PRD ID match first (PRD-1 → PRD-001)
  const inputIdMatch = /^PRD-?(\d+)/i.exec(rawId);
  if (inputIdMatch) {
    const dirIdMatch = /^(PRD-\d+)/i.exec(basename);
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
export function extractTaskId(blockerEntry: string, digitConfig: DigitConfig = DEFAULT_DIGITS): string | null {
  const match = /^(T\d+)/i.exec(blockerEntry);
  return match ? normalizeId(match[1], digitConfig) : null;
}

/**
 * Determine entity type from ID
 */
export function getEntityType(id: string | null | undefined): 'prd' | 'epic' | 'task' | 'story' | 'panic' | null {
  if (!id) return null;
  if (/^PRD-?\d+$/i.exec(id)) return 'prd';
  if (/^E\d+$/i.exec(id)) return 'epic';
  if (/^T\d+$/i.exec(id)) return 'task';
  if (/^S\d+$/i.exec(id)) return 'story';
  if (/^P\d+$/i.exec(id)) return 'panic';
  return null;
}

/**
 * Extract numeric key from ID (format-agnostic)
 * E001 → 1, E0001 → 1, E14 → 14, E005a → "5a"
 */
export function extractNumericKey(id: string | null | undefined): string | null {
  if (!id) return null;
  const match = /^[A-Z]+-?0*(\d+)([a-z])?/i.exec(id);
  if (!match) return null;
  return match[1] + (match[2] ? match[2].toLowerCase() : '');
}

// ============================================================================
// ID Resolution (format-agnostic comparison)
// ============================================================================

/**
 * Extract prefix-aware comparison key from an entity ID.
 * T001, T0001, T1 all produce "T:1". E097, E0097 produce "E:97".
 * Handles "T002 (description)" format by extracting the ID part.
 */
function idKey(id: string): string | null {
  // Strip trailing descriptions: "T002 (some note)" → "T002"
  const clean = /^([A-Z]+-?\d+)/i.exec(id)?.[1] || id;

  const prdMatch = /^PRD-?0*(\d+)$/i.exec(clean);
  if (prdMatch) return `PRD:${prdMatch[1]}`;

  const match = /^([TESP])0*(\d+)([a-z])?$/i.exec(clean);
  if (match) return `${match[1].toUpperCase()}:${match[2]}${match[3]?.toLowerCase() || ''}`;

  return null;
}

/**
 * Build a resolver that maps any ID format variant to the canonical form found in knownIds.
 * T1, T01, T001, T0001 all resolve to whichever form is in knownIds.
 * Prefix-aware: T001 and E001 are distinct.
 *
 * Pure function — no config dependency, works in lib layer.
 *
 * @example
 *   const resolve = buildIdResolver(['T00457', 'T00458', 'E0097']);
 *   resolve('T457')   // → 'T00457'
 *   resolve('T00457') // → 'T00457'
 *   resolve('E97')    // → 'E0097'
 *   resolve('T999')   // → null (not in known set)
 */
export function buildIdResolver(knownIds: Iterable<string>): (rawId: string) => string | null {
  const keyMap = new Map<string, string>();
  for (const id of knownIds) {
    const k = idKey(id);
    if (k) keyMap.set(k, id);
  }
  return (rawId: string): string | null => {
    const k = idKey(rawId);
    return k ? (keyMap.get(k) ?? null) : null;
  };
}

