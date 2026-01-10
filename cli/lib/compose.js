/**
 * Context Composition Library
 *
 * Centralizes fragment/context composition logic used by:
 * - context:load (context.js)
 * - assign:claim (assign.js)
 *
 * Reads workflows.yaml and applies role-based resolution with mode awareness.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getPrompting } from './core.js';
import { getAgentConfig } from './config.js';

/**
 * Load unified workflows.yaml configuration
 * @returns {object} Parsed config
 */
export function loadWorkflowsConfig() {
  const promptingDir = getPrompting();
  const configPath = path.join(promptingDir, 'workflows.yaml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const content = fs.readFileSync(configPath, 'utf8');
  return yaml.load(content);
}

/**
 * Load a prompting fragment
 * @param {string} fragmentPath - Path relative to prompting/ (without .md)
 * @returns {string|null} Fragment content or null
 */
export function loadFragment(fragmentPath) {
  const promptingDir = getPrompting();
  const fullPath = path.join(promptingDir, `${fragmentPath}.md`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fs.readFileSync(fullPath, 'utf8').trim();
}

/**
 * Get current execution mode from config
 * @returns {'inline'|'subprocess'}
 */
export function getExecMode() {
  const agentConfig = getAgentConfig();
  return agentConfig.use_subprocess ? 'subprocess' : 'inline';
}

/**
 * Resolve inject configuration for a role and mode
 * Handles both legacy array format and new object format
 * @param {object} roleDef - Role definition from workflows.yaml
 * @param {string} mode - 'inline' or 'subprocess'
 * @returns {{ files: string[], fragments: string[], exclude: string[] }}
 */
export function resolveInject(roleDef, mode) {
  const inject = roleDef?.inject || {};
  const modeConfig = inject[mode];

  // Default empty result
  const result = { files: [], fragments: [], exclude: [] };

  // Helper to merge config into result
  const mergeConfig = (config) => {
    if (!config) return;
    if (Array.isArray(config)) {
      result.files.push(...config);
    } else if (typeof config === 'object') {
      result.files.push(...(config.files || []));
      result.fragments.push(...(config.fragments || []));
      result.exclude.push(...(config.exclude || []));
    }
  };

  // 1. Apply mode-specific config (inline or subprocess)
  mergeConfig(modeConfig);

  // 2. Apply 'both' mode config
  mergeConfig(inject.both);

  // 3. Apply worktrees/no_worktrees conditional based on config
  const agentConfig = getAgentConfig();
  if (agentConfig.use_worktrees) {
    mergeConfig(inject.worktrees);
  } else {
    mergeConfig(inject.no_worktrees);
  }

  return result;
}

/**
 * Resolve fragments for an operation and role
 * @param {object} config - Loaded workflows.yaml
 * @param {string} operation - Operation name
 * @param {string} role - Role name
 * @param {string} mode - Execution mode ('inline' or 'subprocess')
 * @returns {{ fragments: string[], exclude: string[], injectFragments: string[] }|null}
 */
export function resolveFragments(config, operation, role, mode) {
  const opMeta = config.operations?.[operation];
  if (!opMeta) return null;

  const roleDef = config.roles?.[role];
  if (!roleDef) return null;

  // Collect fragments from role's base_sets
  const fragments = [];
  const baseSets = roleDef.base_sets || [];

  for (const setName of baseSets) {
    const setFragments = config.sets?.[setName];
    if (setFragments) {
      fragments.push(...setFragments);
    }
  }

  // Add operation-specific sets from matrix
  const opSets = config.matrix?.[operation] || [];
  for (const setName of opSets) {
    const setFragments = config.sets?.[setName];
    if (setFragments) {
      fragments.push(...setFragments);
    }
  }

  // Get inject config for mode
  const injectConfig = resolveInject(roleDef, mode);

  return {
    fragments,
    exclude: injectConfig.exclude,
    injectFragments: injectConfig.fragments,
    injectFiles: injectConfig.files
  };
}

/**
 * Compose context for an operation
 * Main entry point for context composition
 * @param {object} options - Composition options
 * @param {string} options.operation - Operation name
 * @param {string} options.role - Role name
 * @param {string} [options.mode] - Execution mode (auto-detected if not specified)
 * @param {boolean} [options.debug] - Add source comments
 * @param {string[]} [options.filterPrefixes] - Only include fragments with these prefixes
 * @returns {{ content: string, sources: string[] }|null}
 */
export function composeContext(options) {
  const { operation, role, debug = false, filterPrefixes = null } = options;
  const mode = options.mode || getExecMode();

  const config = loadWorkflowsConfig();
  if (!config) {
    return null;
  }

  const resolved = resolveFragments(config, operation, role, mode);
  if (!resolved) {
    return null;
  }

  const { fragments, exclude, injectFragments } = resolved;
  const parts = [];
  const sources = [];

  // 1. Add inject fragments first (e.g., agent/mcp-rudder for subprocess)
  for (const fragmentPath of injectFragments) {
    const content = loadFragment(fragmentPath);
    if (content) {
      if (debug) {
        parts.push(`<!-- source: prompting/${fragmentPath}.md (injected) -->\n${content}`);
      } else {
        parts.push(content);
      }
      sources.push(fragmentPath);
    }
  }

  // 2. Add base fragments (excluding excluded ones)
  for (const fragmentPath of fragments) {
    // Skip excluded fragments
    if (exclude.includes(fragmentPath)) continue;

    // Apply prefix filter if specified
    if (filterPrefixes) {
      const matchesPrefix = filterPrefixes.some(p => fragmentPath.startsWith(p));
      if (!matchesPrefix) continue;
    }

    const content = loadFragment(fragmentPath);
    if (content) {
      if (debug) {
        parts.push(`<!-- source: prompting/${fragmentPath}.md -->\n${content}`);
      } else {
        parts.push(content);
      }
      sources.push(fragmentPath);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return {
    content: parts.join('\n\n---\n\n'),
    sources
  };
}

/**
 * Compose agent context for assign:claim
 * Convenience wrapper that filters for agent-relevant fragments
 * @param {string} operation - Operation name (e.g., 'task-start')
 * @param {boolean} [debug] - Add source comments
 * @returns {{ content: string, sources: string[] }}
 */
export function composeAgentContext(operation, debug = false) {
  const result = composeContext({
    operation,
    role: 'agent',
    // mode auto-detected via getExecMode() (inline or subprocess)
    debug,
    filterPrefixes: ['agent/', 'shared/', 'core/']
  });

  return result || { content: '', sources: [] };
}
