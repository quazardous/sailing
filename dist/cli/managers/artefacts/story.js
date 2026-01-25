/**
 * Story artefact operations
 */
import fs from 'fs';
import path from 'path';
import { findPrdDirs, loadFile, saveFile, getPrdsDir, toKebab, loadTemplate, formatId } from '../core-manager.js';
import { nextId } from '../state-manager.js';
import { extractIdKey } from '../../lib/artefacts.js';
import { normalizeId } from '../../lib/normalize.js';
import { _storyIndex, setStoryIndex, clearCache } from './common.js';
import { getPrd, prdIdFromDir } from './prd.js';
// ============================================================================
// INDEX
// ============================================================================
/**
 * Build story index across all PRDs
 */
export function buildStoryIndex() {
    if (_storyIndex)
        return _storyIndex;
    const index = new Map();
    const duplicates = [];
    for (const prdDir of findPrdDirs()) {
        const storiesDir = path.join(prdDir, 'stories');
        if (!fs.existsSync(storiesDir))
            continue;
        const files = fs.readdirSync(storiesDir).filter(f => /^S\d+[a-z]?.*\.md$/i.test(f));
        for (const file of files) {
            const key = extractIdKey(file, 'S');
            if (key === null)
                continue;
            const filePath = path.join(storiesDir, file);
            const idMatch = file.match(/^(S\d+[a-z]?)/i);
            const id = idMatch ? idMatch[1] : `S${key}`;
            const loaded = loadFile(filePath);
            if (index.has(key)) {
                duplicates.push({ key, existing: index.get(key).file, new: filePath });
            }
            index.set(key, {
                key,
                id,
                file: filePath,
                prdId: prdIdFromDir(prdDir),
                prdDir,
                data: loaded?.data || {}
            });
        }
    }
    if (duplicates.length > 0) {
        console.error(`⚠ Duplicate story IDs found:`);
        for (const d of duplicates) {
            console.error(`  S${d.key}: ${d.existing} vs ${d.new}`);
        }
    }
    setStoryIndex(index);
    return index;
}
// ============================================================================
// GETTERS
// ============================================================================
/**
 * Get story by ID (any format: 1, "1", "S1", "S001", "S0001")
 */
export function getStory(storyId) {
    const index = buildStoryIndex();
    let key;
    if (typeof storyId === 'number') {
        key = String(storyId);
    }
    else {
        const match = String(storyId).match(/^S?0*(\d+)([a-z])?$/i);
        if (match) {
            key = match[1] + (match[2] ? match[2].toLowerCase() : '');
        }
        else {
            key = null;
        }
    }
    if (key === null)
        return null;
    return index.get(key) || null;
}
/**
 * Get all stories matching optional filters
 */
export function getAllStories(options = {}) {
    const index = buildStoryIndex();
    let stories = [...index.values()];
    if (options.prdDir) {
        stories = stories.filter(s => s.prdDir === options.prdDir);
    }
    if (options.type) {
        stories = stories.filter(s => s.data?.type === options.type);
    }
    return stories;
}
/**
 * Get all stories for a specific PRD
 */
export function getStoriesForPrd(prdId) {
    const prd = getPrd(prdId);
    if (!prd)
        return [];
    return getAllStories({ prdDir: prd.dir });
}
export function countStories(options = {}) {
    return getAllStories(options).length;
}
/**
 * Find story file by ID
 */
export function findStoryFile(storyId) {
    const normalized = normalizeId(storyId);
    if (!normalized)
        return null;
    const prdsDir = getPrdsDir();
    if (!fs.existsSync(prdsDir))
        return null;
    for (const prdDir of fs.readdirSync(prdsDir)) {
        const storiesDir = path.join(prdsDir, prdDir, 'stories');
        if (!fs.existsSync(storiesDir))
            continue;
        for (const file of fs.readdirSync(storiesDir)) {
            if (file.startsWith(normalized + '-') && file.endsWith('.md')) {
                return path.join(storiesDir, file);
            }
        }
    }
    return null;
}
/**
 * Create a new story under a PRD
 */
export function createStory(prdId, title, options = {}) {
    const prd = getPrd(prdId);
    if (!prd) {
        throw new Error(`PRD not found: ${prdId}`);
    }
    const storiesDir = path.join(prd.dir, 'stories');
    if (!fs.existsSync(storiesDir)) {
        fs.mkdirSync(storiesDir, { recursive: true });
    }
    const num = nextId('story');
    const id = formatId('S', num);
    const filename = `${id}-${toKebab(title)}.md`;
    const storyPath = path.join(storiesDir, filename);
    const data = {
        id,
        title,
        status: 'Draft',
        parent: prd.id,
        type: options.type || 'user',
        tags: options.tags?.map(t => toKebab(t)) || []
    };
    let body = loadTemplate('story');
    if (body) {
        body = body.replace(/^---[\s\S]*?---\s*/, '');
    }
    else {
        body = `\n## User Story\n\nAs a [user type], I want [goal] so that [benefit].\n\n## Acceptance Criteria\n\n- [ ] [Criterion 1]\n`;
    }
    saveFile(storyPath, data, body);
    clearCache();
    return { id, title, parent: prd.id, file: storyPath };
}
