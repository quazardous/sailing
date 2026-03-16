/**
 * Artefact search — MiniSearch-powered full-text index
 *
 * Replaces the old grep-first approach with a proper inverted index.
 * Supports fuzzy matching, prefix search, AND tokenization, and field boosting.
 * The index is lazily built on first search and invalidated via onClear().
 */
import MiniSearch from 'minisearch';
import { getAllTasks } from './task.js';
import { getAllEpics } from './epic.js';
import { getAllPrds } from './prd.js';
import { getAllStories } from './story.js';
import { buildArchiveIndex } from './archive.js';
import { onClear } from './common.js';
import { loadFile } from '../core-manager.js';
let _searchIndex = null;
// Register cache invalidation (no circular dependency)
onClear(() => { _searchIndex = null; });
function readBody(filePath) {
    const loaded = loadFile(filePath);
    return loaded?.body || '';
}
/** Strip Unicode combining diacritical marks (accents) */
function stripAccents(s) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function buildIndex() {
    const index = new MiniSearch({
        idField: '_uid',
        fields: ['title', 'status', 'body'],
        storeFields: ['id', 'type', 'title', 'status', 'parent', 'prdId', 'archived', 'file', 'body'],
        processTerm: (term) => stripAccents(term.toLowerCase())
    });
    const docs = [];
    // Active tasks
    for (const t of getAllTasks()) {
        docs.push({
            _uid: `active:task:${t.key}`,
            id: t.id,
            type: 'task',
            title: t.data.title || '',
            status: t.data.status || '',
            body: readBody(t.file),
            parent: t.data.parent || '',
            prdId: t.prdId,
            archived: false,
            file: t.file
        });
    }
    // Active epics
    for (const e of getAllEpics()) {
        docs.push({
            _uid: `active:epic:${e.key}`,
            id: e.id,
            type: 'epic',
            title: e.data.title || '',
            status: e.data.status || '',
            body: readBody(e.file),
            parent: e.data.parent || '',
            prdId: e.prdId,
            archived: false,
            file: e.file
        });
    }
    // Active PRDs
    for (const p of getAllPrds()) {
        docs.push({
            _uid: `active:prd:${p.num}`,
            id: p.id,
            type: 'prd',
            title: p.data.title || '',
            status: p.data.status || '',
            body: readBody(p.file),
            parent: '',
            prdId: p.id,
            archived: false,
            file: p.file
        });
    }
    // Active stories
    for (const s of getAllStories()) {
        docs.push({
            _uid: `active:story:${s.key}`,
            id: s.id,
            type: 'story',
            title: s.data.title || '',
            status: s.data.status || '',
            body: readBody(s.file),
            parent: s.data.parent || '',
            prdId: s.prdId,
            archived: false,
            file: s.file
        });
    }
    // Archived artefacts
    const archive = buildArchiveIndex();
    for (const entry of archive.values()) {
        docs.push({
            _uid: `archive:${entry.type}:${entry.key}`,
            id: entry.id,
            type: entry.type,
            title: entry.title,
            status: entry.status,
            body: readBody(entry.file),
            parent: entry.parent,
            prdId: entry.prdId,
            archived: true,
            file: entry.file
        });
    }
    index.addAll(docs);
    return index;
}
function getSearchIndex() {
    if (!_searchIndex)
        _searchIndex = buildIndex();
    return _searchIndex;
}
// ============================================================================
// SEARCH
// ============================================================================
function matchesPrdFilter(prdId, filter) {
    const a = (/PRD-?0*(\d+)/i).exec(prdId);
    const b = (/PRD-?0*(\d+)/i).exec(filter);
    if (a && b)
        return a[1] === b[1];
    return prdId.toLowerCase().includes(filter.toLowerCase());
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesFilters(result, options) {
    if (options.type && result.type !== options.type)
        return false;
    if (options.archived === true && !result.archived)
        return false;
    if (options.archived === false && result.archived)
        return false;
    const status = result.status || '';
    if (options.status && !status.toLowerCase().includes(options.status.toLowerCase()))
        return false;
    const prdId = result.prdId || '';
    if (options.prd && !matchesPrdFilter(prdId, options.prd))
        return false;
    return true;
}
/**
 * Extract a contextual snippet (±2 lines around first match) from a body.
 */
function extractSnippet(body, terms) {
    if (!body || terms.length === 0)
        return undefined;
    const lines = body.split('\n');
    const lowerTerms = terms.map(t => stripAccents(t.toLowerCase()));
    for (let i = 0; i < lines.length; i++) {
        const normalized = stripAccents(lines[i].toLowerCase());
        if (lowerTerms.some(t => normalized.includes(t))) {
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length, i + 3);
            return lines.slice(start, end).join('\n').trim();
        }
    }
    return undefined;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toHit(result, terms, withSnippet) {
    return {
        id: result.id || '',
        type: result.type,
        title: result.title || '',
        status: result.status || '',
        parent: result.parent || '',
        prdId: result.prdId || '',
        archived: result.archived,
        file: result.file || '',
        ...(withSnippet ? { snippet: extractSnippet(result.body, terms) } : {})
    };
}
/** Minimum absolute score — below this, results are considered noise. */
const MIN_SCORE = 2;
/**
 * Search artefacts using full-text index with fuzzy matching and AND tokenization.
 *
 * Two-layer filtering:
 * - Absolute: results with score < MIN_SCORE are discarded (catches garbage-only queries)
 * - Relative: results below 10% of the top score are discarded (cuts the long tail)
 */
export function searchArtefacts(query, options = {}) {
    const index = getSearchIndex();
    const limit = options.limit || 30;
    const results = index.search(query, {
        fuzzy: options.fuzzy ?? 0,
        prefix: true,
        combineWith: 'AND',
        boost: { title: 3, status: 2 }
    });
    if (results.length === 0)
        return [];
    const topScore = results[0].score;
    if (topScore < MIN_SCORE)
        return [];
    const relativeMin = topScore * 0.1;
    // Collect matched terms from MiniSearch for snippet extraction
    const matchedTerms = new Set();
    for (const r of results) {
        if (r.match) {
            for (const term of Object.keys(r.match))
                matchedTerms.add(term);
        }
    }
    const terms = [...matchedTerms];
    let hits = [];
    for (const result of results) {
        if (hits.length >= limit)
            break;
        if (result.score < MIN_SCORE || result.score < relativeMin)
            break;
        if (matchesFilters(result, options))
            hits.push(toHit(result, terms, !!options.snippet));
    }
    // Accent-sensitive mode: post-filter preserving accents (case-insensitive)
    if (options.accent_sensitive) {
        const queryTerms = query.toLowerCase().split(/\s+/);
        hits = hits.filter(hit => {
            const text = `${hit.title} ${hit.snippet || ''}`.toLowerCase();
            return queryTerms.every(t => text.includes(t));
        });
    }
    return hits;
}
