/**
 * Deps command helpers
 *
 * Shared types and utility functions for deps subcommands.
 */
import { normalizeId } from '../../lib/normalize.js';
import { getAllEpics } from '../../managers/artefacts-manager.js';

// ============================================================================
// Types
// ============================================================================

export interface EpicDependency {
  id: string;
  file: string;
  status: string;
  blockedBy: string[];
  prdId: string;
}

export interface TaskFrontmatter {
  id?: string;
  status?: string;
  blocked_by?: string[];
  [key: string]: unknown;
}

export interface TreeOptions {
  ancestors?: boolean;
  descendants?: boolean;
  depth?: number;
  tag?: string[];
  ready?: boolean;
  json?: boolean;
}

export interface ValidateOptions {
  prd?: string;
  fix?: boolean;
  json?: boolean;
}

export interface ValidationError {
  type: string;
  task?: string;
  epic?: string;
  blocker?: string;
  path?: string[];
  message: string;
}

export interface Fix {
  task?: string;
  epic?: string;
  file: string;
  action: string;
  blockerId?: string;
  raw?: string;
  normalized?: string;
  oldStatus?: string;
  newStatus?: string;
  oldName?: string;
  newName?: string;
}

export interface ImpactOptions {
  json?: boolean;
}

export interface ReadyOptions {
  role?: string;
  prd?: string;
  epic?: string;
  tag?: string[];
  limit?: number;
  includeStarted?: boolean;
  json?: boolean;
}

export interface CriticalOptions {
  prd?: string;
  limit?: number;
}

export interface AddOptions {
  blocks?: string[];
  blockedBy?: string[];
}

export interface ShowOptions {
  role?: string;
  json?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if ID is an epic (ENNN) vs task (TNNN)
 */
export function isEpicId(id: string): boolean {
  return /^E\d+$/i.test(id);
}

/**
 * Build epic dependency map
 */
export function buildEpicDependencyMap(): Map<string, EpicDependency> {
  const epics = new Map<string, EpicDependency>();

  for (const epicEntry of getAllEpics()) {
    const data = epicEntry.data;
    if (!data?.id) continue;

    const id = normalizeId(data.id);
    const blockedBy = (data.blocked_by || []).map(b => normalizeId(b));

    epics.set(id, {
      id,
      file: epicEntry.file,
      status: data.status || 'Not Started',
      blockedBy,
      prdId: epicEntry.prdId
    });
  }

  return epics;
}

/**
 * Detect cycles in epic dependencies
 */
export function detectEpicCycles(epics: Map<string, EpicDependency>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const recStack = new Set<string>();

  const dfs = (id: string, path: string[]): void => {
    if (recStack.has(id)) {
      const cycleStart = path.indexOf(id);
      cycles.push(path.slice(cycleStart).concat(id));
      return;
    }
    if (visited.has(id)) return;

    visited.add(id);
    recStack.add(id);
    path.push(id);

    const epic = epics.get(id);
    if (epic) {
      for (const blockerId of epic.blockedBy) {
        dfs(blockerId, [...path]);
      }
    }

    recStack.delete(id);
  };

  for (const id of epics.keys()) {
    if (!visited.has(id)) {
      dfs(id, []);
    }
  }

  return cycles;
}
