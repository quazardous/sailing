/**
 * Path resolution system with placeholder support
 *
 * Built-in placeholders:
 *   ${home}         → user home directory (~/)
 *   ${project}      → project root directory (^/)
 *   ${project_name} → project directory name
 *   ${project_hash} → SHA256 of git remote or realpath (first 12 chars)
 *   ${haven}        → project haven directory (~/.sailing/havens/${project_hash})
 *   ${sibling}      → sibling directory for isolation (${project}/../${project_name}-sailing)
 *
 * Shortcuts:
 *   ~/  → ${home}/
 *   ^/  → ${project}/
 *
 * All placeholders can be overridden in paths.yaml (no circular refs allowed)
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execaSync } from 'execa';
import yaml from 'js-yaml';
import { findProjectRoot } from './core.js';
// Cache for resolved paths
const _cache = new Map();
let _projectHash = null;
/**
 * Compute project hash from git remote or realpath
 * Uses first 12 chars of SHA256
 */
export function computeProjectHash() {
    if (_projectHash)
        return _projectHash;
    const projectRoot = findProjectRoot();
    let source;
    try {
        // Try git remote origin URL first
        const result = execaSync('git', ['remote', 'get-url', 'origin'], {
            cwd: projectRoot,
            reject: false
        });
        if (result.exitCode === 0) {
            source = String(result.stdout).trim();
        }
        else {
            // Fallback to realpath (not a git repo or no remote)
            source = fs.realpathSync(projectRoot);
        }
    }
    catch {
        // Fallback to realpath
        source = fs.realpathSync(projectRoot);
    }
    const hash = crypto.createHash('sha256').update(source).digest('hex');
    _projectHash = hash.substring(0, 12);
    return _projectHash;
}
/**
 * Get built-in placeholder values
 */
function getBuiltinPlaceholders() {
    const projectRoot = findProjectRoot();
    const projectName = path.basename(projectRoot);
    const projectHash = computeProjectHash();
    const home = os.homedir();
    const projectParent = path.dirname(projectRoot);
    return {
        home,
        project: projectRoot,
        project_name: projectName,
        project_hash: projectHash,
        haven: path.join(home, '.sailing', 'havens', projectHash),
        sibling: path.join(projectParent, `${projectName}-sailing`)
    };
}
/**
 * Load custom placeholders from paths.yaml
 */
function loadCustomPlaceholders() {
    const projectRoot = findProjectRoot();
    const pathsFile = path.join(projectRoot, '.sailing', 'paths.yaml');
    if (!fs.existsSync(pathsFile))
        return {};
    try {
        const content = fs.readFileSync(pathsFile, 'utf8');
        const parsed = yaml.load(content);
        return parsed?.placeholders || {};
    }
    catch {
        return {};
    }
}
/**
 * Resolve placeholders in a string
 * Supports recursive resolution (max depth to prevent infinite loops)
 *
 * @param {string} str - String with ${placeholder} patterns
 * @param {number} depth - Current recursion depth
 * @returns {string} Resolved string
 */
export function resolvePlaceholders(str, depth = 0) {
    if (!str || typeof str !== 'string')
        return str;
    if (depth > 5) {
        console.error(`Warning: Max placeholder resolution depth exceeded for: ${str}`);
        return str;
    }
    // Check cache (only for depth 0)
    if (depth === 0 && _cache.has(str)) {
        return _cache.get(str);
    }
    const builtins = getBuiltinPlaceholders();
    const custom = loadCustomPlaceholders();
    const all = { ...builtins, ...custom };
    let result = str;
    // Resolve shortcuts: ~/ → ${home}/, ^/ → ${project}/
    if (result.startsWith('~/')) {
        result = '${home}/' + result.slice(2);
    }
    else if (result.startsWith('^/')) {
        result = '${project}/' + result.slice(2);
    }
    let hasPlaceholder = true;
    // Keep resolving until no more placeholders
    while (hasPlaceholder) {
        hasPlaceholder = false;
        result = result.replace(/\$\{([a-z_]+)\}/g, (match, name) => {
            if (name in all) {
                hasPlaceholder = true;
                const value = all[name];
                // Recursively resolve if value contains placeholders
                return typeof value === 'string' && value.includes('${')
                    ? resolvePlaceholders(value, depth + 1)
                    : value;
            }
            return match; // Keep unrecognized placeholders
        });
        // Prevent infinite loops from circular references
        if (depth > 0)
            break;
    }
    // Cache result
    if (depth === 0) {
        _cache.set(str, result);
    }
    return result;
}
/**
 * Resolve a path key from configuration
 * Combines paths.yaml lookup with placeholder resolution
 *
 * @param {string} key - Path key (e.g., 'worktree', 'cache')
 * @returns {string|null} Resolved absolute path or null if not found
 */
export function resolvePath(key) {
    const projectRoot = findProjectRoot();
    const pathsFile = path.join(projectRoot, '.sailing', 'paths.yaml');
    let pathValue = null;
    // Try to load from paths.yaml
    if (fs.existsSync(pathsFile)) {
        try {
            const content = fs.readFileSync(pathsFile, 'utf8');
            const parsed = yaml.load(content);
            pathValue = parsed?.paths?.[key] || null;
        }
        catch {
            // Ignore parse errors
        }
    }
    if (!pathValue)
        return null;
    // Resolve placeholders
    const resolved = resolvePlaceholders(pathValue);
    // Make absolute if relative
    if (!path.isAbsolute(resolved)) {
        return path.join(projectRoot, resolved);
    }
    return resolved;
}
/**
 * Get all available placeholders with their current values
 */
export function getPlaceholders() {
    const builtins = getBuiltinPlaceholders();
    const custom = loadCustomPlaceholders();
    // Resolve custom placeholders
    const resolvedCustom = {};
    for (const [key, value] of Object.entries(custom)) {
        resolvedCustom[key] = resolvePlaceholders(value);
    }
    return {
        builtin: builtins,
        custom: resolvedCustom,
        all: { ...builtins, ...resolvedCustom }
    };
}
/**
 * Clear the path cache (useful for testing or after config changes)
 */
export function clearCache() {
    _cache.clear();
    _projectHash = null;
}
/**
 * Ensure a directory exists, creating it if necessary
 * Resolves placeholders in the path
 *
 * @param {string} pathWithPlaceholders - Path that may contain placeholders
 * @returns {string} Resolved absolute path
 */
export function ensureDir(pathWithPlaceholders) {
    const resolved = resolvePlaceholders(pathWithPlaceholders);
    const absolute = path.isAbsolute(resolved)
        ? resolved
        : path.join(findProjectRoot(), resolved);
    if (!fs.existsSync(absolute)) {
        fs.mkdirSync(absolute, { recursive: true });
    }
    return absolute;
}
