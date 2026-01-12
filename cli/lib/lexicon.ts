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
  epic: ['Not Started', 'In Progress', 'Done'],
  prd: ['Draft', 'In Review', 'Approved', 'In Progress', 'Done']
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

// Effort levels
export const EFFORT = ['S', 'M', 'L', 'XL'] as const;

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
 * Validate effort level
 */
export function validateEffort(effort: string | null | undefined): string | null {
  if (!effort) return null; // Optional
  const upper = effort.toUpperCase();
  if (!EFFORT.includes(upper as (typeof EFFORT)[number])) {
    return `Invalid effort "${effort}". Valid: ${EFFORT.join(', ')}`;
  }
  return null;
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
  if (isStatusInProgress(status)) return '●';
  if (isStatusBlocked(status)) return '✗';
  if (isStatusCancelled(status)) return '○';
  return '◌';
}
