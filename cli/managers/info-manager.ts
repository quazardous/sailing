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
  getArtefactsDir,
  getTemplates,
  resolvePlaceholders,
  resolvePath,
  getPath,
  getPathType
} from './core-manager.js';

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
    const configuredPath = (config.paths[key]) || (DEFAULT_PATHS[key] as string | { path: string; type: 'dir' | 'file' });
    const absolute = getPath(key);
    const relative = absolute ? toHomeRelative(absolute) : (configuredPath as string);
    return { template: configuredPath as string, relative, absolute };
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
