/**
 * Archive artefact operations
 *
 * Scans archived PRDs (under archive/prds/) for tasks, epics, and PRD files.
 * Same structure as active PRDs: PRD-NNN-name/prd.md, epics/, tasks/
 * Handles evolved ID formats (T001, T297, T00364, E000, E0097) transparently.
 */
import fs from 'fs';
import path from 'path';
import { getArchiveDir, loadFile, getFileTimestamps } from '../core-manager.js';
import { extractIdKey } from '../../lib/artefacts.js';
import { extractNumericKey } from '../../lib/normalize.js';
import type { ArchiveEntry } from '../../lib/types/entities.js';

// Archive has its own independent cache — not cleared by active artefact changes
let _archiveIndex: Map<string, ArchiveEntry> | null = null;

// ============================================================================
// SCANNING
// ============================================================================

/**
 * Find archived PRD directories under archive/prds/
 */
function findArchivePrdDirs(): string[] {
  const archiveDir = getArchiveDir();
  const prdsDir = path.join(archiveDir, 'prds');
  if (!fs.existsSync(prdsDir)) return [];
  return fs.readdirSync(prdsDir)
    .filter(d => d.startsWith('PRD-'))
    .map(d => path.join(prdsDir, d))
    .filter(d => fs.statSync(d).isDirectory());
}

/**
 * Extract PRD ID from archive directory name
 */
function archivePrdIdFromDir(prdDir: string): string {
  const dirname = path.basename(prdDir);
  const match = /^(PRD-\d+)/i.exec(dirname);
  return match ? match[1] : dirname;
}

/**
 * Scan a directory of artefact files and add entries to the index.
 */
function scanArtefactDir(
  dir: string,
  prefix: string,
  type: 'task' | 'epic',
  prdId: string,
  index: Map<string, ArchiveEntry>
): void {
  if (!fs.existsSync(dir)) return;

  const pattern = new RegExp(`^${prefix}\\d+.*\\.md$`, 'i');
  const idPattern = new RegExp(`^(${prefix}\\d+[a-z]?)`, 'i');
  const files = fs.readdirSync(dir).filter(f => pattern.test(f));

  for (const file of files) {
    const numKey = extractIdKey(file, prefix);
    if (numKey === null) continue;

    const filePath = path.join(dir, file);
    const idMatch = idPattern.exec(file);
    const id = idMatch ? idMatch[1] : `${prefix}${numKey}`;
    const loaded = loadFile<Record<string, unknown>>(filePath);
    const timestamps = getFileTimestamps(filePath);

    index.set(`${prefix}:${numKey}`, {
      key: numKey,
      id,
      type,
      title: (loaded?.data?.title as string) || '',
      status: (loaded?.data?.status as string) || '',
      parent: (loaded?.data?.parent as string) || prdId,
      prdId,
      file: filePath,
      createdAt: timestamps.createdAt,
      modifiedAt: timestamps.modifiedAt
    });
  }
}

/**
 * Scan a PRD directory's prd.md and add entry to the index.
 */
function scanPrdFile(prdDir: string, prdId: string, index: Map<string, ArchiveEntry>): void {
  const prdFile = path.join(prdDir, 'prd.md');
  if (!fs.existsSync(prdFile)) return;

  const loaded = loadFile<Record<string, unknown>>(prdFile);
  const timestamps = getFileTimestamps(prdFile);
  const prdNumMatch = /PRD-0*(\d+)/i.exec(prdId);
  const numKey = prdNumMatch ? prdNumMatch[1] : '0';

  index.set(`PRD:${numKey}`, {
    key: numKey,
    id: prdId,
    type: 'prd',
    title: (loaded?.data?.title as string) || '',
    status: (loaded?.data?.status as string) || '',
    parent: '',
    prdId,
    file: prdFile,
    createdAt: timestamps.createdAt,
    modifiedAt: timestamps.modifiedAt
  });
}

// ============================================================================
// INDEX
// ============================================================================

/**
 * Build archive index across all archived PRDs.
 * Single map keyed by "type:numericKey" (e.g., "T:364", "E:97", "PRD:13")
 * to avoid collisions between T001 and E001.
 */
export function buildArchiveIndex(): Map<string, ArchiveEntry> {
  if (_archiveIndex) return _archiveIndex;

  const index = new Map<string, ArchiveEntry>();

  for (const prdDir of findArchivePrdDirs()) {
    const prdId = archivePrdIdFromDir(prdDir);
    scanArtefactDir(path.join(prdDir, 'tasks'), 'T', 'task', prdId, index);
    scanArtefactDir(path.join(prdDir, 'epics'), 'E', 'epic', prdId, index);
    scanPrdFile(prdDir, prdId, index);
  }

  _archiveIndex = index;
  return index;
}

// ============================================================================
// GETTERS
// ============================================================================

/**
 * Get an archived artefact by ID (any format: T1, T001, T00364, E97, PRD-013)
 */
export function getArchivedArtefact(id: string): ArchiveEntry | null {
  const index = buildArchiveIndex();

  // Detect type prefix and extract numeric key
  const prdMatch = (/^PRD-?0*(\d+)$/i).exec(id);
  if (prdMatch) {
    return index.get(`PRD:${prdMatch[1]}`) || null;
  }

  const prefixMatch = (/^([TE])0*(\d+)([a-z])?$/i).exec(id);
  if (prefixMatch) {
    const prefix = prefixMatch[1].toUpperCase();
    const numKey = prefixMatch[2] + (prefixMatch[3] ? prefixMatch[3].toLowerCase() : '');
    return index.get(`${prefix}:${numKey}`) || null;
  }

  // Fallback: try extractNumericKey and search all types
  const numKey = extractNumericKey(id);
  if (numKey) {
    for (const prefix of ['T', 'E', 'PRD']) {
      const entry = index.get(`${prefix}:${numKey}`);
      if (entry) return entry;
    }
  }

  return null;
}

// ============================================================================
// QUERY
// ============================================================================

export interface ArchiveQueryOptions {
  prd?: string;
  status?: string;
}

/**
 * Get all archived tasks
 */
export function getAllArchivedTasks(options: ArchiveQueryOptions = {}): ArchiveEntry[] {
  return filterArchive('task', options);
}

/**
 * Get all archived epics
 */
export function getAllArchivedEpics(options: ArchiveQueryOptions = {}): ArchiveEntry[] {
  return filterArchive('epic', options);
}

/**
 * Get all archived PRDs
 */
export function getAllArchivedPrds(): ArchiveEntry[] {
  return filterArchive('prd', {});
}

function filterArchive(type: 'task' | 'epic' | 'prd', options: ArchiveQueryOptions): ArchiveEntry[] {
  const index = buildArchiveIndex();
  let entries = [...index.values()].filter(e => e.type === type);

  if (options.prd) {
    const prdNumMatch = (/PRD-?0*(\d+)/i).exec(options.prd);
    if (prdNumMatch) {
      const prdNum = prdNumMatch[1];
      entries = entries.filter(e => {
        const entryPrdNum = (/PRD-0*(\d+)/i).exec(e.prdId);
        return entryPrdNum && entryPrdNum[1] === prdNum;
      });
    }
  }

  if (options.status) {
    entries = entries.filter(e => e.status === options.status);
  }

  return entries;
}
