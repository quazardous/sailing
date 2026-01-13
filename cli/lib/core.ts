/**
 * Core file operations and utilities for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import yaml from 'js-yaml';
import { resolvePlaceholders, resolvePath } from './paths.js';
import type { PathsInfo, ConfigInfo } from './types/config.js';

export interface LoadedDoc<T = Record<string, any>> {
  data: T;
  body: string;
  filepath: string;
}

/**
 * Expand special path prefixes:
 *   ~  → home directory
 *   ^  → sailing repo root (devinstall mode only)
 *
 * Examples:
 *   ~/data     → /home/user/data
 *   ^/core     → /path/to/sailing-repo/core (devinstall mode)
 *   ./local    → ./local (unchanged, resolved later)
 */
function expandPath(p: string): string {
  // ~ → home directory
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p === '~') {
    return os.homedir();
  }

  // ^ → sailing repo root (only in devinstall mode)
  if (p.startsWith('^/') || p === '^') {
    const repoRoot = getRepoRoot();
    if (repoRoot) {
      return p === '^' ? repoRoot : path.join(repoRoot, p.slice(2));
    }
    console.error(`Warning: ^/ prefix only works in devinstall mode`);
    console.error(`  Path "${p}" will be treated as relative to project root`);
    return p.replace(/^\^/, '.');
  }

  return p;
}

// Legacy alias
const expandHome = expandPath;

/**
 * Default paths configuration
 *
 * Each path has: { path, type }
 * - type: 'dir' | 'file'
 * - path: default value (relative to project or using %placeholder%)
 *
 * Path prefixes:
 *   (none)   → relative to project root
 *   ${haven}  → haven directory (~/.sailing/havens/<hash>)
 *   ~/       → home directory
 *   ^/       → sailing repo root (devinstall only)
 */
const DEFAULT_PATHS: Record<string, { path: string; type: 'dir' | 'file' }> = {
  // Project directories
  artefacts:  { path: '.sailing/artefacts', type: 'dir' },
  memory:     { path: '.sailing/memory', type: 'dir' },
  archive:    { path: '.sailing/archive', type: 'dir' },
  templates:  { path: '.sailing/templates', type: 'dir' },
  prompting:  { path: '.sailing/prompting', type: 'dir' },

  // Project files
  state:      { path: '.sailing/state.json', type: 'file' },
  config:     { path: '.sailing/config.yaml', type: 'file' },
  components: { path: '.sailing/components.yaml', type: 'file' },

  // Project-centric files (convention, overridable)
  toolset:    { path: '.claude/TOOLSET.md', type: 'file' },
  stack:      { path: 'STACK.md', type: 'file' },
  roadmap:    { path: '.sailing/artefacts/ROADMAP.md', type: 'file' },
  postit:     { path: '.sailing/artefacts/POSTIT.md', type: 'file' },

  // Haven directories (per-project isolation outside project root)
  haven:        { path: '${haven}', type: 'dir' },
  agents:       { path: '${haven}/agents', type: 'dir' },
  worktrees:    { path: '${haven}/worktrees', type: 'dir' },
  runs:         { path: '${haven}/runs', type: 'dir' },
  assignments:  { path: '${haven}/assignments', type: 'dir' },
  srtConfig:    { path: '${haven}/srt-settings.json', type: 'file' }
};

// Cached config
let _config: any = null;
let _projectRoot: string | null = null;
let _scriptDir: string | null = null;
let _repoRoot: string | null | undefined = undefined; // undefined = not computed yet

// CLI path overrides (set via --with-path flag)
// Format: { 'artefacts': '/custom/path', ... }
let _pathOverrides: Record<string, string> = {};

/**
 * Set path overrides from CLI flag
 * Called very early in rudder.ts before any paths are loaded
 * @experimental This is an experimental feature
 */
export function setPathOverrides(overrides: Record<string, string>): void {
  _pathOverrides = { ..._pathOverrides, ...overrides };
  // Invalidate cache so next loadPathsConfig() picks up overrides
  _config = null;
}

/**
 * Parse a path override string: "key=value"
 * Validates key against DEFAULT_PATHS
 */
export function parsePathOverride(override: string): { key: string; value: string } | null {
  const match = override.match(/^([^=]+)=(.*)$/);
  if (!match) {
    console.error(`Invalid path override format: ${override}`);
    console.error(`Expected: key=value (e.g., artefacts=/custom/path)`);
    return null;
  }

  const [, key, value] = match;

  // Validate key exists in DEFAULT_PATHS
  if (!DEFAULT_PATHS[key]) {
    console.error(`Unknown path key: ${key}`);
    console.error(`Available keys: ${Object.keys(DEFAULT_PATHS).join(', ')}`);
    return null;
  }

  // Value can be any path (relative, absolute, with placeholders)
  if (!value) {
    console.error(`Empty value for path key: ${key}`);
    return null;
  }

  return { key, value };
}

/**
 * Set the script directory (called from rudder.js)
 * This is used as the starting point to find project root in normal mode
 */
export function setScriptDir(dir: string) {
  _scriptDir = dir;
}

// Magic marker file to identify sailing repo root
const REPO_MAGIC_FILE = '.sailing-repo';
const REPO_MAGIC_CONTENT = 'kaizoku-ou-ni-ore-wa-naru';

/**
 * Get sailing repo root (devinstall mode only)
 *
 * Looks for .sailing-repo magic file in parent directories.
 * Returns null if not in devinstall mode.
 */
export function getRepoRoot(): string | null {
  if (_repoRoot !== undefined) return _repoRoot;

  const startDir = _scriptDir || import.meta.dirname;
  if (!startDir) {
    _repoRoot = null;
    return null;
  }

  // Walk up looking for magic file (max 5 levels)
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
      } catch {
        // Ignore read errors
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Not in devinstall mode
  _repoRoot = null;
  return null;
}

/**
 * Set project root explicitly (for dev mode with --root or SAILING_PROJECT)
 */
export function setProjectRoot(dir: string) {
  _projectRoot = dir;
  _config = null; // Reset config cache
}

/**
 * Find project root by looking for .sailing/ directory
 *
 * Priority:
 * 1. Explicit root set via setProjectRoot() (--root flag or SAILING_PROJECT env)
 * 2. Walk up from script directory (normal installed mode)
 *    - In installed mode, script is at <project>/.sailing/rudder/cli/rudder.js
 *    - Walking up finds .sailing/ and returns its parent
 * 3. Walk up from current directory (fallback)
 *
 * This allows rudder to be called from anywhere (absolute path, symlink, PATH)
 * and still find the correct project.
 */
export function findProjectRoot(): string {
  if (_projectRoot) return _projectRoot;

  // Start from script directory if available
  // _scriptDir is set by rudder.js to import.meta.dirname (= cli/ directory)
  // We also try import.meta.dirname of this file (= cli/lib/) as fallback
  const startDir = _scriptDir || import.meta.dirname;

  if (startDir) {
    let dir = startDir;
    while (dir !== path.dirname(dir)) {
      // Check if we're inside a .sailing directory
      if (path.basename(dir) === '.sailing') {
        // Found .sailing, return its parent (the project root)
        _projectRoot = path.dirname(dir);
        return _projectRoot;
      }
      // Also check if .sailing exists as a child (for dev mode from repo root)
      if (fs.existsSync(path.join(dir, '.sailing'))) {
        _projectRoot = dir;
        return dir;
      }
      dir = path.dirname(dir);
    }
  }

  // Fallback: try from cwd
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.sailing'))) {
      _projectRoot = dir;
      return dir;
    }
    dir = path.dirname(dir);
  }

  // Last fallback: use current directory (will likely fail but gives clear error)
  _projectRoot = process.cwd();
  return _projectRoot;
}

/**
 * Helper: extract path string from DEFAULT_PATHS entry or user config
 * Handles both old format (string) and new format ({ path, type })
 */
function getPathString(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.path) return value.path;
  return null;
}

/**
 * Helper: get path type from DEFAULT_PATHS
 */
export function getPathType(key: string): 'dir' | 'file' {
  const def = DEFAULT_PATHS[key];
  if (def && typeof def === 'object') return def.type;
  return 'dir'; // Default to dir for backward compatibility
}

/**
 * Load paths configuration from .sailing/paths.yaml
 * Falls back to defaults if not found
 */
export function loadPathsConfig(): any {
  if (_config) return _config;

  const projectRoot = findProjectRoot();
  const pathsConfigPath = path.join(projectRoot, '.sailing', 'paths.yaml');

  // Build default paths (extract path strings)
  const defaultPaths: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(DEFAULT_PATHS)) {
    defaultPaths[key] = getPathString(value);
  }

  if (fs.existsSync(pathsConfigPath)) {
    try {
      const content = fs.readFileSync(pathsConfigPath, 'utf8');
      const parsed = yaml.load(content) as any;
      _config = {
        paths: { ...defaultPaths, ...(parsed.paths || {}) }
      };
    } catch (e) {
      console.error(`Warning: Could not parse ${pathsConfigPath}, using defaults`);
      _config = { paths: defaultPaths };
    }
  } else {
    _config = { paths: defaultPaths };
  }

  // Apply CLI path overrides (--with-path flag)
  if (Object.keys(_pathOverrides).length > 0) {
    _config.paths = { ..._config.paths, ..._pathOverrides };
  }

  return _config;
}

/**
 * Get absolute path for a configured path key
 *
 * RULE: Relative paths are ALWAYS resolved from PROJECT ROOT, never from CLI location.
 *
 * Prefixes:
 *   (none)     → relative to project root
 *   /          → absolute path
 *   ~/         → home directory
 *   ^/         → sailing repo root (devinstall mode only)
 *   ${haven}    → per-project haven directory
 *   ${home}     → home directory
 *   ${project}  → project root
 */
export function getPath(key: string): string | null {
  const config = loadPathsConfig();
  const projectRoot = findProjectRoot();

  // Get configured path or default (handle object format)
  let configuredPath = config.paths[key];
  if (!configuredPath) {
    const def = DEFAULT_PATHS[key];
    configuredPath = getPathString(def);
  }

  if (!configuredPath) return null;

  // Handle ${placeholder} paths first
  if (configuredPath.includes('${')) {
    return resolvePlaceholders(configuredPath);
  }

  // Expand special prefixes (~, ^)
  const expanded = expandPath(configuredPath);

  // If path is absolute (after expansion), use it directly
  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  // Relative paths: ALWAYS resolve from project root
  return path.join(projectRoot, expanded);
}

// Dynamic directory getters
export function getSailingDir() {
  return path.join(findProjectRoot(), '.sailing');
}

export function getArtefactsDir() {
  return getPath('artefacts')!;
}

export function getPrdsDir() {
  return path.join(getArtefactsDir(), 'prds');
}

export function getMemoryDir() {
  return getPath('memory')!;
}

export function getArchiveDir() {
  return getPath('archive')!;
}

export function getTemplatesDir() {
  return getPath('templates')!;
}

export function getPromptingDir() {
  return getPath('prompting')!;
}

export function getStateFile() {
  return getPath('state')!;
}

export function getConfigFile() {
  return getPath('config')!;
}

export function getComponentsFile() {
  return getPath('components')!;
}

// Haven-based paths (outside project root)
export function getAgentsDir() {
  return getPath('agents')!;
}

export function getWorktreesDir() {
  return getPath('worktrees')!;
}

export function getRunsDir() {
  return getPath('runs')!;
}

export function getAssignmentsDir() {
  return getPath('assignments')!;
}

// Legacy exports for backward compatibility
export const PROJECT_ROOT = findProjectRoot();

/**
 * Check if running in devinstall mode
 * Devinstall mode: CLI is run from the sailing maintenance repo itself
 * (not installed in a project's .sailing/rudder/)
 */
export function isDevInstall() {
  // _scriptDir is set by rudder.js to cli/ directory
  // import.meta.dirname here is cli/lib/
  // To find repo root: from cli/ go up 1, from cli/lib/ go up 2
  const repoRoot = _scriptDir
    ? path.resolve(_scriptDir, '..')
    : path.resolve(import.meta.dirname, '../..');

  return fs.existsSync(path.join(repoRoot, 'prompting')) &&
         fs.existsSync(path.join(repoRoot, 'cli')) &&
         fs.existsSync(path.join(repoRoot, 'install.sh'));
}

/**
 * Get the sailing repo root (only valid in devinstall mode)
 */
export function getSailingRepoRoot() {
  // Same logic as isDevInstall
  return _scriptDir
    ? path.resolve(_scriptDir, '..')
    : path.resolve(import.meta.dirname, '../..');
}

/**
 * Get prompting directory
 * In devinstall mode: <sailing-repo>/prompting/
 * In normal mode: paths.prompting (default: .sailing/prompting/)
 */
export function getPrompting() {
  if (isDevInstall()) {
    return path.join(getSailingRepoRoot(), 'prompting');
  }
  return getPromptingDir();
}

/**
 * Get templates directory
 * In devinstall mode: <sailing-repo>/templates/
 * In normal mode: paths.templates (default: .sailing/templates/)
 */
export function getTemplates() {
  if (isDevInstall()) {
    return path.join(getSailingRepoRoot(), 'templates');
  }
  return getTemplatesDir();
}

/**
 * Get paths info for agents (authoritative source)
 * Only exposes paths that agents need to know
 */
export function getPathsInfo(): PathsInfo {
  const config = loadPathsConfig();
  const artefactsPath = getArtefactsDir();
  const templatesPath = getTemplates();
  const componentsPath = getComponentsFile();

  // Resolve haven base path
  const havenPath = resolvePlaceholders('${haven}');
  const home = os.homedir();

  // Helper to make path relative to home (~/...) 
  const toHomeRelative = (p: string) => {
    if (p.startsWith(home)) {
      return '~' + p.slice(home.length);
    }
    return p;
  };

  // Helper for haven-based paths with override support
  const getHavenPath = (key: string, subpath: string) => {
    const custom = resolvePath(key);
    const resolved = custom || path.join(havenPath, subpath);
    const template = custom ? config.paths?.[key] : '${haven}/' + subpath;
    return {
      template,
      relative: toHomeRelative(resolved),
      absolute: resolved
    };
  };

  // Helper for project-relative paths
  const getProjectPath = (key: string) => {
    const configuredPath = config.paths[key] || DEFAULT_PATHS[key];
    const absolute = getPath(key);
    // Resolve placeholders for display, make relative to home if applicable
    const relative = absolute ? toHomeRelative(absolute) : configuredPath;
    return {
      template: configuredPath,
      relative,
      absolute
    };
  };

  return {
    // Project-centric files (convention, overridable via paths.yaml)
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
    // Haven-based paths (with override support)
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

/**
 * Get configuration info for display
 */
export function getConfigInfo(): ConfigInfo {
  const projectRoot = findProjectRoot();
  const pathsConfigPath = path.join(projectRoot, '.sailing', 'paths.yaml');
  const config = loadPathsConfig();

  // Determine which paths are custom vs default
  const pathsInfo: any = {};
  for (const key of Object.keys(DEFAULT_PATHS)) {
    const configuredPath = config.paths[key];
    const defaultPath = getPathString(DEFAULT_PATHS[key]);
    const isCustom = configuredPath !== defaultPath;
    const isHome = configuredPath?.startsWith('~/') || false;
    const isHaven = configuredPath?.includes('%') || false;

    // Get absolute path using getPath (handles all prefixes)
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

// Output helpers
export const jsonOut = (data: any) => console.log(JSON.stringify(data, null, 2));

/**
 * Find all PRD directories
 */
export function findPrdDirs() {
  const prdsDir = getPrdsDir();
  if (!fs.existsSync(prdsDir)) return [];
  return fs.readdirSync(prdsDir)
    .filter(d => d.startsWith('PRD-'))
    .map(d => path.join(prdsDir, d))
    .filter(d => fs.statSync(d).isDirectory());
}

/**
 * Find files in a directory matching a pattern
 */
export function findFiles(dir: string, pattern: RegExp | string) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.match(pattern))
    .map(f => path.join(dir, f));
}

/**
 * Load a markdown file with frontmatter
 */
export function loadFile<T = Record<string, any>>(filepath: string): LoadedDoc<T> | null {
  if (!fs.existsSync(filepath)) return null;
  const content = fs.readFileSync(filepath, 'utf8');
  const { data, content: body } = matter(content);

  // Fallback: parse markdown headers if no frontmatter
  if (Object.keys(data).length === 0) {
    // Extract title from # heading
    const titleMatch = body.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      const fullTitle = titleMatch[1];
      // Parse "T001: Title" or "PRD-001: Title" format
      const idMatch = fullTitle.match(/^([A-Z]+-?\d+):\s*(.*)$/);
      if (idMatch) {
        data.id = idMatch[1];
        data.title = idMatch[2];
      } else {
        data.title = fullTitle;
      }
    }

    // Extract status from ## Status section
    const statusMatch = body.match(/^## Status\s*\n+([^\n#]+)/m);
    if (statusMatch) {
      data.status = statusMatch[1].trim().split(/\s*\|\s*/)[0].trim();
    }

    // Extract parent from ## Parent section
    const parentMatch = body.match(/^## Parent\s*\n+([^\n#]+)/m);
    if (parentMatch) {
      data.parent = parentMatch[1].trim();
    }

    // Extract assignee from ## Assignee section
    const assigneeMatch = body.match(/^## Assignee\s*\n+([^\n#]+)/m);
    if (assigneeMatch) {
      data.assignee = assigneeMatch[1].trim();
    }

    // Extract blocked_by from ## Blocked By section
    const blockedMatch = body.match(/^## Blocked By\s*\n+([\s\S]*?)(?=\n##|\n*$)/m);
    if (blockedMatch) {
      const blockedText = blockedMatch[1].trim();
      if (blockedText === '- None' || blockedText === 'None' || blockedText === '') {
        data.blocked_by = [];
      } else {
        data.blocked_by = blockedText.split('\n')
          .map(l => l.replace(/^-\s*/, '').trim())
          .filter(l => l && l !== 'None');
      }
    } else {
      data.blocked_by = [];
    }
  }

  return { data: data as T, body, filepath };
}

/**
 * Save a markdown file with frontmatter
 */
export function saveFile(filepath: string, data: any, body: string) {
  // Ensure body starts with blank line for readability
  const cleanBody = body.startsWith('\n') ? body : '\n' + body;
  const content = matter.stringify(cleanBody, data);
  fs.writeFileSync(filepath, content);
}

/**
 * Convert string to kebab-case
 */
export function toKebab(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Load a template file
 */
export function loadTemplate(type: string) {
  const templatePath = path.join(getTemplates(), `${type}.md`);
  if (!fs.existsSync(templatePath)) return null;
  return fs.readFileSync(templatePath, 'utf8');
}

/**
 * Load components configuration (YAML or JSON)
 */
export function loadComponents() {
  const componentsFile = getComponentsFile();
  if (!fs.existsSync(componentsFile)) return null;
  try {
    const content = fs.readFileSync(componentsFile, 'utf8');
    // Support both JSON and YAML
    if (componentsFile.endsWith('.json')) {
      return JSON.parse(content);
    }
    return yaml.load(content);
  } catch (e) {
    console.error(`Error loading ${componentsFile}: ${e.message}`);
    return null;
  }
}

/**
 * Save components configuration (YAML or JSON based on file extension)
 */
export function saveComponents(data: any) {
  const componentsFile = getComponentsFile();
  let content;
  if (componentsFile.endsWith('.json')) {
    content = JSON.stringify(data, null, 2);
  } else {
    content = yaml.dump(data, { lineWidth: -1 });
  }
  fs.writeFileSync(componentsFile, content);
}

/**
 * Strip HTML comments from markdown content
 * Removes <!-- ... --> (single and multi-line)
 * Also removes # comments from YAML frontmatter
 */
export function stripComments(content: string) {
  // Split frontmatter and body
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    // No frontmatter, just strip HTML comments from body
    return content
      .replace(/<!--[\s\S]*?-->\n?/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const [, frontmatter, body] = match;

  // Strip # comments from frontmatter (but keep values with # in them)
  const cleanFrontmatter = frontmatter
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .map(line => line.replace(/\s+#\s+.*$/, ''))
    .join('\n');

  // Strip HTML comments from body and clean up extra blank lines
  const cleanBody = body
    .replace(/<!--[\s\S]*?-->\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return `---\n${cleanFrontmatter}\n---\n\n${cleanBody}`;
}