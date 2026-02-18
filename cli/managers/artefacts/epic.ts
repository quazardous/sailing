/**
 * Epic artefact operations
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, toKebab, loadTemplate, formatId, getFileTimestamps } from '../core-manager.js';
import { nextId } from '../state-manager.js';
import { createEpicMemoryFile } from '../memory-manager.js';
import { extractIdKey } from '../../lib/artefacts.js';
import { normalizeId } from '../../lib/normalize.js';
import { _epicIndex, setEpicIndex, clearCache } from './common.js';
import { getPrd, prdIdFromDir } from './prd.js';
import type { Epic, EpicIndexEntry } from '../../lib/types/entities.js';

// ============================================================================
// INDEX
// ============================================================================

/**
 * Build epic index across all PRDs
 */
export function buildEpicIndex(): Map<string, EpicIndexEntry> {
  if (_epicIndex) return _epicIndex;

  const index = new Map<string, EpicIndexEntry>();
  const duplicates: { key: string; existing: string; new: string }[] = [];

  for (const prdDir of findPrdDirs()) {
    const epicsDir = path.join(prdDir, 'epics');
    if (!fs.existsSync(epicsDir)) continue;

    const files = fs.readdirSync(epicsDir).filter(f => /^E\d+[a-z]?.*\.md$/i.test(f));

    for (const file of files) {
      const key = extractIdKey(file, 'E');
      if (key === null) continue;

      const filePath = path.join(epicsDir, file);
      const idMatch = file.match(/^(E\d+[a-z]?)/i);
      const id = idMatch ? idMatch[1] : `E${key}`;

      const loaded = loadFile<Epic>(filePath);
      const status = loaded?.data?.status;

      if (index.has(key)) {
        const existingEntry = index.get(key);
        const existingStatus = existingEntry!.data?.status;
        if (status !== 'Done' || existingStatus !== 'Done') {
          duplicates.push({ key, existing: existingEntry!.file, new: filePath });
        }
      }

      const timestamps = getFileTimestamps(filePath);
      index.set(key, {
        key,
        id,
        file: filePath,
        prdId: prdIdFromDir(prdDir),
        prdDir,
        data: loaded?.data || {},
        createdAt: timestamps.createdAt,
        modifiedAt: timestamps.modifiedAt
      });
    }
  }

  if (duplicates.length > 0) {
    console.error(`⚠ Duplicate epic IDs found:`);
    for (const d of duplicates) {
      console.error(`  E${d.key}: ${d.existing} vs ${d.new}`);
    }
  }

  setEpicIndex(index);
  return index;
}

// ============================================================================
// GETTERS
// ============================================================================

/**
 * Get epic by ID (any format: 14, "14", "E14", "E014", "E0014")
 */
export function getEpic(epicId: string | number): EpicIndexEntry | null {
  const index = buildEpicIndex();

  let key: string | null;
  if (typeof epicId === 'number') {
    key = String(epicId);
  } else {
    const match = String(epicId).match(/^E?0*(\d+)([a-z])?$/i);
    if (match) {
      key = match[1] + (match[2] ? match[2].toLowerCase() : '');
    } else {
      key = null;
    }
  }

  if (key === null) return null;
  return index.get(key) || null;
}

// ============================================================================
// QUERY
// ============================================================================

export interface EpicQueryOptions {
  prdDir?: string;
  status?: string | string[];
  milestone?: string;
  tags?: string[];
}

/**
 * Get all epics matching optional filters
 */
export function getAllEpics(options: EpicQueryOptions = {}): EpicIndexEntry[] {
  const index = buildEpicIndex();
  let epics = [...index.values()];

  if (options.prdDir) {
    epics = epics.filter(e => e.prdDir === options.prdDir);
  }

  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    epics = epics.filter(e => statuses.includes(e.data?.status));
  }

  if (options.milestone) {
    epics = epics.filter(e => e.data?.milestone === options.milestone);
  }

  if (options.tags && options.tags.length > 0) {
    epics = epics.filter(e => {
      const epicTags = e.data?.tags || [];
      return options.tags!.some(t => epicTags.includes(t));
    });
  }

  return epics;
}

/**
 * Get all epics for a specific PRD
 */
export function getEpicsForPrd(prdId: string | number): EpicIndexEntry[] {
  const prd = getPrd(prdId);
  if (!prd) return [];
  return getAllEpics({ prdDir: prd.dir });
}

/**
 * Get parent PRD for an epic
 */
export function getEpicPrd(epicId: string | number) {
  const epic = getEpic(epicId);
  if (!epic) return null;

  const dirname = path.basename(epic.prdDir);
  const match = dirname.match(/^PRD-0*(\d+)/i);
  if (!match) return null;

  const prdNum = parseInt(match[1], 10);
  const prd = getPrd(prdNum);

  return {
    prdId: prd?.id || `PRD-${prdNum}`,
    prdNum
  };
}

export function countEpics(options: EpicQueryOptions = {}): number {
  return getAllEpics(options).length;
}

// ============================================================================
// CREATE
// ============================================================================

export interface CreateEpicOptions {
  tags?: string[];
  created_at?: string;
}

export interface CreateEpicResult {
  id: string;
  title: string;
  parent: string;
  file: string;
}

/**
 * Create a new epic under a PRD
 */
export function createEpic(prdId: string, title: string, options: CreateEpicOptions = {}): CreateEpicResult {
  const prd = getPrd(prdId);
  if (!prd) {
    throw new Error(`PRD not found: ${prdId}`);
  }

  const epicsDir = path.join(prd.dir, 'epics');
  if (!fs.existsSync(epicsDir)) {
    fs.mkdirSync(epicsDir, { recursive: true });
  }

  const num = nextId('epic');
  const id = formatId('E', num);
  const filename = `${id}-${toKebab(title)}.md`;
  const epicPath = path.join(epicsDir, filename);

  const now = options.created_at || new Date().toISOString();
  const data: Epic = {
    id,
    title,
    status: 'Draft',
    parent: prd.id,
    tags: options.tags?.map(t => toKebab(t)) || [],
    created_at: now,
    updated_at: now
  };

  let body = loadTemplate('epic');
  if (body) {
    body = body.replace(/^---[\s\S]*?---\s*/, '');
  } else {
    body = `\n## Summary\n\n[Add summary]\n\n## Acceptance Criteria\n\n- [ ] [Criterion 1]\n\n## Technical Notes\n\n[Add notes]\n`;
  }

  saveFile(epicPath, data, body);
  createEpicMemoryFile(id);
  clearCache();

  return { id, title, parent: prd.id, file: epicPath };
}
