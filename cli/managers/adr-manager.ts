/**
 * ADR Manager - Architecture Decision Records management
 *
 * Handles:
 * - ADR CRUD operations
 * - Index management (file → cache)
 * - Status transitions
 * - Template rendering
 *
 * Index pattern: Scans files to build in-memory index (same as artefacts)
 */
import fs from 'fs';
import path from 'path';
import { findProjectRoot, getPath, loadFile, saveFile, loadTemplate, parseMarkdown, getFileTimestamps } from './core-manager.js';
import type { Adr, AdrIndexEntry, AdrStatus, FullAdr } from '../lib/types/adr.js';

// ============================================================================
// CACHE
// ============================================================================

let _adrIndex: Map<string, AdrIndexEntry> | null = null;

/**
 * Clear ADR cache (call after ADR changes)
 */
export function clearAdrCache(): void {
  _adrIndex = null;
}

// ============================================================================
// PATH HELPERS
// ============================================================================

/**
 * Get ADR directory path
 */
export function getAdrDir(): string {
  const configured = getPath('adr');
  if (configured) return configured;
  // Default fallback
  return path.join(findProjectRoot(), 'docs', 'ADR');
}

/**
 * Ensure ADR directory exists
 */
export function ensureAdrDir(): string {
  const adrDir = getAdrDir();
  if (!fs.existsSync(adrDir)) {
    fs.mkdirSync(adrDir, { recursive: true });
  }
  return adrDir;
}

// ============================================================================
// INDEX BUILDING
// ============================================================================

/**
 * Extract ADR number key from filename or ID
 * ADR-001 → "1", ADR-042 → "42"
 */
function extractAdrKey(input: string): string | null {
  const match = input.match(/ADR-?0*(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Build ADR index by scanning files
 */
export function buildAdrIndex(): Map<string, AdrIndexEntry> {
  if (_adrIndex) return _adrIndex;

  const index = new Map<string, AdrIndexEntry>();
  const adrDir = getAdrDir();

  if (!fs.existsSync(adrDir)) {
    _adrIndex = index;
    return index;
  }

  const files = fs.readdirSync(adrDir).filter(f => /^ADR-\d+.*\.md$/i.test(f));

  for (const file of files) {
    const key = extractAdrKey(file);
    if (key === null) continue;

    const filePath = path.join(adrDir, file);
    const loaded = loadFile<Adr>(filePath);
    if (!loaded) continue;

    // Extract ID from frontmatter or filename
    const id = loaded.data.id || `ADR-${key.padStart(3, '0')}`;
    const timestamps = getFileTimestamps(filePath);

    index.set(key, {
      id,
      file: filePath,
      data: {
        ...loaded.data,
        id // Ensure id is set
      },
      createdAt: timestamps.createdAt,
      modifiedAt: timestamps.modifiedAt
    });
  }

  _adrIndex = index;
  return index;
}

// ============================================================================
// GETTERS
// ============================================================================

/**
 * Get ADR by ID (any format: 1, "1", "001", "ADR-001", "ADR-1")
 */
export function getAdr(id: string | number): AdrIndexEntry | null {
  const index = buildAdrIndex();
  const key = extractAdrKey(String(id)) || String(id);
  return index.get(key) || null;
}

/**
 * Get all ADRs
 */
export function getAllAdrs(): AdrIndexEntry[] {
  const index = buildAdrIndex();
  const entries = [...index.values()];

  // Sort by ID number
  entries.sort((a, b) => {
    const numA = parseInt(extractAdrKey(a.id) || '0', 10);
    const numB = parseInt(extractAdrKey(b.id) || '0', 10);
    return numA - numB;
  });

  return entries;
}

/**
 * Get full ADR with body content
 */
export function getFullAdr(id: string): FullAdr | null {
  const entry = getAdr(id);
  if (!entry) return null;

  const loaded = loadFile(entry.file);
  if (!loaded) return null;

  const data = loaded.data as Adr;
  const body = loaded.body || '';

  // Extract context and decision sections
  const context = extractSection(body, ['Context', 'Contexte']);
  const decision = extractSection(body, ['Decision', 'Décision']);

  return {
    id: data.id || entry.id,
    title: data.title || 'Untitled',
    status: data.status || 'Proposed',
    created: data.created || '',
    author: data.author,
    tags: data.tags,
    domain: data.domain,
    supersedes: data.supersedes,
    superseded_by: data.superseded_by,
    filePath: entry.file,
    body,
    context,
    decision
  };
}

/**
 * Extract a section from markdown body
 */
function extractSection(body: string, headings: string[]): string | undefined {
  for (const heading of headings) {
    const regex = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |$)`, 'mi');
    const match = body.match(regex);
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Get next available ADR number
 */
export function getNextAdrNumber(): number {
  const entries = getAllAdrs();
  if (entries.length === 0) return 1;

  const maxNum = Math.max(...entries.map(e => {
    const key = extractAdrKey(e.id);
    return key ? parseInt(key, 10) : 0;
  }));

  return maxNum + 1;
}

/**
 * Create a new ADR
 */
export function createAdr(title: string, options: {
  author?: string;
  tags?: string[];
  domain?: string;
} = {}): { id: string; file: string } {
  const adrDir = ensureAdrDir();
  const num = getNextAdrNumber();
  const id = `ADR-${String(num).padStart(3, '0')}`;
  const today = new Date().toISOString().split('T')[0];

  // Load template
  const templateContent = loadTemplate('adr');
  const parsed = templateContent ? parseMarkdown(templateContent) : null;
  const templateData = (parsed?.data || {}) as Record<string, unknown>;
  const templateBody = parsed?.body || '';

  // Prepare frontmatter
  const data: Adr = {
    id,
    title,
    status: 'Proposed',
    created: today,
    author: options.author || (templateData.author as string) || '',
    tags: options.tags || [],
    domain: options.domain || '',
    supersedes: '',
    superseded_by: ''
  };

  // Replace placeholders in body
  let body = templateBody
    .replace(/ADR-NNN/g, id)
    .replace(/Decision Title/g, title)
    .replace(/YYYY-MM-DD/g, today);

  const filePath = path.join(adrDir, `${id}.md`);
  saveFile(filePath, data, body);
  clearAdrCache();

  return { id, file: filePath };
}

/**
 * Update ADR status
 */
export function updateAdrStatus(id: string, newStatus: AdrStatus, options: {
  supersededBy?: string;
} = {}): boolean {
  const entry = getAdr(id);
  if (!entry) return false;

  const loaded = loadFile(entry.file);
  if (!loaded) return false;

  const data = loaded.data as Adr;
  data.status = newStatus;

  if (options.supersededBy && newStatus === 'Superseded') {
    data.superseded_by = options.supersededBy;

    // Also update the superseding ADR to reference this one
    const supersedesEntry = getAdr(options.supersededBy);
    if (supersedesEntry) {
      const supersedesLoaded = loadFile(supersedesEntry.file);
      if (supersedesLoaded) {
        const supersedesData = supersedesLoaded.data as Adr;
        supersedesData.supersedes = entry.id;
        saveFile(supersedesEntry.file, supersedesData, supersedesLoaded.body);
      }
    }
  }

  saveFile(entry.file, data, loaded.body);
  clearAdrCache();
  return true;
}

// ============================================================================
// FILTERING & QUERYING
// ============================================================================

/**
 * Get ADRs by status
 */
export function getAdrsByStatus(status: AdrStatus): AdrIndexEntry[] {
  return getAllAdrs().filter(e => e.data.status === status);
}

/**
 * Get ADRs by domain
 */
export function getAdrsByDomain(domain: string): AdrIndexEntry[] {
  return getAllAdrs().filter(e => e.data.domain === domain);
}

/**
 * Get ADRs by tags
 */
export function getAdrsByTags(tags: string[]): AdrIndexEntry[] {
  return getAllAdrs().filter(e => {
    const adrTags = e.data.tags || [];
    return tags.some(t => adrTags.includes(t));
  });
}

/**
 * Get accepted ADRs (active decisions)
 */
export function getAcceptedAdrs(): AdrIndexEntry[] {
  return getAdrsByStatus('Accepted');
}

/**
 * Get ADRs relevant to a context (for prompt injection)
 * Filters by domain and/or tags, returns only accepted ADRs
 */
export function getRelevantAdrs(options: {
  domain?: string;
  tags?: string[];
} = {}): FullAdr[] {
  let entries = getAcceptedAdrs();

  if (options.domain) {
    entries = entries.filter(e => e.data.domain === options.domain);
  }

  if (options.tags && options.tags.length > 0) {
    entries = entries.filter(e => {
      const adrTags = e.data.tags || [];
      return options.tags!.some(t => adrTags.includes(t));
    });
  }

  // Load full content for each
  return entries
    .map(e => getFullAdr(e.id))
    .filter((adr): adr is FullAdr => adr !== null);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Normalize ADR ID (handle various input formats)
 */
export function normalizeAdrId(input: string): string {
  // Already in correct format
  if (/^ADR-\d{3}$/.test(input)) {
    return input;
  }

  // Just a number
  if (/^\d+$/.test(input)) {
    return `ADR-${input.padStart(3, '0')}`;
  }

  // ADR-N or adr-n
  const match = input.toUpperCase().match(/^ADR-?(\d+)$/);
  if (match) {
    return `ADR-${match[1].padStart(3, '0')}`;
  }

  // Return as-is if can't normalize
  return input.toUpperCase();
}

/**
 * Format ADR for display (single line)
 */
export function formatAdrLine(entry: AdrIndexEntry): string {
  const status = entry.data.status || 'Proposed';
  const title = entry.data.title || 'Untitled';
  const statusIcon = getStatusIcon(status);
  return `${statusIcon} ${entry.id}: ${title} (${status})`;
}

/**
 * Get status icon
 */
function getStatusIcon(status: AdrStatus): string {
  switch (status) {
    case 'Proposed': return '?';
    case 'Accepted': return '+';
    case 'Deprecated': return '-';
    case 'Superseded': return '~';
    default: return ' ';
  }
}

/**
 * Format ADRs for prompt injection
 */
export function formatAdrsForPrompt(adrs: FullAdr[]): string {
  if (adrs.length === 0) return '';

  const lines = ['## Architecture Decision Records (ADRs)', ''];

  for (const adr of adrs) {
    lines.push(`### ${adr.id}: ${adr.title}`);
    if (adr.decision) {
      lines.push(`**Decision**: ${adr.decision.split('\n')[0]}`);
    }
    if (adr.context) {
      const contextSummary = adr.context.split('\n')[0];
      lines.push(`**Why**: ${contextSummary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
