/**
 * Panic artefact operations
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, toKebab, loadTemplate, formatId, getFileTimestamps } from '../core-manager.js';
import { nextId } from '../state-manager.js';
import { extractIdKey } from '../../lib/artefacts.js';
import { normalizeId } from '../../lib/normalize.js';
import { _panicIndex, setPanicIndex, clearCache } from './common.js';
import { getPrd, prdIdFromDir } from './prd.js';
import { getEpic } from './epic.js';
import { getTask } from './task.js';
import { getStory } from './story.js';
import { getEntityType, extractPrdId } from '../../lib/normalize.js';
import type { Panic, PanicIndexEntry } from '../../lib/types/entities.js';

// ============================================================================
// INDEX
// ============================================================================

/**
 * Build panic index across all PRDs
 */
export function buildPanicIndex(): Map<string, PanicIndexEntry> {
  if (_panicIndex) return _panicIndex;

  const index = new Map<string, PanicIndexEntry>();
  const duplicates: { key: string; existing: string; new: string }[] = [];

  for (const prdDir of findPrdDirs()) {
    const panicsDir = path.join(prdDir, 'panics');
    if (!fs.existsSync(panicsDir)) continue;

    const files = fs.readdirSync(panicsDir).filter(f => /^P\d+.*\.md$/i.test(f));

    for (const file of files) {
      const key = extractIdKey(file, 'P');
      if (key === null) continue;

      const filePath = path.join(panicsDir, file);
      const idMatch = /^(P\d+)/i.exec(file);
      const id = idMatch ? idMatch[1] : `P${key}`;

      const loaded = loadFile<Panic>(filePath);

      if (index.has(key)) {
        duplicates.push({ key, existing: index.get(key)!.file, new: filePath });
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
    console.error(`⚠ Duplicate panic IDs found:`);
    for (const d of duplicates) {
      console.error(`  P${d.key}: ${d.existing} vs ${d.new}`);
    }
  }

  setPanicIndex(index);
  return index;
}

// ============================================================================
// GETTERS
// ============================================================================

/**
 * Get panic by ID (any format: 1, "1", "P1", "P001", "P0001")
 */
export function getPanic(panicId: string | number): PanicIndexEntry | null {
  const index = buildPanicIndex();

  let key: string | null;
  if (typeof panicId === 'number') {
    key = String(panicId);
  } else {
    const match = /^P?0*(\d+)$/i.exec(String(panicId));
    if (match) {
      key = match[1];
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

export interface PanicQueryOptions {
  prdDir?: string;
  scope?: string;
  source?: 'agent' | 'framework';
  status?: string;
}

/**
 * Get all panics matching optional filters
 */
export function getAllPanics(options: PanicQueryOptions = {}): PanicIndexEntry[] {
  const index = buildPanicIndex();
  let panics = [...index.values()];

  if (options.prdDir) {
    panics = panics.filter(p => p.prdDir === options.prdDir);
  }

  if (options.scope) {
    const normScope = normalizeId(options.scope);
    panics = panics.filter(p => {
      const pScope = normalizeId(p.data?.scope || '');
      return pScope === normScope;
    });
  }

  if (options.source) {
    panics = panics.filter(p => p.data?.source === options.source);
  }

  if (options.status) {
    panics = panics.filter(p => p.data?.status === options.status);
  }

  return panics;
}

/**
 * Get panics for a specific scope (artefact ID)
 */
export function getPanicsForScope(scopeId: string): PanicIndexEntry[] {
  return getAllPanics({ scope: scopeId });
}

/**
 * Count non-resolved panics
 */
export function countOpenPanics(options: PanicQueryOptions = {}): number {
  return getAllPanics(options).filter(p => p.data?.status !== 'Resolved').length;
}

// ============================================================================
// CREATE
// ============================================================================

export interface CreatePanicOptions {
  source?: 'agent' | 'framework';
  severity?: 'critical' | 'high';
  tags?: string[];
  created_at?: string;
}

export interface CreatePanicResult {
  id: string;
  title: string;
  scope: string;
  parent: string;
  file: string;
}

/**
 * Resolve scope ID to its parent PRD directory
 */
function resolveScopePrdDir(scopeId: string): { prdId: string; prdDir: string } | null {
  const normScope = normalizeId(scopeId);
  if (!normScope) return null;

  const type = getEntityType(normScope);

  if (type === 'prd') {
    const prd = getPrd(normScope);
    if (prd) return { prdId: prd.id, prdDir: prd.dir };
  } else if (type === 'epic') {
    const epic = getEpic(normScope);
    if (epic) return { prdId: epic.prdId, prdDir: epic.prdDir };
  } else if (type === 'task') {
    const task = getTask(normScope);
    if (task) return { prdId: task.prdId, prdDir: task.prdDir };
  } else if (type === 'story') {
    const story = getStory(normScope);
    if (story) return { prdId: story.prdId, prdDir: story.prdDir };
  }

  return null;
}

/**
 * Create a new panic for a scoped artefact
 */
export function createPanic(scopeId: string, title: string, options: CreatePanicOptions = {}): CreatePanicResult {
  const scopeInfo = resolveScopePrdDir(scopeId);
  if (!scopeInfo) {
    throw new Error(`Cannot resolve scope to a PRD: ${scopeId}`);
  }

  const panicsDir = path.join(scopeInfo.prdDir, 'panics');
  if (!fs.existsSync(panicsDir)) {
    fs.mkdirSync(panicsDir, { recursive: true });
  }

  const num = nextId('panic');
  const id = formatId('P', num);
  const normScope = normalizeId(scopeId) || scopeId;
  const filename = `${id}-${toKebab(title)}.md`;
  const panicPath = path.join(panicsDir, filename);

  const now = options.created_at || new Date().toISOString();
  const data: Panic = {
    id,
    title,
    status: 'Open',
    scope: normScope,
    source: options.source || 'agent',
    parent: scopeInfo.prdId,
    tags: options.tags?.map(t => toKebab(t)) || [],
    created_at: now,
    updated_at: now
  };

  if (options.severity) {
    data.severity = options.severity;
  }

  let body = loadTemplate('panic');
  if (body) {
    body = body.replace(/^---[\s\S]*?---\s*/, '');
  } else {
    body = `\n## Description\n\n## Impact\n\n## Resolution\n`;
  }

  saveFile(panicPath, data, body);
  clearCache();

  return { id, title, scope: normScope, parent: scopeInfo.prdId, file: panicPath };
}
