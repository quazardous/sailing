/**
 * Agent commands for rudder CLI
 * Manages agent lifecycle: spawn, collect, status, merge
 */
import { addDynamicHelp } from '../../lib/help.js';
import { registerSpawnCommand } from './spawn.js';
import { registerHarvestCommands } from './harvest.js';
import { registerMonitorCommands } from './monitor.js';
import { registerManageCommands } from './manage.js';
import { registerCheckCommand } from './check.js';
import { registerDiagnoseCommands } from './diagnose.js';

/**
 * Register all agent commands
 */
export function registerAgentCommands(program) {
  const agent = program.command('agent')
    .description('Agent lifecycle management');

  addDynamicHelp(agent, { entityType: 'agent' });

  // Register command groups
  registerSpawnCommand(agent);
  registerHarvestCommands(agent);
  registerMonitorCommands(agent);
  registerManageCommands(agent);
  registerCheckCommand(agent);
  registerDiagnoseCommands(agent);

  return agent;
}
