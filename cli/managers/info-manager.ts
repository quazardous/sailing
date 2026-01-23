/**
 * Info Manager - Project and configuration information aggregation
 *
 * MANAGER: Orchestrates info gathering from other managers.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { PathsInfo, ConfigInfo } from '../lib/types/config.js';
import {
  findProjectRoot,
  loadPathsConfig,
  getTemplates,
  getPrompting,
  isDevInstall,
  getRepoRoot,
  resolvePlaceholders,
  resolvePath,
  getPath,
  getPathType
} from './core-manager.js';
import { PATHS_SCHEMA } from '../lib/paths-schema.js';

/**
 * Default paths configuration (for reference)
 */
const DEFAULT_PATHS: Record<string, { path: string; type: 'dir' | 'file' }> = {
  artefacts: { path: '.sailing/artefacts', type: 'dir' },
  memory: { path: '.sailing/memory', type: 'dir' },
  archive: { path: '.sailing/archive', type: 'dir' },
  templates: { path: '.sailing/templates', type: 'dir' },
  prompting: { path: '.sailing/prompting', type: 'dir' },
  state: { path: '.sailing/state.json', type: 'file' },
  config: { path: '.sailing/config.yaml', type: 'file' },
  components: { path: '.sailing/components.yaml', type: 'file' },
  toolset: { path: '.claude/TOOLSET.md', type: 'file' },
  stack: { path: 'STACK.md', type: 'file' },
  roadmap: { path: '.sailing/artefacts/ROADMAP.md', type: 'file' },
  postit: { path: '.sailing/artefacts/POSTIT.md', type: 'file' },
  haven: { path: '${haven}', type: 'dir' },
  agents: { path: '${haven}/agents', type: 'dir' },
  worktrees: { path: '${haven}/worktrees', type: 'dir' },
  runs: { path: '${haven}/runs', type: 'dir' },
  assignments: { path: '${haven}/assignments', type: 'dir' },
  diagnostics: { path: '${haven}/diagnostics', type: 'dir' },
  srtConfig: { path: '${haven}/srt-settings.json', type: 'file' }
};

/**
 * Get path string from value
 */
function getPathString(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.path) return value.path;
  return null;
}

/**
 * Get comprehensive paths information
 */
export function getPathsInfo(): PathsInfo {
  const config = loadPathsConfig() as { paths: Record<string, string | null> };
  const templatesPath = getTemplates();
  const promptingPath = getPrompting();
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
    const template = custom ? (config.paths?.[key]) : '${haven}/' + subpath;
    return { template, relative: toHomeRelative(resolved), absolute: resolved };
  };

  const getProjectPath = (key: string) => {
    // Template is the unresolved value: from paths.yaml if explicitly configured, otherwise schema default
    // loadPathsConfig fills defaults, so compare against DEFAULT_PATHS to detect explicit config
    const configValue = config.paths?.[key];
    const defaultValue = DEFAULT_PATHS[key]?.path;
    const schemaDefault = PATHS_SCHEMA[key]?.default;
    const wasExplicitlyConfigured = configValue && configValue !== defaultValue;
    const template = wasExplicitlyConfigured ? configValue : (schemaDefault || defaultValue);
    const absolute = getPath(key);
    const relative = absolute ? toHomeRelative(absolute) : (template || '');
    return { template, relative, absolute };
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
      // Template: if explicitly configured use that, else if dev use ^/templates, else schema default
      // loadPathsConfig fills defaults, so compare against DEFAULT_PATHS to detect explicit config
      template: (config.paths?.templates && config.paths.templates !== DEFAULT_PATHS.templates?.path)
        ? config.paths.templates
        : (isDevInstall() ? '^/templates' : PATHS_SCHEMA.templates?.default),
      relative: toHomeRelative(templatesPath),
      absolute: templatesPath
    },
    prompting: {
      // Template: if explicitly configured use that, else if dev use ^/prompting, else schema default
      template: (config.paths?.prompting && config.paths.prompting !== DEFAULT_PATHS.prompting?.path)
        ? config.paths.prompting
        : (isDevInstall() ? '^/prompting' : PATHS_SCHEMA.prompting?.default),
      relative: toHomeRelative(promptingPath),
      absolute: promptingPath
    },
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

/**
 * Get dev install information
 */
export function getDevInfo() {
  const isDev = isDevInstall();
  const repoRoot = getRepoRoot();
  return {
    isDevInstall: isDev,
    repoRoot: repoRoot,
    templatesResolved: getTemplates(),
    promptingResolved: getPrompting()
  };
}

/**
 * Get comprehensive configuration information
 */
export function getConfigInfo(scriptDir?: string): ConfigInfo {
  const projectRoot = findProjectRoot();
  const pathsConfigPath = path.join(projectRoot, '.sailing', 'paths.yaml');
  const config = loadPathsConfig() as { paths: Record<string, string | null> };

  const pathsInfo: Record<string, { path: string | null; configured: string | undefined; type: string | undefined; isCustom: boolean; isAbsolute: boolean }> = {};
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
      type: getPathType(key) as string | undefined,
      isCustom,
      isAbsolute: isHome || isHaven || path.isAbsolute(configuredPath || '')
    };
  }

  return {
    projectRoot,
    sailingDir: path.join(projectRoot, '.sailing'),
    pathsConfigPath,
    pathsConfigExists: fs.existsSync(pathsConfigPath),
    cliPath: scriptDir || import.meta.dirname,
    paths: pathsInfo
  };
}
