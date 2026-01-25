import { addDynamicHelp } from '../../lib/help.js';
import { registerCrudCommands } from './crud.js';
import { registerGraphCommands } from './graph.js';
import { registerValidateCommands } from './validate.js';
import { registerOutputCommands } from './output.js';
import { registerModifyCommands } from './modify.js';
/**
 * Register all story commands
 */
export function registerStoryCommands(program) {
    const story = program.command('story').description('Story operations (narrative context for features)');
    addDynamicHelp(story, { entityType: 'story' });
    registerCrudCommands(story);
    registerGraphCommands(story);
    registerValidateCommands(story);
    registerOutputCommands(story);
    registerModifyCommands(story);
}
