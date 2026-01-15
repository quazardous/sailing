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
import { parseMarkdown, stringifyMarkdown } from '../lib/markdown.js';
import { formatIdFrom } from '../lib/normalize.js';
import type { PathsInfo, ConfigInfo, SailingConfig, ConfigSchemaEntry, ConfigDisplayItem, ConfigSchema, Placeholders } from '../lib/types/config.js';

// Re-export pure utilities for convenience
export { toKebab, stripComments, jsonOut } from '../lib/strings.js';
export { parseMarkdown, stringifyMarkdown } from '../lib/markdown.js';

export interface LoadedDoc<T = Record<string, any>> {
  data: T;
  body: string;
  filepath: string;
}

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
let _config: any = null;
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

export function loadPathsConfig(): any {
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
      const parsed = yaml.load(content) as any;
      _config = { paths: { ...defaultPaths, ...(parsed.paths || {}) } };
    } catch (e) {
      console.error(`Warning: Could not parse ${pathsConfigPath}, using defaults`);
      _config = { paths: defaultPaths };
    }
  } else {
    _config = { paths: defaultPaths };
  }

  if (Object.keys(_pathOverrides).length > 0) {
    _config.paths = { ..._config.paths, ..._pathOverrides };
  }

  return _config;
}

export function getPath(key: string): string | null {
  const config = loadPathsConfig();
  const projectRoot = findProjectRoot();

  let configuredPath = config.paths[key];
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
// PROJECT FILE DISCOVERY
// ============================================================================

/**
 * Find DEV.md file (check project root and common locations)
 * @param projectRoot - Project root path (defaults to findProjectRoot())
 * @returns Path to DEV.md or null
 */
export function findDevMd(projectRoot?: string): string | null {
  projectRoot = projectRoot || findProjectRoot();
  const candidates = [
    path.join(projectRoot, 'DEV.md'),
    path.join(projectRoot, 'DEVELOPMENT.md'),
    path.join(projectRoot, 'docs', 'DEV.md'),
    path.join(projectRoot, 'docs', 'DEVELOPMENT.md')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Find TOOLSET.md file
 * @param projectRoot - Project root path (defaults to findProjectRoot())
 * @returns Path to TOOLSET.md or null
 */
export function findToolset(projectRoot?: string): string | null {
  projectRoot = projectRoot || findProjectRoot();
  const candidates = [
    path.join(projectRoot, '.claude', 'TOOLSET.md'),
    path.join(projectRoot, 'TOOLSET.md')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ============================================================================
// INFO GETTERS
// ============================================================================

export function getPathsInfo(): PathsInfo {
  const config = loadPathsConfig();
  const artefactsPath = getArtefactsDir();
  const templatesPath = getTemplates();
  const havenPath = resolvePlaceholders('${haven}');
  const home = os.homedir();

  const toHomeRelative = (p: string) => {
    if (p.startsWith(home)) {
      return '~' + p.slice(home.length);
    }
    return p;
  };

  const getHavenPath = (key: string, subpath: string) => {
    const custom = resolvePath(key);
    const resolved = custom || path.join(havenPath, subpath);
    const template = custom ? config.paths?.[key] : '${haven}/' + subpath;
    return { template, relative: toHomeRelative(resolved), absolute: resolved };
  };

  const getProjectPath = (key: string) => {
    const configuredPath = config.paths[key] || DEFAULT_PATHS[key];
    const absolute = getPath(key);
    const relative = absolute ? toHomeRelative(absolute) : configuredPath;
    return { template: configuredPath, relative, absolute };
  };

  return {
    toolset: getProjectPath('toolset'),
    stack: getProjectPath('stack'),
    roadmap: getProjectPath('roadmap'),
    postit: getProjectPath('postit'),
    artefacts: getProjectPath('artefacts'),
    memory: getProjectPath('memory'),
    archive: getProjectPath('archive'),
    templates: {
      template: '^/templates',
      relative: config.paths.templates,
      absolute: templatesPath
    },
    prompting: getProjectPath('prompting'),
    components: getProjectPath('components'),
    state: getProjectPath('state'),
    config: getProjectPath('config'),
    haven: {
      template: '${haven}',
      relative: toHomeRelative(havenPath),
      absolute: havenPath
    },
    agents: getHavenPath('agents', 'agents'),
    runs: getHavenPath('runs', 'runs'),
    assignments: getHavenPath('assignments', 'assignments'),
    worktrees: getHavenPath('worktrees', 'worktrees'),
    srtConfig: getHavenPath('srtConfig', 'srt-settings.json')
  };
}

export function getConfigInfo(): ConfigInfo {
  const projectRoot = findProjectRoot();
  const pathsConfigPath = path.join(projectRoot, '.sailing', 'paths.yaml');
  const config = loadPathsConfig();

  const pathsInfo: any = {};
  for (const key of Object.keys(DEFAULT_PATHS)) {
    const configuredPath = config.paths[key];
    const defaultPath = getPathString(DEFAULT_PATHS[key]);
    const isCustom = configuredPath !== defaultPath;
    const isHome = configuredPath?.startsWith('~/') || false;
    const isHaven = configuredPath?.includes('%') || false;
    const absolutePath = getPath(key);

    pathsInfo[key] = {
      path: absolutePath,
      configured: configuredPath,
      type: getPathType(key),
      isCustom,
      isAbsolute: isHome || isHaven || path.isAbsolute(configuredPath || '')
    };
  }

  return {
    projectRoot,
    sailingDir: path.join(projectRoot, '.sailing'),
    pathsConfigPath,
    pathsConfigExists: fs.existsSync(pathsConfigPath),
    cliPath: _scriptDir || import.meta.dirname,
    paths: pathsInfo
  };
}

// ============================================================================
// FILE DISCOVERY
// ============================================================================

export function findPrdDirs(): string[] {
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return [];
  return fs.readdirSync(prdsDir)
    .filter(d => d.startsWith('PRD-'))
    .map(d => path.join(prdsDir, d))
    .filter(d => fs.statSync(d).isDirectory());
}

export function findFiles(dir: string, pattern: RegExp | string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.match(pattern))
    .map(f => path.join(dir, f));
}

// ============================================================================
// FILE I/O
// ============================================================================

export function loadFile<T = Record<string, any>>(filepath: string): LoadedDoc<T> | null {
  if (!fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, 'utf8');
  const { data, body } = parseMarkdown<T>(content);
  return { data, body, filepath };
}

export function saveFile(filepath: string, data: any, body: string): void {
  const content = stringifyMarkdown(data, body);
  fs.writeFileSync(filepath, content);
}

export function loadTemplate(type: string): string | null {
  const templatePath = path.join(getTemplates(), `${type}.md`);
  if (!fs.existsSync(templatePath)) return null;
  return fs.readFileSync(templatePath, 'utf8');
}

export function loadComponents(): any {
  const componentsFile = getComponentsFile();
  if (!fs.existsSync(componentsFile)) return null;
  try {
    const content = fs.readFileSync(componentsFile, 'utf8');
    if (componentsFile.endsWith('.json')) {
      return JSON.parse(content);
    }
    return yaml.load(content);
  } catch (e: any) {
    console.error(`Error loading ${componentsFile}: ${e.message}`);
    return null;
  }
}

export function saveComponents(data: any): void {
  const componentsFile = getComponentsFile();
  let content;
  if (componentsFile.endsWith('.json')) {
    content = JSON.stringify(data, null, 2);
  } else {
    content = yaml.dump(data, { lineWidth: -1 });
  }
  fs.writeFileSync(componentsFile, content);
}

// ============================================================================
// CONFIGURATION SCHEMA
// ============================================================================

/**
 * Configuration Schema - Single source of truth for all config variables.
 * Each variable declares: type, default, description, and valid values (for enums).
 */
export const CONFIG_SCHEMA: Record<string, ConfigSchemaEntry> = {
  'git.main_branch': {
    type: 'string',
    default: 'main',
    description: 'Main branch name (main, master, develop, etc.)'
  },
  'git.sync_before_spawn': {
    type: 'boolean',
    default: true,
    description: 'Auto-sync parent branch from main before spawning task'
  },
  'git.merge_to_main': {
    type: 'enum',
    default: 'squash',
    values: ['squash', 'merge', 'rebase'],
    description: 'Strategy for final merge to main (PRD → main)'
  },
  'git.merge_to_prd': {
    type: 'enum',
    default: 'squash',
    values: ['squash', 'merge', 'rebase'],
    description: 'Strategy for merge to PRD branch (epic/task → prd)'
  },
  'git.merge_to_epic': {
    type: 'enum',
    default: 'merge',
    values: ['squash', 'merge', 'rebase'],
    description: 'Strategy for merge to epic branch (task → epic)'
  },
  'git.squash_level': {
    type: 'enum',
    default: 'prd',
    values: ['task', 'epic', 'prd'],
    description: 'At which level commits appear in main (task=all, prd=1 per PRD)'
  },
  'agent.use_subprocess': {
    type: 'boolean',
    default: false,
    description: 'Spawn Claude as subprocess (vs manual execution)'
  },
  'agent.use_worktrees': {
    type: 'boolean',
    default: false,
    description: 'Worktree isolation for parallel agents'
  },
  'agent.risky_mode': {
    type: 'boolean',
    default: true,
    description: 'Skip permission prompts (--dangerously-skip-permissions)'
  },
  'agent.sandbox': {
    type: 'boolean',
    default: false,
    description: 'Wrap agents with srt (sandbox-runtime, requires setup)'
  },
  'agent.timeout': {
    type: 'number',
    default: 3600,
    description: 'Agent timeout in seconds (0 = no timeout)'
  },
  'agent.merge_strategy': {
    type: 'enum',
    default: 'merge',
    values: ['merge', 'squash', 'rebase'],
    description: 'Git merge strategy for worktree changes'
  },
  'agent.model': {
    type: 'enum',
    default: 'sonnet',
    values: ['sonnet', 'opus', 'haiku'],
    description: 'Default Claude model for agents'
  },
  'agent.max_parallel': {
    type: 'number',
    default: 6,
    description: 'Maximum parallel agents (0 = unlimited)'
  },
  'agent.auto_merge': {
    type: 'boolean',
    default: false,
    description: 'Auto-merge worktree changes on task completion (local)'
  },
  'agent.auto_pr': {
    type: 'boolean',
    default: false,
    description: 'Auto-create PR/MR when agent completes successfully (WIP)'
  },
  'agent.pr_draft': {
    type: 'boolean',
    default: false,
    description: 'Create PRs as drafts by default'
  },
  'agent.pr_provider': {
    type: 'enum',
    default: 'auto',
    values: ['auto', 'github', 'gitlab'],
    description: 'PR provider (auto detects from git remote)'
  },
  'agent.mcp_mode': {
    type: 'enum',
    default: 'socket',
    values: ['socket', 'port'],
    description: 'MCP transport: socket (Unix socket) or port (TCP, required for Linux sandbox)'
  },
  'agent.mcp_port_range': {
    type: 'string',
    default: '9100-9199',
    description: 'Port range for MCP TCP mode (e.g., 9100-9199)'
  },
  'agent.max_budget_usd': {
    type: 'relative-integer',
    default: -1,
    description: 'Max budget per agent in USD (-1 = no limit)'
  },
  'agent.watchdog_timeout': {
    type: 'number',
    default: 300,
    description: 'Kill agent if no output for N seconds (0 = disabled)'
  },
  'agent.auto_diagnose': {
    type: 'boolean',
    default: true,
    description: 'Auto-run diagnostic after agent completes to detect sandbox issues'
  },
  'output.color': {
    type: 'boolean',
    default: true,
    description: 'Enable colored output'
  },
  'output.verbose': {
    type: 'number',
    default: 0,
    description: 'Verbosity level (0=normal, 1=verbose, 2=debug)'
  },
  'logging.level': {
    type: 'enum',
    default: 'info',
    values: ['debug', 'info', 'warn', 'error'],
    description: 'Minimum log level for task logs'
  },
  'ids.prd_digits': {
    type: 'number',
    default: 3,
    description: 'Number of digits for PRD IDs (PRD-001)'
  },
  'ids.epic_digits': {
    type: 'number',
    default: 3,
    description: 'Number of digits for Epic IDs (E001)'
  },
  'ids.task_digits': {
    type: 'number',
    default: 3,
    description: 'Number of digits for Task IDs (T001)'
  },
  'ids.story_digits': {
    type: 'number',
    default: 3,
    description: 'Number of digits for Story IDs (S001)'
  },
  'task.default_duration': {
    type: 'string',
    default: '1h',
    description: 'Default task duration when effort is not specified (e.g., 1h, 2h, 4h)'
  },
  'task.effort_map': {
    type: 'string',
    default: 'S=0.5h,M=1h,L=2h,XL=4h',
    description: 'Mapping of legacy T-shirt sizes to hours (for backward compatibility)'
  }
};

/**
 * Build DEFAULTS object from schema
 */
function buildConfigDefaults(): SailingConfig {
  const defaults: any = {};
  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    const parts = key.split('.');
    let obj = defaults;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = schema.default;
  }
  return defaults as SailingConfig;
}

const CONFIG_DEFAULTS = buildConfigDefaults();

// Config cached state
let _sailingConfig: SailingConfig | null = null;

// CLI overrides (set via --with-config flag)
let _configOverrides: Record<string, any> = {};

// ============================================================================
// CONFIG OVERRIDES
// ============================================================================

/**
 * Set config overrides from CLI flag
 * Called very early in rudder.ts before any config is loaded
 * @experimental This is an experimental feature
 */
export function setConfigOverrides(overrides: Record<string, any>): void {
  _configOverrides = { ..._configOverrides, ...overrides };
  _sailingConfig = null;
}

/**
 * Parse a config override string: "key=value"
 * Handles type coercion based on schema
 */
export function parseConfigOverride(override: string): { key: string; value: any } | null {
  const match = override.match(/^([^=]+)=(.*)$/);
  if (!match) {
    console.error(`Invalid config override format: ${override}`);
    console.error(`Expected: key=value (e.g., agent.use_subprocess=true)`);
    return null;
  }

  const [, key, rawValue] = match;
  const schema = CONFIG_SCHEMA[key];

  if (!schema) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Available keys: ${Object.keys(CONFIG_SCHEMA).join(', ')}`);
    return null;
  }

  // Coerce value based on schema type
  let value: any = rawValue;
  switch (schema.type) {
    case 'boolean':
      value = rawValue.toLowerCase() === 'true' || rawValue === '1';
      break;
    case 'number':
    case 'relative-integer':
      value = parseInt(rawValue, 10);
      if (isNaN(value)) {
        console.error(`Invalid number for ${key}: ${rawValue}`);
        return null;
      }
      break;
    case 'enum':
      if (schema.values && !schema.values.includes(rawValue)) {
        console.error(`Invalid value for ${key}: ${rawValue}`);
        console.error(`Valid values: ${schema.values.join(', ')}`);
        return null;
      }
      break;
    // string: use as-is
  }

  return { key, value };
}

// ============================================================================
// CONFIG NESTED ACCESS
// ============================================================================

/**
 * Get nested value from object using dot notation
 */
export function getNestedValue(obj: any, key: string): any {
  const parts = key.split('.');
  let value = obj;
  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    value = value[part];
  }
  return value;
}

/**
 * Set nested value in object using dot notation
 */
function setNestedValue(obj: any, key: string, value: any): void {
  const parts = key.split('.');
  let target = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!target[parts[i]]) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
}

/**
 * Deep merge objects
 */
function deepMerge(target: any, source: any): any {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

// ============================================================================
// CONFIG LOADING & VALIDATION
// ============================================================================

/**
 * Get config file path
 */
export function getConfigPath(): string {
  return getConfigFile();
}

/**
 * Load configuration from file
 * Merges with defaults, validates values, applies CLI overrides
 */
export function loadConfig(): SailingConfig {
  if (_sailingConfig) return _sailingConfig;

  const configPath = getConfigPath();
  let userConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      userConfig = yaml.load(content) || {};
    } catch (e: any) {
      console.error(`Warning: Could not parse config.yaml: ${e.message}`);
    }
  }

  // Deep merge with defaults
  _sailingConfig = deepMerge(CONFIG_DEFAULTS, userConfig) as SailingConfig;

  // Apply CLI overrides (--with-config flag)
  if (Object.keys(_configOverrides).length > 0) {
    for (const [key, value] of Object.entries(_configOverrides)) {
      setNestedValue(_sailingConfig, key, value);
    }
  }

  // Validate
  validateConfig(_sailingConfig);

  return _sailingConfig;
}

/**
 * Validate configuration values against schema
 */
function validateConfig(config: any): void {
  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    const value = getNestedValue(config, key);
    if (value === undefined) continue;

    switch (schema.type) {
      case 'boolean':
        if (typeof value !== 'boolean') {
          console.error(`Warning: ${key} should be boolean, got ${typeof value}`);
          setNestedValue(config, key, schema.default);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || value < 0) {
          console.error(`Warning: ${key} should be positive number, got ${value}`);
          setNestedValue(config, key, schema.default);
        }
        break;
      case 'relative-integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          console.error(`Warning: ${key} should be integer, got ${value}`);
          setNestedValue(config, key, schema.default);
        }
        break;
      case 'string':
        if (typeof value !== 'string' || value.trim() === '') {
          console.error(`Warning: ${key} should be non-empty string, got ${typeof value}`);
          setNestedValue(config, key, schema.default);
        }
        break;
      case 'enum':
        if (schema.values && !schema.values.includes(value)) {
          console.error(`Warning: Invalid ${key} '${value}'. Valid: ${schema.values.join(', ')}`);
          setNestedValue(config, key, schema.default);
        }
        break;
    }
  }
}

/**
 * Clear config cache (for testing or after config changes)
 */
export function clearConfigCache(): void {
  _sailingConfig = null;
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

/**
 * Get default configuration
 */
export function getConfigDefaults(): SailingConfig {
  return JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
}

/**
 * Get config schema (for documentation/tooling)
 */
export function getConfigSchema(): ConfigSchema {
  return CONFIG_SCHEMA;
}

// ============================================================================
// SEMANTIC CONFIG ACCESSORS
// ============================================================================

/**
 * Get agent configuration section
 */
export function getAgentConfig(): SailingConfig['agent'] {
  const config = loadConfig();
  return config.agent;
}

/**
 * Get git configuration section
 */
export function getGitConfig(): SailingConfig['git'] {
  const config = loadConfig();
  return config.git;
}

/**
 * Get configured main branch name
 */
export function getMainBranch(): string {
  try {
    const gitConfig = getGitConfig();
    return gitConfig?.main_branch || 'main';
  } catch {
    return 'main';
  }
}

/**
 * Get IDs configuration section
 */
export function getIdsConfig(): SailingConfig['ids'] {
  const config = loadConfig();
  return config.ids;
}

/**
 * Get a specific config value by dot-notation key
 * @param key - Dot-notation key (e.g., 'agent.timeout')
 */
export function getConfigValue<T = any>(key: string): T {
  const config = loadConfig();
  return getNestedValue(config, key) as T;
}

/**
 * Get digit configuration from config
 */
export function getDigitConfig() {
  const ids = getIdsConfig();
  return {
    prd: ids.prd_digits,
    epic: ids.epic_digits,
    task: ids.task_digits,
    story: ids.story_digits
  };
}

/**
 * Format an ID with configured digits (config-aware wrapper)
 * @param prefix - 'PRD-', 'E', 'T', or 'S'
 * @param num - The numeric part
 * @returns Formatted ID (e.g., 'T001')
 */
export function formatId(prefix: string, num: number): string {
  return formatIdFrom(prefix, num, getDigitConfig());
}

/**
 * Validate config coherence (early boot check)
 * use_worktrees is the master config
 *
 * Rules:
 *   1. use_subprocess must equal use_worktrees (master)
 *   2. if use_subprocess=true → sandbox must be true (no subprocess without sandbox yet)
 *   3. if use_subprocess=false → sandbox is ignored
 *
 * @returns Error message if incoherent, null if OK
 */
export function validateConfigCoherence(): string | null {
  const config = loadConfig();
  const { use_worktrees, use_subprocess, sandbox } = config.agent;
  const errors: string[] = [];
  const fixes: string[] = [];

  // Rule 1: use_subprocess must follow use_worktrees
  if (use_worktrees !== use_subprocess) {
    errors.push(`agent.use_subprocess=${use_subprocess} (should be ${use_worktrees})`);
    fixes.push(`rudder config:set agent.use_subprocess ${use_worktrees}`);
  }

  // Rule 2: if subprocess mode, sandbox is required
  if (use_subprocess && !sandbox) {
    errors.push(`agent.sandbox=${sandbox} (must be true when use_subprocess=true)`);
    fixes.push(`rudder config:set agent.sandbox true`);
  }

  if (errors.length > 0) {
    return `agent.use_worktrees=${use_worktrees} but:\n` +
           errors.map(e => `   - ${e}`).join('\n') + '\n\n' +
           `   use_worktrees is the master setting.\n\n` +
           `   Fix:\n   ${fixes.join('\n   ')}`;
  }

  return null;
}

/**
 * Get all config values with schema info for display
 * Returns array of { key, value, default, description, type, values?, isDefault }
 */
export function getConfigDisplay(): ConfigDisplayItem[] {
  const config = loadConfig();
  const result: ConfigDisplayItem[] = [];

  for (const [key, schema] of Object.entries(CONFIG_SCHEMA)) {
    const value = getNestedValue(config, key);
    result.push({
      key,
      value,
      default: schema.default,
      description: schema.description,
      type: schema.type,
      values: schema.values,
      isDefault: value === schema.default
    });
  }

  return result;
}
