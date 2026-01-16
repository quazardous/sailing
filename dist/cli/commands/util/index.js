/**
 * Utility commands index - aggregates all util subcommands
 */
import { registerConfigCommands } from './config-cmd.js';
import { registerPathsCommands } from './paths-cmd.js';
import { registerVersionsCommands } from './versions-cmd.js';
import { registerStatusCommand } from './status-cmd.js';
import { registerStateCommands } from './state-cmd.js';
import { registerFeedbackCommands } from './feedback-cmd.js';
import { registerInitCommand } from './init-cmd.js';
import { registerEnsureCommand } from './ensure-cmd.js';
import { registerFixCommands } from './fix-cmd.js';
/**
 * Register all utility commands
 */
export function registerUtilCommands(program) {
    registerConfigCommands(program);
    registerPathsCommands(program);
    registerVersionsCommands(program);
    registerStatusCommand(program);
    registerStateCommands(program);
    registerFeedbackCommands(program);
    registerInitCommand(program);
    registerEnsureCommand(program);
    registerFixCommands(program);
}
// Re-export individual register functions for selective use
export { registerConfigCommands, registerPathsCommands, registerVersionsCommands, registerStatusCommand, registerStateCommands, registerFeedbackCommands, registerInitCommand, registerEnsureCommand, registerFixCommands };
