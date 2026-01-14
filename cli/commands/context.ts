/**
 * Context commands for rudder CLI
 * Provides optimized prompting context based on roles
 *
 * Uses compose.ts lib for context composition (SINGLE SOURCE OF TRUTH).
 *
 * Resolution flow:
 *   context:load <op> →
 *     1. operations[op].role → roles[role]
 *     2. roles[role].base_sets → fragments
 *     3. matrix[op] → additional fragments
 *     4. roles[role].inject → project files
 *     5. if roles[role].workflow → orchestration[op]
 */
import { jsonOut } from '../lib/core.js';
import { addDynamicHelp } from '../lib/help.js';
import {
  loadWorkflowsConfig,
  loadFragment,
  composeContext,
  getSetFragments
} from '../lib/compose.js';
import { WorkflowsConfig, RoleDefinition, OperationMeta } from '../lib/types/workflows.js';

type OperationListItem = OperationMeta & { name: string; allowedRoles: string[] };
type OperationsByRole = Record<string, OperationListItem[]>;

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
    .action((operation: string, options: {
      sources?: boolean;
      role?: string;
      list?: boolean;
      json?: boolean;
    }) => {
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

      if (!options.role) {
        console.error('Error: --role is required');
        console.error('Usage: rudder context:load <operation> --role <role>');
        console.error('Roles: agent, coordinator, skill');
        process.exit(1);
      }

      const result = composeContext({
        operation,
        role: options.role,
        debug: options.sources
      });

      if (!result) {
        const config = loadWorkflowsConfig();
        console.error(`Error: No context defined for operation '${operation}'`);
        console.error(`Available operations: ${Object.keys(config.operations || {}).join(', ')}`);
        process.exit(1);
      }

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
    .action((command: string, options: {
      sources?: boolean;
      list?: boolean;
      json?: boolean;
    }) => {
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

      const result = composeContext({
        operation: command,
        role: 'agent',
        debug: options.sources
      });

      if (!result) {
        console.error(`Error: No context defined for operation '${command}'`);
        process.exit(1);
      }

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
    .action((command: string, options: {
      sources?: boolean;
      list?: boolean;
      json?: boolean;
    }) => {
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

      const result = composeContext({
        operation: command,
        role: 'skill',
        debug: options.sources
      });

      if (!result) {
        console.error(`Error: No context defined for operation '${command}'`);
        process.exit(1);
      }

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
    .action((fragment: string, options: { json?: boolean }) => {
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
    .action((options: { sets?: boolean; json?: boolean }) => {
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
