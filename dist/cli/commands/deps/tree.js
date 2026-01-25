/**
 * Deps tree command
 */
import { jsonOut } from '../../managers/core-manager.js';
import { normalizeId } from '../../lib/normalize.js';
import { statusSymbol } from '../../lib/lexicon.js';
import { buildDependencyGraph, findRoots, blockersResolved, getAncestors, getDescendants } from '../../managers/graph-manager.js';
/**
 * Register deps:tree command
 */
export function registerTreeCommand(deps) {
    deps.command('tree [taskId]')
        .description('Visualize dependency tree (ancestors/descendants)')
        .option('--ancestors', 'Show ancestors (blockers)')
        .option('--descendants', 'Show descendants (blocked by this)')
        .option('-d, --depth <n>', 'Max depth', parseInt)
        .option('-t, --tag <tag>', 'Filter by tag (repeatable, AND logic)', (v, arr) => arr.concat(v), [])
        .option('--ready', 'Only show ready tasks')
        .option('--json', 'JSON output')
        .action((taskId, options) => {
        const { tasks, blocks } = buildDependencyGraph();
        const maxDepth = (options.depth) || Infinity;
        if (taskId) {
            const id = normalizeId(taskId);
            const task = tasks.get(id);
            if (!task) {
                console.error(`Task not found: ${id}`);
                process.exit(1);
            }
            if (options.ancestors) {
                const ancestors = getAncestors(id, tasks, maxDepth);
                if (options.json) {
                    jsonOut([...ancestors].map(a => tasks.get(a)));
                }
                else {
                    console.log(`Ancestors of ${id}:\n`);
                    ancestors.forEach(a => {
                        const t = tasks.get(a);
                        if (t)
                            console.log(`  ${statusSymbol(t.status)} ${a}: ${t.title}`);
                    });
                }
            }
            else if (options.descendants) {
                const descendants = getDescendants(id, blocks, maxDepth);
                if (options.json) {
                    jsonOut([...descendants].map(d => tasks.get(d)));
                }
                else {
                    console.log(`Descendants of ${id}:\n`);
                    descendants.forEach(d => {
                        const t = tasks.get(d);
                        if (t)
                            console.log(`  ${statusSymbol(t.status)} ${d}: ${t.title}`);
                    });
                }
            }
            else {
                // Show both
                const ancestors = getAncestors(id, tasks, maxDepth);
                const descendants = getDescendants(id, blocks, maxDepth);
                if (options.json) {
                    jsonOut({
                        task: tasks.get(id),
                        ancestors: [...ancestors].map(a => tasks.get(a)),
                        descendants: [...descendants].map(d => tasks.get(d))
                    });
                }
                else {
                    if (ancestors.size > 0) {
                        console.log(`Blocked by (${ancestors.size}):`);
                        ancestors.forEach(a => {
                            const t = tasks.get(a);
                            if (t)
                                console.log(`  ${statusSymbol(t.status)} ${a}: ${t.title}`);
                        });
                        console.log('');
                    }
                    console.log(`→ ${statusSymbol(task.status)} ${id}: ${task.title}\n`);
                    if (descendants.size > 0) {
                        console.log(`Blocks (${descendants.size}):`);
                        descendants.forEach(d => {
                            const t = tasks.get(d);
                            if (t)
                                console.log(`  ${statusSymbol(t.status)} ${d}: ${t.title}`);
                        });
                    }
                }
            }
        }
        else {
            // Show roots and their trees
            const roots = findRoots(tasks);
            const output = [];
            function printTree(id, indent = '', depth = 0) {
                if (depth > maxDepth)
                    return;
                const task = tasks.get(id);
                if (!task)
                    return;
                if (options.ready && !blockersResolved(task, tasks))
                    return;
                // Tag filter (AND logic)
                if (options.tag?.length > 0) {
                    const taskTags = task.tags || [];
                    const allTagsMatch = options.tag.every(t => taskTags.includes(t));
                    if (!allTagsMatch)
                        return;
                }
                output.push({
                    id,
                    title: task.title,
                    status: task.status,
                    depth,
                    ready: blockersResolved(task, tasks)
                });
                if (!options.json) {
                    const sym = statusSymbol(task.status);
                    console.log(`${indent}${sym} ${id}: ${task.title}`);
                }
                const taskDeps = blocks.get(id) || [];
                taskDeps.forEach((depId, i) => {
                    const isLast = i === taskDeps.length - 1;
                    printTree(depId, indent + (isLast ? '  ' : '│ '), depth + 1);
                });
            }
            roots.forEach(root => printTree(root));
            if (options.json) {
                jsonOut(output);
            }
        }
    });
}
