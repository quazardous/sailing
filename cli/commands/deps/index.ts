/**
 * Deps commands for rudder CLI
 * Manages dependency graph operations
 */
import { addDynamicHelp } from '../../lib/help.js';
import { registerTreeCommand } from './tree.js';
import { registerValidateCommand } from './validate.js';
import { registerAnalysisCommands } from './analysis.js';
import { registerModifyCommands } from './modify.js';
import type { Command } from 'commander';

/**
 * Register all deps commands
 */
export function registerDepsCommands(program: Command): void {
  const deps = program.command('deps').description('Dependency graph operations');

  addDynamicHelp(deps);

  registerTreeCommand(deps);
  registerValidateCommand(deps);
  registerAnalysisCommands(deps);
  registerModifyCommands(deps);
}
