/**
 * Task commands for rudder CLI
 * Manages task operations: list, show, create, update, workflow
 */
import { addDynamicHelp } from '../../lib/help.js';
import { registerListCommand } from './list.js';
import { registerShowCommands } from './show.js';
import { registerCrudCommands } from './crud.js';
import { registerWorkflowCommands } from './workflow.js';
import { registerModifyCommands } from './modify.js';
/**
 * Register all task commands
 */
export function registerTaskCommands(program) {
    const task = program.command('task').description('Task operations');
    // Dynamic help generated from registered commands
    addDynamicHelp(task, { entityType: 'task' });
    // Register command groups
    registerListCommand(task);
    registerShowCommands(task);
    registerCrudCommands(task);
    registerWorkflowCommands(task);
    registerModifyCommands(task);
}
