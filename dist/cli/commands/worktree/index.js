import { addDynamicHelp } from '../../lib/help.js';
import { registerStatusCommands } from './status.js';
import { registerPrCommand } from './pr.js';
import { registerManageCommands } from './manage.js';
import { registerMergeCommands } from './merge.js';
import { registerReconcileCommand } from './reconcile.js';
/**
 * Register all worktree commands
 */
export function registerWorktreeCommands(program) {
    const worktree = program.command('worktree')
        .description('Manage git worktrees for parallel agent execution');
    addDynamicHelp(worktree);
    registerStatusCommands(worktree);
    registerPrCommand(worktree);
    registerManageCommands(worktree);
    registerMergeCommands(worktree);
    registerReconcileCommand(worktree);
}
