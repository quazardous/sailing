/**
 * Core Manager - Central I/O, paths, and configuration management
 *
 * This manager handles:
 * - Project root discovery
 * - Path resolution (via paths.yaml)
 * - Placeholder resolution (${home}, ${project}, ${haven}, etc.)
 * - File I/O (load/save markdown with frontmatter)
 * - Directory discovery (PRDs, etc.)
 * - Configuration loading, parsing, and validation
 * - Semantic config accessors (getAgentConfig, getGitConfig, etc.)
 *
 * Pure utilities (toKebab, stripComments) are in lib/strings.ts
 * Pure markdown parsing is in lib/markdown.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import yaml from 'js-yaml';
import { execaSync } from 'execa';
import type { Placeholders } from '../lib/types/config.js';

// Re-export pure utilities for convenience
export { toKebab, stripComments, jsonOut } from '../lib/strings.js';
export { parseMarkdown, stringifyMarkdown } from '../lib/markdown.js';

/**
 * Expand special path prefixes:
 *   ~  → home directory
 *   ^  → sailing repo root (devinstall mode only)
 */
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p === '~') {
    return os.homedir();
  }

  if (p.startsWith('^/') || p === '^') {
    const repoRoot = getRepoRoot();
    if (repoRoot) {
      return p === '^' ? repoRoot : path.join(repoRoot, p.slice(2));
    }
    console.error(`Warning: ^/ prefix only works in devinstall mode`);
    return p.replace(/^\^/, '.');
  }

  return p;
}

/**
 * Default paths configuration
 */
const DEFAULT_PATHS: Record<string, { path: string; type: 'dir' | 'file' }> = {
  artefacts:  { path: '.sailing/artefacts', type: 'dir' },
  memory:     { path: '.sailing/memory', type: 'dir' },
  archive:    { path: '.sailing/archive', type: 'dir' },
  templates:  { path: '.sailing/templates', type: 'dir' },
  prompting:  { path: '.sailing/prompting', type: 'dir' },
  state:      { path: '.sailing/state.json', type: 'file' },
  config:     { path: '.sailing/config.yaml', type: 'file' },
  components: { path: '.sailing/components.yaml', type: 'file' },
  toolset:    { path: '.claude/TOOLSET.md', type: 'file' },
  stack:      { path: 'STACK.md', type: 'file' },
  roadmap:    { path: '.sailing/artefacts/ROADMAP.md', type: 'file' },
  postit:     { path: '.sailing/artefacts/POSTIT.md', type: 'file' },
  haven:        { path: '${haven}', type: 'dir' },
  agents:       { path: '${haven}/agents', type: 'dir' },
  worktrees:    { path: '${haven}/worktrees', type: 'dir' },
  runs:         { path: '${haven}/runs', type: 'dir' },
  assignments:  { path: '${haven}/assignments', type: 'dir' },
  diagnostics:  { path: '${haven}/diagnostics', type: 'dir' },
  srtConfig:    { path: '${haven}/srt-settings.json', type: 'file' }
};

// Cached state
interface PathsConfig {
  paths: Record<string, string | null>;
}

let _config: PathsConfig | null = null;
let _projectRoot: string | null = null;
let _scriptDir: string | null = null;
let _repoRoot: string | null | undefined = undefined;
let _pathOverrides: Record<string, string> = {};

// Placeholder cache (from paths.ts)
const _placeholderCache = new Map<string, string>();
let _projectHash: string | null = null;

// Magic marker for sailing repo root
const REPO_MAGIC_FILE = '.sailing-repo';
const REPO_MAGIC_CONTENT = 'kaizoku-ou-ni-ore-wa-naru';

// ============================================================================
// PATH OVERRIDES
// ============================================================================

export function setPathOverrides(overrides: Record<string, string>): void {
  _pathOverrides = { ..._pathOverrides, ...overrides };
  _config = null;
}

export function parsePathOverride(override: string): { key: string; value: string } | null {
  const match = override.match(/^([^=]+)=(.*)$/);
  if (!match) {
    console.error(`Invalid path override format: ${override}`);
    return null;
  }

  const [, key, value] = match;
  if (!DEFAULT_PATHS[key]) {
    console.error(`Unknown path key: ${key}`);
    return null;
  }
  if (!value) {
    console.error(`Empty value for path key: ${key}`);
    return null;
  }

  return { key, value };
}

// ============================================================================
// PROJECT ROOT DISCOVERY
// ============================================================================

export function setScriptDir(dir: string) {
  _scriptDir = dir;
}

export function setProjectRoot(dir: string) {
  _projectRoot = dir;
  _config = null;
}

export function getRepoRoot(): string | null {
  if (_repoRoot !== undefined) return _repoRoot;

  const startDir = _scriptDir || import.meta.dirname;
  if (!startDir) {
    _repoRoot = null;
    return null;
  }

  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const magicPath = path.join(dir, REPO_MAGIC_FILE);
    if (fs.existsSync(magicPath)) {
      try {
        const content = fs.readFileSync(magicPath, 'utf8').trim();
        if (content === REPO_MAGIC_CONTENT) {
          _repoRoot = dir;
          return dir;
        }
      } catch { /* ignore */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  _repoRoot = null;
  return null;
}

export function findProjectRoot(): string {
  if (_projectRoot) return _projectRoot;

  const startDir = _scriptDir || import.meta.dirname;

  if (startDir) {
    let dir = startDir;
    while (dir !== path.dirname(dir)) {
      if (path.basename(dir) === '.sailing') {
        _projectRoot = path.dirname(dir);
        return _projectRoot;
      }
      if (fs.existsSync(path.join(dir, '.sailing'))) {
        _projectRoot = dir;
        return dir;
      }
      dir = path.dirname(dir);
    }
  }

  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.sailing'))) {
      _projectRoot = dir;
      return dir;
    }
    dir = path.dirname(dir);
  }

  _projectRoot = process.cwd();
  return _projectRoot;
}

// ============================================================================
// PATH RESOLUTION
// ============================================================================

function getPathString(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.path) return value.path;
  return null;
}

export function getPathType(key: string): 'dir' | 'file' {
  const def = DEFAULT_PATHS[key];
  if (def && typeof def === 'object') return def.type;
  return 'dir';
}

export function loadPathsConfig(): PathsConfig {
  if (_config) return _config;

  const projectRoot = findProjectRoot();
  const pathsConfigPath = path.join(projectRoot, '.sailing', 'paths.yaml');

  const defaultPaths: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(DEFAULT_PATHS)) {
    defaultPaths[key] = getPathString(value);
  }

  if (fs.existsSync(pathsConfigPath)) {
    try {
      const content = fs.readFileSync(pathsConfigPath, 'utf8');
      const parsed = yaml.load(content) as PathsConfig;
      const parsedPaths = (parsed.paths || {});
      _config = { paths: { ...defaultPaths, ...parsedPaths } };
    } catch {
      console.error(`Warning: Could not parse ${pathsConfigPath}, using defaults`);
      _config = { paths: defaultPaths };
    }
  } else {
    _config = { paths: defaultPaths };
  }

  if (Object.keys(_pathOverrides).length > 0) {
    _config = { paths: { ..._config.paths, ..._pathOverrides } };
  }

  return _config;
}

export function getPath(key: string): string | null {
  const config: PathsConfig = loadPathsConfig();
  const projectRoot = findProjectRoot();

  let configuredPath: string | null = config.paths[key];
  if (!configuredPath) {
    const def = DEFAULT_PATHS[key];
    configuredPath = getPathString(def);
  }

  if (!configuredPath) return null;

  if (configuredPath.includes('${')) {
    return resolvePlaceholders(configuredPath);
  }

  const expanded = expandPath(configuredPath);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  return path.join(projectRoot, expanded);
}

// ============================================================================
// PLACEHOLDER RESOLUTION (merged from lib/paths.ts)
// ============================================================================

/**
 * Compute project hash from git remote or realpath
 * Uses first 12 chars of SHA256
 */
export function computeProjectHash(): string {
  if (_projectHash) return _projectHash;

  const projectRoot = findProjectRoot();
  let source: string;

  try {
    // Try git remote origin URL first
    const result = execaSync('git', ['remote', 'get-url', 'origin'], {
      cwd: projectRoot,
      reject: false
    });
    if (result.exitCode === 0) {
      source = String(result.stdout).trim();
    } else {
      // Fallback to realpath (not a git repo or no remote)
      source = fs.realpathSync(projectRoot);
    }
  } catch {
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
function getBuiltinPlaceholders(): Placeholders {
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
function loadCustomPlaceholders(): Record<string, string> {
  const projectRoot = findProjectRoot();
  const pathsFile = path.join(projectRoot, '.sailing', 'paths.yaml');

  if (!fs.existsSync(pathsFile)) return {};

  try {
    const content = fs.readFileSync(pathsFile, 'utf8');
    const parsed = yaml.load(content) as { placeholders?: Record<string, string> };
    return parsed?.placeholders || {};
  } catch {
    return {};
  }
}

/**
 * Resolve placeholders in a string
 * Supports recursive resolution (max depth to prevent infinite loops)
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
 * @param str - String with ${placeholder} patterns
 * @param depth - Current recursion depth
 * @returns Resolved string
 */
export function resolvePlaceholders(str: string, depth = 0): string {
  if (!str || typeof str !== 'string') return str;
  if (depth > 5) {
    console.error(`Warning: Max placeholder resolution depth exceeded for: ${str}`);
    return str;
  }

  // Check cache (only for depth 0)
  if (depth === 0 && _placeholderCache.has(str)) {
    return _placeholderCache.get(str);
  }

  const builtins = getBuiltinPlaceholders();
  const custom = loadCustomPlaceholders();
  const all: Placeholders = { ...builtins, ...custom };

  let result = str;

  // Resolve shortcuts: ~/ → ${home}/, ^/ → ${project}/
  if (result.startsWith('~/')) {
    result = '${home}/' + result.slice(2);
  } else if (result.startsWith('^/')) {
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
    if (depth > 0) break;
  }

  // Cache result
  if (depth === 0) {
    _placeholderCache.set(str, result);
  }

  return result;
}

/**
 * Resolve a path key from configuration
 * Combines paths.yaml lookup with placeholder resolution
 *
 * @param key - Path key (e.g., 'worktree', 'cache')
 * @returns Resolved absolute path or null if not found
 */
export function resolvePath(key: string): string | null {
  const projectRoot = findProjectRoot();
  const pathsFile = path.join(projectRoot, '.sailing', 'paths.yaml');

  let pathValue: string | null = null;

  // Try to load from paths.yaml
  if (fs.existsSync(pathsFile)) {
    try {
      const content = fs.readFileSync(pathsFile, 'utf8');
      const parsed = yaml.load(content) as { paths?: Record<string, string> };
      pathValue = parsed?.paths?.[key] || null;
    } catch {
      // Ignore parse errors
    }
  }

  if (!pathValue) return null;

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
export function getPlaceholders(): { builtin: Placeholders; custom: Record<string, string>; all: Placeholders } {
  const builtins = getBuiltinPlaceholders();
  const custom = loadCustomPlaceholders();

  // Resolve custom placeholders
  const resolvedCustom: Record<string, string> = {};
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
 * Clear the placeholder cache (useful for testing or after config changes)
 */
export function clearPlaceholderCache(): void {
  _placeholderCache.clear();
  _projectHash = null;
}

/**
 * Ensure a directory exists, creating it if necessary
 * Resolves placeholders in the path
 *
 * @param pathWithPlaceholders - Path that may contain placeholders
 * @returns Resolved absolute path
 */
export function ensureDir(pathWithPlaceholders: string): string {
  const resolved = resolvePlaceholders(pathWithPlaceholders);
  const absolute = path.isAbsolute(resolved)
    ? resolved
    : path.join(findProjectRoot(), resolved);

  if (!fs.existsSync(absolute)) {
    fs.mkdirSync(absolute, { recursive: true });
  }

  return absolute;
}

// ============================================================================
// DIRECTORY GETTERS
// ============================================================================

export function getSailingDir() {
  return path.join(findProjectRoot(), '.sailing');
}

export function getArtefactsDir() {
  return getPath('artefacts');
}

export function getPrdsDir() {
  return path.join(getArtefactsDir(), 'prds');
}

export function getMemoryDir() {
  return getPath('memory');
}

export function getArchiveDir() {
  return getPath('archive');
}

export function getTemplatesDir() {
  return getPath('templates');
}

export function getPromptingDir() {
  return getPath('prompting');
}

export function getStateFile() {
  return getPath('state');
}

export function getConfigFile() {
  return getPath('config');
}

export function getComponentsFile() {
  return getPath('components');
}

export function getAgentsDir() {
  return getPath('agents');
}

export function getWorktreesDir() {
  return getPath('worktrees');
}

export function getRunsDir() {
  return getPath('runs');
}

export function getAssignmentsDir() {
  return getPath('assignments');
}

// Legacy export
export const PROJECT_ROOT = findProjectRoot();

// ============================================================================
// DEV INSTALL DETECTION
// ============================================================================

export function isDevInstall() {
  const repoRoot = _scriptDir
    ? path.resolve(_scriptDir, '..')
    : path.resolve(import.meta.dirname, '../..');

  return fs.existsSync(path.join(repoRoot, 'prompting')) &&
         fs.existsSync(path.join(repoRoot, 'cli')) &&
         fs.existsSync(path.join(repoRoot, 'install.sh'));
}

export function getSailingRepoRoot() {
  return _scriptDir
    ? path.resolve(_scriptDir, '..')
    : path.resolve(import.meta.dirname, '../..');
}

export function getPrompting() {
  if (isDevInstall()) {
    return path.join(getSailingRepoRoot(), 'prompting');
  }
  return getPromptingDir();
}

export function getTemplates() {
  if (isDevInstall()) {
    return path.join(getSailingRepoRoot(), 'templates');
  }
  return getTemplatesDir();
}

// ============================================================================
// FILE DISCOVERY (re-exported from discovery-manager.ts)
// ============================================================================

export {
  findDevMd,
  findToolset,
  findPrdDirs,
  findFiles
} from './discovery-manager.js';

// ============================================================================
// INFO GETTERS (re-exported from info-manager.ts)
// ============================================================================

export { getPathsInfo, getConfigInfo } from './info-manager.js';

// ============================================================================
// FILE I/O (re-exported from fileio-manager.ts)
// ============================================================================

export {
  loadFile,
  saveFile,
  loadTemplate,
  loadComponents,
  saveComponents
} from './fileio-manager.js';

export type { LoadedDoc } from './fileio-manager.js';

// ============================================================================
// CONFIGURATION (re-exported from config-manager.ts)
// ============================================================================

export {
  CONFIG_SCHEMA,
  setConfigOverrides,
  parseConfigOverride,
  getNestedValue,
  getConfigPath,
  loadConfig,
  clearConfigCache,
  configExists,
  getConfigDefaults,
  getConfigSchema,
  getAgentConfig,
  getGitConfig,
  getMainBranch,
  getIdsConfig,
  getConfigValue,
  getDigitConfig,
  formatId,
  validateConfigCoherence,
  getConfigDisplay
} from './config-manager.js';
