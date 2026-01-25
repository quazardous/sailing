import { addDynamicHelp } from '../../lib/help.js';
import { registerLifecycleCommands } from './lifecycle.js';
import { registerQueryCommands } from './query.js';
import { registerManageCommands } from './manage.js';
/**
 * Register all assignment commands
 */
export function registerAssignCommands(program) {
    const assign = program.command('assign')
        .description('Assignment operations (skill → agent prompt)');
    registerLifecycleCommands(assign);
    registerQueryCommands(assign);
    registerManageCommands(assign);
    // Add dynamic help
    addDynamicHelp(assign);
}
