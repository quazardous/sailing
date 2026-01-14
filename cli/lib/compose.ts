/**
 * Context Composition Library
 *
 * Centralizes fragment/context composition logic used by:
 * - context:load (context.js)
 * - agent:spawn (agent.js)
 *
 * Reads workflows.yaml and applies role-based resolution with mode awareness.
 *
 * This is the SINGLE SOURCE OF TRUTH for context composition.
 * The context.ts command should use these functions, not duplicate them.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getPrompting, getPathsInfo } from './core.js';
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
 * Load project-centric file if it exists
 * @param {string} key - Path key from getPathsInfo()
 * @returns {{ content: string, source: string } | null}
 */
export function loadProjectFile(key) {
  try {
    const paths = getPathsInfo();
    const info = paths[key];
    if (!info) return null;

    if (fs.existsSync(info.absolute)) {
      const content = fs.readFileSync(info.absolute, 'utf8').trim();
      return { content, source: `project:${key}` };
    }
  } catch {
    // Ignore errors
  }
  return null;
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
 * Get fragments from a set definition
 * Handles both legacy array format and new object format
 * @param {any} setDef - Set definition (array or object with fragments/roles)
 * @returns {{ fragments: string[], roles: string[] | null }}
 */
export function getSetFragments(setDef) {
  if (!setDef) return { fragments: [], roles: null };

  // Legacy format: array of fragments
  if (Array.isArray(setDef)) {
    return { fragments: setDef, roles: null };
  }

  // New format: { fragments: [...], roles?: [...] }
  if (typeof setDef === 'object') {
    return {
      fragments: setDef.fragments || [],
      roles: setDef.roles || null  // null = all roles allowed
    };
  }

  return { fragments: [], roles: null };
}

/**
 * Resolve fragments for an operation and role
 * @param {object} config - Loaded workflows.yaml
 * @param {string} operation - Operation name
 * @param {string} role - Role name (optional, will use operation's default if not specified)
 * @param {string} mode - Execution mode ('inline' or 'subprocess')
 * @returns {{ fragments: string[], role: string, roleDef: object, exclude: string[], injectFragments: string[], injectFiles: string[] }|null}
 */
export function resolveFragments(config, operation, role, mode) {
  // Get operation metadata (fallback to default)
  const opMeta = config.operations?.[operation] || config.operations?.['default'];
  if (!opMeta) return null;

  // Get allowed roles (support both 'roles' array and legacy 'role' string)
  const allowedRoles = opMeta.roles || (opMeta.role ? [opMeta.role] : ['agent']);
  const defaultRole = allowedRoles[0];
  const resolvedRole = role || defaultRole;

  // Validate role is allowed for this operation
  if (role && !allowedRoles.includes(role)) {
    return null;  // Role not allowed
  }

  const roleDef = config.roles?.[resolvedRole];
  if (!roleDef) return null;

  // Collect fragments from role's base_sets (no role filtering - base_sets are role-specific)
  const fragments = [];
  const baseSets = roleDef.base_sets || [];

  for (const setName of baseSets) {
    const { fragments: setFragments } = getSetFragments(config.sets?.[setName]);
    fragments.push(...setFragments);
  }

  // Add operation-specific sets from matrix (with role filtering)
  const opSets = config.matrix?.[operation] || [];
  for (const setName of opSets) {
    const { fragments: setFragments, roles: allowedSetRoles } = getSetFragments(config.sets?.[setName]);

    // If set has role restriction, check if current role is allowed
    if (allowedSetRoles && !allowedSetRoles.includes(resolvedRole)) {
      continue;  // Skip this set - not for this role
    }

    // Avoid duplicates
    for (const frag of setFragments) {
      if (!fragments.includes(frag)) {
        fragments.push(frag);
      }
    }
  }

  // Get inject config for mode
  const injectConfig = resolveInject(roleDef, mode);

  return {
    fragments,
    role: resolvedRole,
    roleDef,
    exclude: injectConfig.exclude,
    injectFragments: injectConfig.fragments,
    injectFiles: injectConfig.files
  };
}

/**
 * Render orchestration workflow for a specific operation and mode
 * Returns clean markdown without conditionals
 * @param {object} config - Loaded workflows.yaml
 * @param {string} command - Operation/command name
 * @param {string} mode - 'inline' or 'subprocess'
 * @param {string} actualRole - The resolved role
 * @returns {string|null}
 */
export function renderOrchestration(config, command, mode, actualRole) {
  const steps = config.orchestration?.[command];
  if (!steps) return null;

  const opMeta = config.operations?.[command] || {};
  const entity = opMeta.entity?.toUpperCase() || 'ENTITY';
  const role = actualRole || 'agent';

  const lines = [];
  lines.push(`## Workflow: ${command}`);
  lines.push('');
  lines.push(`Mode: **${mode}** | Role: **${role}** | Entity: **${entity}**`);
  lines.push('');

  for (const phase of steps) {
    // Filter commands by mode
    const commands = (phase.commands || []).filter(cmd =>
      cmd.mode === 'both' || cmd.mode === mode
    );

    if (commands.length === 0) continue;

    lines.push(`### ${phase.name} (${phase.actor})`);
    lines.push('');

    for (const cmd of commands) {
      const cmdStr = cmd.cmd.replace(/\{(\w+)\}/g, (_, key) => `<${key}>`);
      const required = cmd.required ? ' **[required]**' : '';
      const condition = cmd.condition ? ` _(if ${cmd.condition})_` : '';

      lines.push(`- \`${cmdStr}\`${required}${condition}`);
      lines.push(`  → ${cmd.purpose}`);
      if (cmd.note) {
        lines.push(`  ⚠ ${cmd.note}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Compose context for an operation
 * Main entry point for context composition
 *
 * This is the SINGLE SOURCE OF TRUTH for context composition.
 * Both the lib and CLI command should use this function.
 *
 * @param {object} options - Composition options
 * @param {string} options.operation - Operation name
 * @param {string} [options.role] - Role name (optional, uses operation's default)
 * @param {string} [options.mode] - Execution mode (auto-detected if not specified)
 * @param {boolean} [options.debug] - Add source comments
 * @param {boolean} [options.includeHeader] - Include mode header (default: true)
 * @param {boolean} [options.includeWorkflow] - Include orchestration workflow (default: true)
 * @param {boolean} [options.includeProjectFiles] - Include project files (default: true)
 * @returns {{ content: string, sources: string[], role: string, operation: string }|null}
 */
export function composeContext(options) {
  const {
    operation,
    role = null,
    debug = false,
    includeHeader = true,
    includeWorkflow = true,
    includeProjectFiles = true
  } = options;
  const mode = options.mode || getExecMode();
  const agentConfig = getAgentConfig();

  const config = loadWorkflowsConfig();
  if (!config) {
    return null;
  }

  const resolved = resolveFragments(config, operation, role, mode);
  if (!resolved) {
    return null;
  }

  const { fragments, role: resolvedRole, roleDef, exclude, injectFragments, injectFiles } = resolved;
  const parts = [];
  const sources = [];

  // 1. MODE HEADER: Inject execution mode info at the very beginning
  if (includeHeader) {
    const modeHeader = `<!-- mode: ${mode} | worktrees: ${agentConfig.use_worktrees ? 'enabled' : 'disabled'} -->`;
    parts.push(modeHeader);
    sources.push('mode-header');
  }

  // 2. Add base fragments (excluding excluded ones)
  for (const fragmentPath of fragments) {
    // Skip excluded fragments
    if (exclude.includes(fragmentPath)) continue;

    const content = loadFragment(fragmentPath);
    if (content) {
      if (debug) {
        parts.push(`<!-- source: prompting/${fragmentPath}.md -->\n${content}`);
      } else {
        parts.push(content);
      }
      sources.push(fragmentPath);
    } else if (debug) {
      console.error(`Warning: Fragment not found: ${fragmentPath}`);
    }
  }

  // 3. Add inject fragments (e.g., agent/mcp-rudder for subprocess)
  for (const fragmentPath of injectFragments) {
    if (exclude.includes(fragmentPath)) continue;

    const content = loadFragment(fragmentPath);
    if (content) {
      if (debug) {
        parts.push(`<!-- source: prompting/${fragmentPath}.md (injected) -->\n${content}`);
      } else {
        parts.push(content);
      }
      sources.push(fragmentPath);
    } else if (debug) {
      console.error(`Warning: Inject fragment not found: ${fragmentPath}`);
    }
  }

  // 4. Inject orchestration workflow if role.workflow is true
  if (includeWorkflow && roleDef.workflow) {
    const workflow = renderOrchestration(config, operation, mode, resolvedRole);
    if (workflow) {
      parts.push(workflow);
      sources.push(`orchestration:${operation}:${mode}`);
    }
  }

  // 5. Load project files (from inject dimensions)
  if (includeProjectFiles && injectFiles) {
    for (const key of injectFiles) {
      const projectFile = loadProjectFile(key);
      if (projectFile) {
        parts.push(projectFile.content);
        sources.push(projectFile.source);
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return {
    content: parts.join('\n\n---\n\n'),
    sources,
    role: resolvedRole,
    operation
  };
}

/**
 * Compose agent context for agent:spawn
 * Convenience wrapper with agent role preset
 *
 * Returns the SAME output as `context:load <operation> --role agent`
 *
 * @param {string} operation - Operation name (e.g., 'task-start')
 * @param {boolean} [debug] - Add source comments
 * @returns {{ content: string, sources: string[], role: string, operation: string }}
 */
export function composeAgentContext(operation, debug = false) {
  const result = composeContext({
    operation,
    role: 'agent',
    // mode auto-detected via getExecMode() (inline or subprocess)
    debug
    // No filterPrefixes - we want full context matching context:load
  });

  return result || { content: '', sources: [], role: 'agent', operation };
}
