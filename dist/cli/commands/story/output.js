import { loadFile, jsonOut } from '../../managers/core-manager.js';
import { getEpic, getTask } from '../../managers/artefacts-manager.js';
import { findStoryFile, getAllStories } from './helpers.js';
/**
 * Register story output commands
 */
export function registerOutputCommands(story) {
    // story:book (dump stories)
    story.command('book [prd]')
        .description('Dump all stories (storybook)')
        .option('--prd <id>', 'Filter by PRD')
        .option('--epic <id>', 'Show stories referenced by epic')
        .option('--task <id>', 'Show stories referenced by task')
        .option('--json', 'JSON output')
        .action((prdArg, options) => {
        let stories = [];
        if (options.epic) {
            // Find epic and get its stories (artefacts.ts contract)
            const epicEntry = getEpic(options.epic);
            if (epicEntry?.data?.stories) {
                epicEntry.data.stories.forEach(sid => {
                    const storyResult = findStoryFile(sid);
                    if (storyResult) {
                        const storyFile = loadFile(storyResult.file);
                        stories.push({
                            id: storyFile.data.id,
                            title: storyFile.data.title,
                            type: storyFile.data.type,
                            file: storyResult.file
                        });
                    }
                });
            }
        }
        else if (options.task) {
            // Find task and get its stories (artefacts.ts contract)
            const taskEntry = getTask(options.task);
            if (taskEntry?.data?.stories) {
                taskEntry.data.stories.forEach(sid => {
                    const storyResult = findStoryFile(sid);
                    if (storyResult) {
                        const storyFile = loadFile(storyResult.file);
                        stories.push({
                            id: storyFile.data.id,
                            title: storyFile.data.title,
                            type: storyFile.data.type,
                            file: storyResult.file
                        });
                    }
                });
            }
        }
        else {
            // All stories for PRD
            const prd = prdArg || options.prd;
            stories = getAllStories(prd);
        }
        if (options.json) {
            jsonOut(stories);
        }
        else {
            if (stories.length === 0) {
                console.log('No stories found.');
            }
            else {
                console.log(`# Storybook (${stories.length} stories)\n`);
                stories.forEach(s => {
                    const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
                    console.log(`${typeIcon} ${s.id}: ${s.title}`);
                });
            }
        }
    });
}
