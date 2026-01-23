/**
 * Memory Operations - High-level memory operations shared by CLI and MCP
 */
import {
  getHierarchicalMemory,
  extractAllSections,
  readLogFile,
  editMemorySection,
  flushEpicLogs as managerFlushEpicLogs,
  checkPendingMemory,
  getLogStats
} from '../managers/memory-manager.js';
import type { MemoryLevel, MemorySectionName } from '../managers/memory-manager.js';
import { normalizeId } from '../lib/normalize.js';

// Re-export types from manager
export type { MemoryLevel, MemorySectionName };

// ============================================================================
// SHOW MEMORY
// ============================================================================

export interface ShowMemoryOptions {
  full?: boolean;
  level?: 'project' | 'prd' | 'epic';
  section?: string;
  epicOnly?: boolean;
}

export interface MemorySection {
  level: string;
  id: string;
  section: string;
  content: string;
}

export interface ShowMemoryResult {
  id: string;
  exists: boolean;
  sections: MemorySection[];
}

/**
 * Show hierarchical memory for an entity (project → PRD → epic)
 */
export function showMemory(id: string, options: ShowMemoryOptions = {}): ShowMemoryResult {
  const normalized = normalizeId(id);
  const hierarchy = getHierarchicalMemory(normalized);

  if (!hierarchy.epic && !hierarchy.prd && !hierarchy.project) {
    return { id: normalized, exists: false, sections: [] };
  }

  const sections: MemorySection[] = [];
  const levelFilter = options.level?.toLowerCase();
  const sectionFilter = options.section?.toLowerCase();

  // Agent-relevant sections (default view)
  const agentRelevantSections = [
    'Agent Context', 'Escalation', 'Cross-Epic Patterns',
    'Architecture Decisions', 'Patterns & Conventions'
  ];

  // Project level
  if (hierarchy.project && !options.epicOnly && (!levelFilter || levelFilter === 'project')) {
    const secs = extractAllSections(hierarchy.project.content);
    for (const sec of secs) {
      if (sectionFilter && !sec.name.toLowerCase().includes(sectionFilter)) continue;
      if (!options.full && !agentRelevantSections.includes(sec.name)) continue;
      sections.push({ level: 'PROJECT', id: 'PROJECT', section: sec.name, content: sec.content });
    }
  }

  // PRD level
  if (hierarchy.prd && !options.epicOnly && (!levelFilter || levelFilter === 'prd')) {
    const secs = extractAllSections(hierarchy.prd.content);
    for (const sec of secs) {
      if (sectionFilter && !sec.name.toLowerCase().includes(sectionFilter)) continue;
      if (!options.full && !agentRelevantSections.includes(sec.name)) continue;
      sections.push({ level: 'PRD', id: hierarchy.prd.id, section: sec.name, content: sec.content });
    }
  }

  // Epic level
  if (hierarchy.epic && (!levelFilter || levelFilter === 'epic')) {
    const secs = extractAllSections(hierarchy.epic.content);
    for (const sec of secs) {
      if (sectionFilter && !sec.name.toLowerCase().includes(sectionFilter)) continue;
      if (!options.full && !agentRelevantSections.includes(sec.name)) continue;
      sections.push({ level: 'EPIC', id: hierarchy.epic.id, section: sec.name, content: sec.content });
    }
  }

  return { id: normalized, exists: true, sections };
}

// ============================================================================
// GET EPIC PENDING LOGS (for AI consolidation)
// ============================================================================

export interface EpicLogEntry {
  timestamp: string;
  taskId: string | null;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface EpicPendingLogsResult {
  epicId: string;
  hasLogs: boolean;
  entries: EpicLogEntry[];
  rawContent: string | null;
}

/**
 * Get pending logs for an epic (after memory:sync merged task logs)
 * Returns structured log entries for AI review and consolidation
 */
export function getEpicPendingLogs(epicId: string): EpicPendingLogsResult {
  const normalized = normalizeId(epicId);
  const content = readLogFile(normalized);

  if (!content) {
    return { epicId: normalized, hasLogs: false, entries: [], rawContent: null };
  }

  const entries: EpicLogEntry[] = [];
  const lines = content.split('\n').filter(l => l.trim());

  for (const line of lines) {
    // Format: 2024-01-15T10:30:00.000Z [T001] [INFO] message {{meta}}
    // Or: 2024-01-15T10:30:00.000Z [INFO] message {{meta}}
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(?:\[([T]\d+)\]\s+)?\[(\w+)\]\s+(.+)$/);
    if (match) {
      const [, timestamp, taskId, level, rest] = match;

      // Extract meta if present
      const metaMatch = rest.match(/^(.+?)\s*\{\{(.+)\}\}$/);
      let message = rest;
      let meta: Record<string, unknown> | undefined;

      if (metaMatch) {
        message = metaMatch[1].trim();
        try {
          meta = JSON.parse(metaMatch[2]);
        } catch { /* ignore */ }
      }

      entries.push({
        timestamp,
        taskId: taskId || null,
        level,
        message,
        meta
      });
    }
  }

  return { epicId: normalized, hasLogs: true, entries, rawContent: content };
}

// ============================================================================
// CONSOLIDATE TO MEMORY (AI writes synthesized content)
// ============================================================================

export interface ConsolidateMemoryOptions {
  operation?: 'append' | 'prepend' | 'replace';
}

export interface ConsolidateMemoryResult {
  level: MemoryLevel;
  targetId: string;
  section: string;
  success: boolean;
  message: string;
}

/**
 * Consolidate content into a memory section (epic, prd, or project)
 * Used by AI to synthesize logs into structured memory
 */
export function consolidateMemory(
  level: MemoryLevel,
  targetId: string,
  section: MemorySectionName,
  content: string,
  options: ConsolidateMemoryOptions = {}
): ConsolidateMemoryResult {
  const operation = options.operation || 'append';
  const normalized = normalizeId(targetId);

  const result = editMemorySection(level, normalized, section, content, operation);

  return {
    level,
    targetId: normalized,
    section,
    success: result.success,
    message: result.message
  };
}

// ============================================================================
// FLUSH EPIC LOGS (after AI consolidation)
// ============================================================================

export interface FlushEpicLogsResult {
  epicId: string;
  flushed: boolean;
  entriesCleared: number;
}

/**
 * Flush/clear epic logs after AI has consolidated them into memory
 */
export function flushEpicLogs(epicId: string): FlushEpicLogsResult {
  return managerFlushEpicLogs(epicId);
}

// ============================================================================
// SYNC MEMORY (merge task→epic logs, check pending)
// ============================================================================

export interface SyncMemoryOptions {
  scope?: string;  // Epic ID (E001) or Task ID (T001) to filter
}

export interface EpicLogStats {
  id: string;
  entries: number;
  levels: { TIP: number; INFO: number; WARN: number; ERROR: number; CRITICAL: number };
}

export interface SyncMemoryResult {
  pending: boolean;
  tasksMerged: number;
  logs: EpicLogStats[];
}

/**
 * Sync memory: merge task→epic logs, return pending epic logs
 * This is a simplified version of memory:sync for MCP usage
 */
export function syncMemory(options: SyncMemoryOptions = {}): SyncMemoryResult {
  const scopeId = options.scope ? normalizeId(options.scope) : null;

  // Determine epic filter from scope
  let epicFilter: string | null = null;
  if (scopeId) {
    if (scopeId.startsWith('E')) {
      epicFilter = scopeId;
    }
    // Note: For task scope, checkPendingMemory doesn't filter by task
    // The full memory:sync command handles that case
  }

  // Merge task logs and get pending epics
  const { pending, epics, tasksMerged } = checkPendingMemory(epicFilter);

  // Get stats for each pending epic
  const logs: EpicLogStats[] = [];
  for (const epicId of epics) {
    const stats = getLogStats(epicId);
    if (stats.exists) {
      logs.push({
        id: epicId,
        entries: stats.lines,
        levels: stats.levels
      });
    }
  }

  return {
    pending,
    tasksMerged,
    logs
  };
}

// ============================================================================
// LOG TO TASK (re-export from task-ops for convenience)
// ============================================================================

export { logTask } from './task-ops.js';
