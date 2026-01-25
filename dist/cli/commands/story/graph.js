import { jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { getAllStories, buildStoryTree } from './helpers.js';
/**
 * Register story graph commands
 */
export function registerGraphCommands(story) {
    // story:tree
    story.command('tree [prd]')
        .description('Show story tree structure')
        .option('--prd <id>', 'Filter by PRD')
        .action((prdArg, options) => {
        const prd = prdArg || options.prd;
        const stories = getAllStories(prd);
        const { roots, children } = buildStoryTree(stories);
        if (roots.length === 0) {
            console.log('No stories found.');
            return;
        }
        function printTree(story, indent = '') {
            const typeIcon = story.type === 'user' ? '👤' : story.type === 'technical' ? '⚙️' : '🔌';
            console.log(`${indent}${typeIcon} ${story.id}: ${story.title}`);
            const childList = children.get(normalizeId(story.id)) || [];
            childList.forEach((child, i) => {
                const isLast = i === childList.length - 1;
                const prefix = isLast ? '└── ' : '├── ';
                printTree(child, indent + prefix.slice(0, -4));
            });
        }
        roots.forEach(r => printTree(r));
    });
    // story:roots
    story.command('roots [prd]')
        .description('List root stories (no parent)')
        .option('--prd <id>', 'Filter by PRD')
        .option('--path', 'Include file path (discouraged)')
        .option('--json', 'JSON output')
        .action((prdArg, options) => {
        const prd = prdArg || options.prd;
        const stories = getAllStories(prd, options.path);
        const roots = stories.filter(s => !s.parent_story);
        if (options.json) {
            jsonOut(roots);
        }
        else {
            if (roots.length === 0) {
                console.log('No root stories found.');
            }
            else {
                roots.forEach(s => {
                    const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
                    console.log(`${typeIcon} ${s.id}: ${s.title}`);
                });
            }
        }
    });
    // story:leaves
    story.command('leaves [prd]')
        .description('List leaf stories (no children)')
        .option('--prd <id>', 'Filter by PRD')
        .option('--path', 'Include file path (discouraged)')
        .option('--json', 'JSON output')
        .action((prdArg, options) => {
        const prd = prdArg || options.prd;
        const stories = getAllStories(prd, options.path);
        const { children } = buildStoryTree(stories);
        const leaves = stories.filter(s => {
            const childList = children.get(normalizeId(s.id)) || [];
            return childList.length === 0;
        });
        if (options.json) {
            jsonOut(leaves);
        }
        else {
            if (leaves.length === 0) {
                console.log('No leaf stories found.');
            }
            else {
                leaves.forEach(s => {
                    const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
                    console.log(`${typeIcon} ${s.id}: ${s.title}`);
                });
            }
        }
    });
    // story:children
    story.command('children <id>')
        .description('List direct children of a story')
        .option('--json', 'JSON output')
        .action((id, options) => {
        const stories = getAllStories();
        const { children } = buildStoryTree(stories);
        const storyId = normalizeId(id);
        const childList = children.get(storyId) || [];
        if (options.json) {
            jsonOut(childList);
        }
        else {
            if (childList.length === 0) {
                console.log(`No children for ${id}`);
            }
            else {
                childList.forEach(s => {
                    const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
                    console.log(`${typeIcon} ${s.id}: ${s.title}`);
                });
            }
        }
    });
    // story:ancestors
    story.command('ancestors <id>')
        .description('Show path from story to root')
        .option('--json', 'JSON output')
        .action((id, options) => {
        const stories = getAllStories();
        const { byId } = buildStoryTree(stories);
        const storyId = normalizeId(id);
        const ancestors = [];
        let current = byId.get(storyId);
        while (current) {
            ancestors.push(current);
            if (current.parent_story) {
                current = byId.get(normalizeId(current.parent_story));
            }
            else {
                current = undefined;
            }
        }
        if (options.json) {
            jsonOut(ancestors);
        }
        else {
            if (ancestors.length === 0) {
                console.log(`Story not found: ${id}`);
            }
            else {
                ancestors.reverse().forEach((s, i) => {
                    const indent = '  '.repeat(i);
                    const typeIcon = s.type === 'user' ? '👤' : s.type === 'technical' ? '⚙️' : '🔌';
                    console.log(`${indent}${typeIcon} ${s.id}: ${s.title}`);
                });
            }
        }
    });
}
