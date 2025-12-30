/**
 * Core file operations and utilities for rudder CLI
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import yaml from 'js-yaml';

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
function expandPath(p) {
  // ~ → home directory
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p === '~') {
    return os.homedir();
  }

  // ^ → sailing repo root (only in devinstall mode)
  if (p.startsWith('^/') || p === '^') {
    // Lazy check for devinstall mode
    const repoRoot = _scriptDir
      ? path.resolve(_scriptDir, '..')
      : path.resolve(import.meta.dirname, '../..');

    const hasPrompting = fs.existsSync(path.join(repoRoot, 'prompting'));
    const hasCli = fs.existsSync(path.join(repoRoot, 'cli'));
    const hasInstall = fs.existsSync(path.join(repoRoot, 'install.sh'));

    if (hasPrompting && hasCli && hasInstall) {
      // Devinstall mode confirmed
      if (p === '^') return repoRoot;
      return path.join(repoRoot, p.slice(2));
    } else {
      // Not in devinstall mode - warn and fall back
      console.error(`Warning: ^/ prefix only works in devinstall mode`);
      console.error(`  Path "${p}" will be treated as relative to project root`);
      return p.replace(/^\^/, '.');
    }
  }

  return p;
}

// Legacy alias
const expandHome = expandPath;

// Default paths (relative to project root)
// Note: devinstall.sh should set prompting: ^/prompting in paths.yaml
const DEFAULT_PATHS = {
  artefacts: '.sailing/artefacts',
  memory: '.sailing/memory',
  templates: '.sailing/templates',
  prompting: '.sailing/prompting',
  rudder: '.sailing/rudder',
  state: '.sailing/state.json',
  components: '.sailing/components.yaml',
  skill: '.claude/skills/sailing',
  commands: '.claude/commands/dev'
};

// Cached config
let _config = null;
let _projectRoot = null;
let _scriptDir = null;

/**
 * Set the script directory (called from rudder.js)
 * This is used as the starting point to find project root in normal mode
 */
export function setScriptDir(dir) {
  _scriptDir = dir;
}

/**
 * Set project root explicitly (for dev mode with --root or SAILING_PROJECT)
 */
export function setProjectRoot(dir) {
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
export function findProjectRoot() {
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
 * Load configuration from .sailing/paths.yaml
 * Falls back to defaults if not found
 */
export function loadConfig() {
  if (_config) return _config;

  const projectRoot = findProjectRoot();
  const pathsConfigPath = path.join(projectRoot, '.sailing', 'paths.yaml');

  if (fs.existsSync(pathsConfigPath)) {
    try {
      const content = fs.readFileSync(pathsConfigPath, 'utf8');
      const parsed = yaml.load(content);
      _config = {
        paths: { ...DEFAULT_PATHS, ...(parsed.paths || {}) }
      };
    } catch (e) {
      console.error(`Warning: Could not parse ${pathsConfigPath}, using defaults`);
      _config = { paths: DEFAULT_PATHS };
    }
  } else {
    _config = { paths: DEFAULT_PATHS };
  }

  return _config;
}

/**
 * Get absolute path for a configured path key
 *
 * RULE: Relative paths are ALWAYS resolved from PROJECT ROOT, never from CLI location.
 *
 * Prefixes:
 *   (none)  → relative to project root
 *   /       → absolute path
 *   ~/      → home directory
 *   ^/      → sailing repo root (devinstall mode only)
 */
export function getPath(key) {
  const config = loadConfig();
  const projectRoot = findProjectRoot();
  const configuredPath = config.paths[key] || DEFAULT_PATHS[key];

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
  return getPath('artefacts');
}

export function getPrdsDir() {
  return path.join(getArtefactsDir(), 'prds');
}

export function getMemoryDir() {
  return getPath('memory');
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

export function getComponentsFile() {
  return getPath('components');
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
export function getPathsInfo() {
  const config = loadConfig();
  const artefactsPath = getArtefactsDir();
  const templatesPath = getTemplates();

  return {
    roadmap: {
      relative: config.paths.artefacts + '/ROADMAP.md',
      absolute: path.join(artefactsPath, 'ROADMAP.md')
    },
    postit: {
      relative: config.paths.artefacts + '/POSTIT.md',
      absolute: path.join(artefactsPath, 'POSTIT.md')
    },
    artefacts: {
      relative: config.paths.artefacts,
      absolute: artefactsPath
    },
    templates: {
      relative: config.paths.templates,
      absolute: templatesPath
    }
  };
}

/**
 * Get configuration info for display
 */
export function getConfigInfo() {
  const projectRoot = findProjectRoot();
  const pathsConfigPath = path.join(projectRoot, '.sailing', 'paths.yaml');
  const config = loadConfig();

  // Determine which paths are custom vs default
  const pathsInfo = {};
  for (const key of Object.keys(DEFAULT_PATHS)) {
    const configuredPath = config.paths[key];
    const isCustom = configuredPath !== DEFAULT_PATHS[key];
    const isHome = configuredPath.startsWith('~/');

    // Expand ~ and compute absolute path
    const expanded = expandHome(configuredPath);
    const isAbsolute = path.isAbsolute(expanded);
    const absolutePath = isAbsolute ? expanded : path.join(projectRoot, expanded);

    pathsInfo[key] = {
      path: absolutePath,
      configured: configuredPath,
      isCustom,
      isAbsolute: isAbsolute || isHome
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
export const jsonOut = (data) => console.log(JSON.stringify(data, null, 2));

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
export function findFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.match(pattern))
    .map(f => path.join(dir, f));
}

/**
 * Load a markdown file with frontmatter
 */
export function loadFile(filepath) {
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

  return { data, body, filepath };
}

/**
 * Save a markdown file with frontmatter
 */
export function saveFile(filepath, data, body) {
  // Ensure body starts with blank line for readability
  const cleanBody = body.startsWith('\n') ? body : '\n' + body;
  const content = matter.stringify(cleanBody, data);
  fs.writeFileSync(filepath, content);
}

/**
 * Convert string to kebab-case
 */
export function toKebab(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Load a template file
 */
export function loadTemplate(type) {
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
export function saveComponents(data) {
  const componentsFile = getComponentsFile();
  let content;
  if (componentsFile.endsWith('.json')) {
    content = JSON.stringify(data, null, 2);
  } else {
    content = yaml.dump(data, { lineWidth: -1 });
  }
  fs.writeFileSync(componentsFile, content);
}
