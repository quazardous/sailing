/**
 * Context commands for rudder CLI
 * Provides optimized prompting context based on roles
 *
 * Reads from unified workflows.yaml:
 *   roles:        Actor definitions (agent, coordinator, skill)
 *   sets:         Fragment bundles
 *   operations:   Operation metadata + role
 *   matrix:       Operation → additional sets
 *   orchestration: Workflow steps
 *
 * Resolution flow:
 *   context:load <op> →
 *     1. operations[op].role → roles[role]
 *     2. roles[role].base_sets → fragments
 *     3. matrix[op] → additional fragments
 *     4. roles[role].inject → project files
 *     5. if roles[role].workflow → orchestration[op]
 */
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getPrompting, jsonOut, getPathsInfo } from '../lib/core.js';
import { addDynamicHelp } from '../lib/help.js';
import { getAgentConfig } from '../lib/config.js';
import { WorkflowsConfig, WorkflowPhase, WorkflowCommand, RoleDefinition, OperationMeta } from '../lib/types/workflows.js';

type OperationListItem = OperationMeta & { name: string; allowedRoles: string[] };
type OperationsByRole = Record<string, OperationListItem[]>;

interface ContextOptions {
  debug?: boolean;
  roleOverride?: string;
}

/**
 * Load project-centric file if it exists
 * Returns { content, source } or null
 */
function loadProjectFile(key) {
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
 * Load unified workflows.yaml configuration
 */
function loadWorkflowsConfig(): WorkflowsConfig {
  const promptingDir = getPrompting();
  const configPath = path.join(promptingDir, 'workflows.yaml');

  if (!fs.existsSync(configPath)) {
    console.error(`Error: workflows.yaml not found at ${configPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(configPath, 'utf8');
  return yaml.load(content) as WorkflowsConfig;
}

/**
 * Load a fragment file
 */
function loadFragment(fragmentPath) {
  const promptingDir = getPrompting();
  const fullPath = path.join(promptingDir, `${fragmentPath}.md`);

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  return fs.readFileSync(fullPath, 'utf8').trim();
}

/**
 * Resolve fragments for an operation using role-based resolution
 * @param {object} config - Loaded workflows.yaml
 * @param {string} operation - Operation name (task-start, etc.)
 * @param {string} roleOverride - Optional role to use instead of operation's default
 * @returns {{ fragments: string[], role: string, roleDef: object } | null}
 */
function resolveFragments(config: WorkflowsConfig, operation: string, roleOverride: string | null = null) {
  // 1. Get operation metadata (fallback to default)
  const opMeta = config.operations[operation] || config.operations['default'];
  if (!opMeta) {
    return null;
  }

  // 2. Get allowed roles (support both 'roles' array and legacy 'role' string)
  const allowedRoles = opMeta.roles || (opMeta.role ? [opMeta.role] : ['agent']);
  const defaultRole = allowedRoles[0];
  const roleName = roleOverride || defaultRole;

  // 3. Validate role is allowed for this operation
  if (roleOverride && !allowedRoles.includes(roleOverride)) {
    console.error(`⚠️  Role '${roleOverride}' not allowed for '${operation}'`);
    console.error(`   Allowed roles: ${allowedRoles.join(', ')}`);
    return null;
  }

  const roleDef = config.roles[roleName];
  if (!roleDef) {
    console.error(`Error: Role '${roleName}' not found`);
    return null;
  }

  // 4. Collect fragments from role's base_sets
  const allFragments = [];
  const baseSets = roleDef.base_sets || [];

  for (const setName of baseSets) {
    const setFragments = config.sets[setName];
    if (setFragments) {
      allFragments.push(...setFragments);
    }
  }

  // 5. Add operation-specific sets from matrix
  const additionalSets = config.matrix[operation] || [];
  for (const setName of additionalSets) {
    const setFragments = config.sets[setName];
    if (setFragments) {
      // Avoid duplicates
      for (const frag of setFragments) {
        if (!allFragments.includes(frag)) {
          allFragments.push(frag);
        }
      }
    }
  }

  return {
    fragments: allFragments,
    role: roleName,
    roleDef
  };
}

/**
 * Render orchestration workflow for a specific operation and mode
 * Returns clean markdown without conditionals
 */
function renderOrchestration(config, command, mode) {
  const steps = config.orchestration?.[command];
  if (!steps) return null;

  const opMeta = config.operations?.[command] || {};
  const entity = opMeta.entity?.toUpperCase() || 'ENTITY';
  const role = opMeta.role || 'agent';

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
 * Compose context for an operation using role-based resolution
 * @param {string} operation - Operation name
 * @param {ContextOptions} options - Options (debug, roleOverride)
 */
function composeContext(operation, options: ContextOptions = {}) {
  const config = loadWorkflowsConfig();
  const agentConfig = getAgentConfig();
  const execMode = agentConfig.use_subprocess ? 'subprocess' : 'inline';

  // Resolve fragments using role-based logic
  const resolved = resolveFragments(config, operation, options.roleOverride);

  if (!resolved) {
    console.error(`Error: No context defined for operation '${operation}'`);
    console.error(`Available operations: ${Object.keys(config.operations).join(', ')}`);
    process.exit(1);
  }

  const { fragments, role, roleDef } = resolved;

  // Load and compose fragments
  const parts = [];
  const sources = [];

  // MODE HEADER: Inject execution mode info at the very beginning
  const modeHeader = `<!-- mode: ${execMode} | worktrees: ${agentConfig.use_worktrees ? 'enabled' : 'disabled'} -->`;
  parts.push(modeHeader);
  sources.push('mode-header');

  // Load base fragments
  for (const fragmentPath of fragments) {
    const content = loadFragment(fragmentPath);
    if (content) {
      parts.push(content);
      sources.push(fragmentPath);
    } else if (options.debug) {
      console.error(`Warning: Fragment not found: ${fragmentPath}`);
    }
  }

  if (parts.length === 0) {
    console.error(`Error: No fragments loaded for operation '${operation}' (role: ${role})`);
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INJECTION SYSTEM: Apply role-based injections from workflows.yaml
  // ─────────────────────────────────────────────────────────────────────────
  // Dimensions:
  //   - both:       always applied
  //   - inline:     when execMode === 'inline'
  //   - subprocess: when execMode === 'subprocess'
  //   - worktrees:  when agentConfig.use_worktrees === true
  //
  // Each dimension can be:
  //   - Array of project file keys: [roadmap, postit]
  //   - Object with files/fragments/exclude: { files: [...], fragments: [...], exclude: [...] }
  // ─────────────────────────────────────────────────────────────────────────

  const inject = roleDef.inject || {};
  const projectFiles = [];
  const additionalFragments = [];
  const excludeFragments = new Set();

  /**
   * Process an inject dimension (both, inline, subprocess, worktrees)
   */
  function processInjectDimension(dimension) {
    if (!dimension) return;

    if (Array.isArray(dimension)) {
      // Legacy format: array of project file keys
      projectFiles.push(...dimension);
    } else if (typeof dimension === 'object') {
      // New format: { files, fragments, exclude }
      if (dimension.files) projectFiles.push(...dimension.files);
      if (dimension.fragments) additionalFragments.push(...dimension.fragments);
      if (dimension.exclude) dimension.exclude.forEach(f => excludeFragments.add(f));
    }
  }

  // Apply dimensions in order
  processInjectDimension(inject.both);
  processInjectDimension(inject[execMode]);
  if (agentConfig.use_worktrees) {
    processInjectDimension(inject.worktrees);
  } else {
    processInjectDimension(inject.no_worktrees);
  }

  // Load additional fragments (from inject dimensions)
  for (const fragmentPath of additionalFragments) {
    if (excludeFragments.has(fragmentPath)) continue;
    const content = loadFragment(fragmentPath);
    if (content) {
      parts.push(content);
      sources.push(fragmentPath);
    } else if (options.debug) {
      console.error(`Warning: Inject fragment not found: ${fragmentPath}`);
    }
  }

  // Inject orchestration workflow if role.workflow is true
  if (roleDef.workflow) {
    const workflow = renderOrchestration(config, operation, execMode);
    if (workflow) {
      parts.push(workflow);
      sources.push(`orchestration:${operation}:${execMode}`);
    }
  }

  // Load project files
  for (const key of projectFiles) {
    const projectFile = loadProjectFile(key);
    if (projectFile) {
      parts.push(projectFile.content);
      sources.push(projectFile.source);
    }
  }

  return {
    content: parts.join('\n\n---\n\n'),
    sources,
    role,
    operation
  };
}

/**
 * List available operations grouped by role
 */
function listOperations(config: WorkflowsConfig): OperationsByRole {
  const byRole: OperationsByRole = {};
  for (const [op, meta] of Object.entries(config.operations || {})) {
    if (op === 'default') continue;
    // Support both 'roles' array and legacy 'role' string
    const roles = meta.roles || (meta.role ? [meta.role] : ['agent']);
    const defaultRole = roles[0];
    // List under default role, show all allowed roles
    if (!byRole[defaultRole]) byRole[defaultRole] = [];
    byRole[defaultRole].push({ name: op, allowedRoles: roles, ...meta });
  }
  return byRole;
}

/**
 * Register context commands
 */
export function registerContextCommands(program) {
  const context = program.command('context')
    .description('Context operations (role-based prompts)');

  // context:load - main entry point (role required)
  context.command('load')
    .description('Load context for an operation (--role required)')
    .argument('[operation]', 'Operation name (task-start, prd-breakdown, etc.)')
    .option('--sources', 'Show fragment sources used')
    .option('--role <role>', 'Role: agent, coordinator, or skill')
    .option('--list', 'List available operations')
    .option('--json', 'JSON output')
    .action((operation, options) => {
      if (options.list) {
        const config = loadWorkflowsConfig();
        const byRole = listOperations(config);
        if (options.json) {
          jsonOut(byRole);
        } else {
          for (const [role, ops] of Object.entries(byRole)) {
            console.log(`\n${role.toUpperCase()}:`);
            for (const op of ops) {
              // Show additional allowed roles if multi-role
              const extraRoles = op.allowedRoles?.length > 1
                ? ` [+${op.allowedRoles.slice(1).join(',')}]`
                : '';
              console.log(`  ${op.name.padEnd(20)}${extraRoles.padEnd(12)} ${op.description || ''}`);
            }
          }
        }
        return;
      }

      // Validate required args when not --list
      if (!operation) {
        console.error('Error: missing required argument \'operation\'');
        console.error('Usage: rudder context:load <operation> --role <role>');
        console.error('       rudder context:load --list');
        process.exit(1);
      }

      const result = composeContext(operation, {
        debug: options.sources,
        roleOverride: options.role
      });

      if (options.json) {
        jsonOut({
          operation: result.operation,
          role: result.role,
          sources: result.sources,
          content: result.content
        });
        return;
      }

      if (options.sources) {
        console.log(`# Context: ${operation} (role: ${result.role})`);
        console.log(`# Sources: ${result.sources.join(', ')}\n`);
      }

      console.log(result.content);
    });

  // context:agent - DEPRECATED alias (for backward compatibility)
  context.command('agent')
    .description('[DEPRECATED] Use context:load instead')
    .argument('<command>', 'Command/operation name')
    .option('--sources', 'Show fragment sources used')
    .option('--list', 'List available operations')
    .option('--json', 'JSON output')
    .action((command, options) => {
      if (!options.list) {
        console.error('# Note: context:agent is deprecated, use context:load\n');
      }
      // Delegate to load
      if (options.list) {
        const config = loadWorkflowsConfig();
        const byRole: any = listOperations(config);
        // Filter to agent role only
        const agentOps = byRole.agent || [];
        if (options.json) {
          jsonOut(agentOps);
        } else {
          console.log('Agent operations:\n');
          for (const op of agentOps) {
            console.log(`  ${op.name.padEnd(20)} ${op.description || ''}`);
          }
        }
        return;
      }

      const result = composeContext(command, { debug: options.sources });

      if (options.json) {
        jsonOut({
          type: 'agent',
          command,
          role: result.role,
          sources: result.sources,
          content: result.content
        });
        return;
      }

      if (options.sources) {
        console.log(`# Context: ${command} (role: ${result.role})`);
        console.log(`# Sources: ${result.sources.join(', ')}\n`);
      }

      console.log(result.content);
    });

  // context:skill - DEPRECATED alias (for backward compatibility)
  context.command('skill')
    .description('[DEPRECATED] Use context:load instead')
    .argument('<command>', 'Command/operation name')
    .option('--sources', 'Show fragment sources used')
    .option('--list', 'List available operations')
    .option('--json', 'JSON output')
    .action((command, options) => {
      if (!options.list) {
        console.error('# Note: context:skill is deprecated, use context:load\n');
      }
      // Delegate to load
      if (options.list) {
        const config = loadWorkflowsConfig();
        const byRole: any = listOperations(config);
        // Filter to skill + coordinator roles
        const skillOps = [...(byRole.skill || []), ...(byRole.coordinator || [])];
        if (options.json) {
          jsonOut(skillOps);
        } else {
          console.log('Skill/Coordinator operations:\n');
          for (const op of skillOps) {
            console.log(`  ${op.name.padEnd(20)} ${op.description || ''}`);
          }
        }
        return;
      }

      const result = composeContext(command, { debug: options.sources });

      if (options.json) {
        jsonOut({
          type: 'skill',
          command,
          role: result.role,
          sources: result.sources,
          content: result.content
        });
        return;
      }

      if (options.sources) {
        console.log(`# Context: ${command} (role: ${result.role})`);
        console.log(`# Sources: ${result.sources.join(', ')}\n`);
      }

      console.log(result.content);
    });

  // context:show (show a specific fragment)
  context.command('show')
    .description('Show a specific prompting fragment')
    .argument('<fragment>', 'Fragment path (e.g., agent/contract, shared/milestone)')
    .option('--json', 'JSON output')
    .action((fragment, options) => {
      const content = loadFragment(fragment);

      if (!content) {
        console.error(`Error: Fragment not found: ${fragment}`);
        process.exit(1);
      }

      if (options.json) {
        jsonOut({ fragment, content });
        return;
      }

      console.log(content);
    });

  // context:list (list all available contexts)
  context.command('list')
    .description('List roles, sets, and operations')
    .option('--sets', 'Show fragment sets')
    .option('--json', 'JSON output')
    .action((options) => {
      const config = loadWorkflowsConfig();

      if (options.json) {
        jsonOut({
          roles: config.roles,
          sets: config.sets,
          matrix: config.matrix,
          operations: config.operations
        });
        return;
      }

      console.log('Roles:\n');
      for (const [name, def] of Object.entries(config.roles || {})) {
        const roleDef = def as RoleDefinition;
        console.log(`  ${name.padEnd(15)} ${roleDef.description || ''}`);
        console.log(`    base_sets: [${roleDef.base_sets?.join(', ') || ''}]`);
        console.log(`    workflow: ${roleDef.workflow || false}`);
      }

      console.log('\nFragment Sets:\n');
      for (const [name, fragments] of Object.entries(config.sets || {})) {
        const frags = fragments as string[];
        if (options.sets) {
          console.log(`  ${name}: [${frags.join(', ')}]`);
        } else {
          console.log(`  ${name}`);
        }
      }

      console.log('\nOperations by Role:\n');
      const byRole = listOperations(config);
      for (const [role, ops] of Object.entries(byRole)) {
        console.log(`  ${role.toUpperCase()}:`);
        for (const op of ops) {
          const additionalSets = config.matrix[op.name] || [];
          const setsStr = additionalSets.length > 0 ? ` +[${additionalSets.join(', ')}]` : '';
          console.log(`    ${op.name.padEnd(18)}${setsStr}`);
        }
      }

      console.log('\nUsage: rudder context:load <operation>');
    });

  // Add dynamic help
  addDynamicHelp(context);
}
