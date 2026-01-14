/**
 * Lexicon - Centralized vocabulary for sailing project management
 * Status, effort, priority definitions and validation
 */

type EntityType = 'prd' | 'epic' | 'task';

// Entity types
export const ENTITY_TYPES: EntityType[] = ['prd', 'epic', 'task'];

// Canonical status values per entity type
export const STATUS: Record<EntityType, string[]> = {
  task: ['Not Started', 'In Progress', 'Blocked', 'Done', 'Cancelled'],
  epic: ['Not Started', 'In Progress', 'Auto-Done', 'Done'],
  prd: ['Draft', 'In Review', 'Approved', 'In Progress', 'Auto-Done', 'Done']
};

// Aliases mapping (lowercase, no spaces/dashes/underscores) → canonical
export const STATUS_ALIASES: Record<string, string> = {
  // Not Started
  notstarted: 'Not Started',
  todo: 'Not Started',
  pending: 'Not Started',
  new: 'Not Started',

  // In Progress
  inprogress: 'In Progress',
  wip: 'In Progress',
  started: 'In Progress',
  working: 'In Progress',

  // Blocked
  blocked: 'Blocked',
  stuck: 'Blocked',

  // Auto-Done (all children completed, awaiting validation)
  autodone: 'Auto-Done',
  'auto-done': 'Auto-Done',

  // Done
  done: 'Done',
  complete: 'Done',
  completed: 'Done',
  finished: 'Done',

  // Cancelled
  cancelled: 'Cancelled',
  canceled: 'Cancelled',
  cancel: 'Cancelled',
  dropped: 'Cancelled',
  abandoned: 'Cancelled',

  // PRD-specific
  draft: 'Draft',
  inreview: 'In Review',
  review: 'In Review',
  reviewing: 'In Review',
  approved: 'Approved'
};

// Legacy effort levels (T-shirt sizes) - kept for backward compatibility
export const LEGACY_EFFORT = ['S', 'M', 'L', 'XL'] as const;

// Duration pattern: number followed by 'h' (e.g., "4h", "0.5h", "16h")
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)\s*h$/i;

// Priority levels
export const PRIORITY = ['low', 'normal', 'high', 'critical'] as const;

/**
 * Normalize status input to canonical form
 * Returns null if invalid for the entity type
 */
export function normalizeStatus(input: string | null | undefined, entityType: EntityType = 'task'): string | null {
  if (!input) return null;

  // Normalize input: lowercase, remove spaces/dashes/underscores
  const key = input.toLowerCase().replace(/[\s_-]+/g, '');
  const canonical = STATUS_ALIASES[key];

  if (!canonical) return null;

  // Check if valid for entity type
  if (!STATUS[entityType]?.includes(canonical)) return null;

  return canonical;
}

/**
 * Get canonical status or return original if already valid
 * Used for reading existing files (lenient)
 */
export function getCanonicalStatus(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  const key = status.toLowerCase().replace(/[\s_-]+/g, '');
  return STATUS_ALIASES[key] || status;
}

/**
 * Check if a status matches a target (handles variations)
 */
export function statusEquals(status: string | null | undefined, target: string | null | undefined): boolean {
  const s1 = (status || '').toLowerCase().replace(/[\s_-]+/g, '');
  const t1 = (target || '').toLowerCase().replace(/[\s_-]+/g, '');
  return s1 === t1 || STATUS_ALIASES[s1] === STATUS_ALIASES[t1];
}

/**
 * Status check helpers
 */
export function isStatusDone(status: string | null | undefined): boolean {
  return statusEquals(status, 'done');
}

export function isStatusNotStarted(status: string | null | undefined): boolean {
  return statusEquals(status, 'notstarted');
}

export function isStatusInProgress(status: string | null | undefined): boolean {
  return statusEquals(status, 'inprogress');
}

export function isStatusCancelled(status: string | null | undefined): boolean {
  return statusEquals(status, 'cancelled');
}

export function isStatusBlocked(status: string | null | undefined): boolean {
  return statusEquals(status, 'blocked');
}

export function isStatusAutoDone(status: string | null | undefined): boolean {
  return statusEquals(status, 'autodone');
}

/**
 * Validate status and return error message if invalid
 */
export function validateStatus(status: string | null | undefined, entityType: EntityType): string | null {
  if (!status) return 'Status is missing';
  const canonical = normalizeStatus(status, entityType);
  if (!canonical) {
    return `Invalid status "${status}" for ${entityType}. Valid: ${STATUS[entityType].join(', ')}`;
  }
  return null; // Valid
}

/**
 * Validate effort/duration
 * Accepts: duration format (e.g., "4h", "0.5h") or legacy T-shirt sizes (S, M, L, XL)
 */
export function validateEffort(effort: string | null | undefined): string | null {
  if (!effort) return null; // Optional

  // Check if it's a valid duration format (e.g., "4h", "0.5h")
  if (DURATION_PATTERN.test(effort)) {
    return null; // Valid duration
  }

  // Check if it's a legacy T-shirt size
  const upper = effort.toUpperCase();
  if (LEGACY_EFFORT.includes(upper as (typeof LEGACY_EFFORT)[number])) {
    return null; // Valid legacy effort
  }

  return `Invalid effort "${effort}". Use duration (e.g., 4h, 8h) or legacy sizes: ${LEGACY_EFFORT.join(', ')}`;
}

/**
 * Get effort as raw string (for display)
 */
export function getEffort(effort: string | null | undefined): string | null {
  if (!effort) return null;
  return effort;
}

/**
 * Parse effort map from config string
 * Format: "S=2h,M=4h,L=8h,XL=16h"
 */
function parseEffortMap(mapStr: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const pair of mapStr.split(',')) {
    const [key, value] = pair.trim().split('=');
    if (key && value) {
      const match = value.match(/^(\d+(?:\.\d+)?)\s*h?$/i);
      if (match) {
        map[key.toUpperCase()] = parseFloat(match[1]);
      }
    }
  }
  return map;
}

/**
 * Get duration in hours from effort value
 * - If duration format (e.g., "4h"), parse and return hours
 * - If legacy T-shirt size, use effort_map from config
 * - Falls back to default_duration from config
 *
 * @param effort - The effort value from frontmatter
 * @param config - Optional config object { default_duration: '1h', effort_map: 'S=2h,...' }
 * @returns Duration in hours
 */
export function getDuration(
  effort: string | null | undefined,
  config?: { default_duration?: string; effort_map?: string }
): number {
  const defaultDuration = config?.default_duration || '1h';
  const effortMapStr = config?.effort_map || 'S=0.5h,M=1h,L=2h,XL=4h';

  // Parse default duration
  const defaultMatch = defaultDuration.match(/^(\d+(?:\.\d+)?)\s*h?$/i);
  const defaultHours = defaultMatch ? parseFloat(defaultMatch[1]) : 1;

  if (!effort) return defaultHours;

  // Check if it's a duration format (e.g., "4h", "0.5h")
  const durationMatch = effort.match(DURATION_PATTERN);
  if (durationMatch) {
    return parseFloat(durationMatch[1]);
  }

  // Check if it's a legacy T-shirt size
  const upper = effort.toUpperCase();
  if (LEGACY_EFFORT.includes(upper as (typeof LEGACY_EFFORT)[number])) {
    const effortMap = parseEffortMap(effortMapStr);
    return effortMap[upper] || defaultHours;
  }

  // Fallback to default
  return defaultHours;
}

/**
 * Validate priority level
 */
export function validatePriority(priority: string | null | undefined): string | null {
  if (!priority) return null; // Optional
  const lower = priority.toLowerCase();
  if (!PRIORITY.includes(lower as (typeof PRIORITY)[number])) {
    return `Invalid priority "${priority}". Valid: ${PRIORITY.join(', ')}`;
  }
  return null;
}

/**
 * Get status symbol for display
 */
export function statusSymbol(status: string | null | undefined): string {
  if (isStatusDone(status)) return '✓';
  if (isStatusAutoDone(status)) return '◉'; // Auto-Done: filled circle (awaiting validation)
  if (isStatusInProgress(status)) return '●';
  if (isStatusBlocked(status)) return '✗';
  if (isStatusCancelled(status)) return '○';
  return '◌';
}
